/**
 * 检测热路径前置：用原生 http 扛洪峰，避免 Next 单线程被首检/半开连接拖死。
 * - 首次 check：立刻 allow（本来就不记量）
 * - 二次监测：优先同步转 Next；忙时先回 allow，再排队异步记量（不丢假量/真实量）
 * - ping / OPTIONS 本进程处理；其它路径反代 Next
 */
import http from "node:http";
import { request as httpRequest } from "node:http";

const FRONT_PORT = Number(process.env.TG_FRONT_PORT || 43127);
const NEXT_PORT = Number(process.env.TG_NEXT_PORT || 43126);
const NEXT_HOST = process.env.TG_NEXT_HOST || "127.0.0.1";
const MAX_BODY = 96 * 1024;
const COLD_SEC = 20;
const OVERLOAD_LAG_MS = 80;
const MAX_INFLIGHT = 800;
const MAX_NEXT_INFLIGHT = 120;
const MAX_QUEUE = 20_000;
const NEXT_TIMEOUT_MS = 4000;
const BACKOFF_MS = 2500;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

let lagMs = 0;
let startedAt = Date.now();
let inFlight = 0;
let nextInFlight = 0;
let nextBackoffUntil = 0;
let nextFaults = 0;
let queued = 0;
let queuedDropped = 0;
let persistedAsync = 0;
const persistQueue = [];

function nextHealthy() {
  return Date.now() >= nextBackoffUntil;
}

function noteNextOk() {
  nextFaults = 0;
}

function noteNextFault() {
  nextFaults += 1;
  if (nextFaults >= 8) {
    nextBackoffUntil = Date.now() + BACKOFF_MS;
    nextFaults = 0;
  }
}

function tickLag() {
  const t0 = Date.now();
  setImmediate(() => {
    lagMs = Date.now() - t0;
    setTimeout(tickLag, 120).unref?.();
  });
}
tickLag();

function overloaded() {
  return lagMs >= OVERLOAD_LAG_MS || inFlight >= MAX_INFLIGHT;
}

function cold() {
  return (Date.now() - startedAt) / 1000 < COLD_SEC;
}

function allowBody(accountId = "", siteKey = "") {
  return JSON.stringify({
    ok: true,
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    at: Date.now(),
    accountId,
    siteKey,
    verdict: "real",
    action: "allow",
    challenge: false,
    farm: false,
    virtual: false,
    tracked: false,
    score: 0,
    categories: [],
    reasons: [],
    ua: "",
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function peekFollowUp(text) {
  return /"followUp"\s*:\s*true/.test(text) || /"leaving"\s*:\s*true/.test(text);
}

function peekAccount(text) {
  const m = text.match(/"account"\s*:\s*"([^"]{0,64})"/);
  return m ? m[1] : "";
}

function peekSite(text) {
  const m = text.match(/"siteKey"\s*:\s*"([^"]{0,253})"/);
  return m ? m[1] : "";
}

function send(res, status, body, headers = CORS) {
  res.writeHead(status, headers);
  res.end(body);
}

function postNext(path, bodyBuf, { timeoutMs = NEXT_TIMEOUT_MS, onDone } = {}) {
  if (!nextHealthy() || nextInFlight >= MAX_NEXT_INFLIGHT) {
    onDone?.(new Error("next busy"));
    return;
  }
  nextInFlight += 1;
  const finished = (err) => {
    nextInFlight = Math.max(0, nextInFlight - 1);
    onDone?.(err || null);
    pumpQueue();
  };
  const upstream = httpRequest(
    {
      host: NEXT_HOST,
      port: NEXT_PORT,
      path,
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        "content-length": String(bodyBuf.length),
        connection: "keep-alive",
      },
      timeout: timeoutMs,
    },
    (up) => {
      up.resume();
      up.on("end", () => {
        if ((up.statusCode || 500) >= 500) {
          noteNextFault();
          finished(new Error(`status ${up.statusCode}`));
        } else {
          noteNextOk();
          finished(null);
        }
      });
      up.on("error", (err) => {
        noteNextFault();
        finished(err);
      });
    },
  );
  upstream.on("timeout", () => {
    noteNextFault();
    upstream.destroy();
    finished(new Error("timeout"));
  });
  upstream.on("error", (err) => {
    noteNextFault();
    finished(err);
  });
  upstream.end(bodyBuf);
}

function enqueuePersist(path, text, tries = 0) {
  if (persistQueue.length >= MAX_QUEUE) {
    persistQueue.shift();
    queuedDropped += 1;
  }
  persistQueue.push({ path, text, tries });
  queued = persistQueue.length;
  pumpQueue();
}

function pumpQueue() {
  // 冷启动也要继续消化队列，否则会堆积后少记。
  while (persistQueue.length && nextHealthy() && nextInFlight < MAX_NEXT_INFLIGHT) {
    const item = persistQueue.shift();
    queued = persistQueue.length;
    const body = Buffer.from(item.text);
    postNext(item.path, body, {
      onDone: (err) => {
        if (!err) {
          persistedAsync += 1;
          return;
        }
        // 失败有限次重试，避免死循环打爆队列
        if ((item.tries || 0) < 6 && persistQueue.length < MAX_QUEUE) {
          persistQueue.push({ ...item, tries: (item.tries || 0) + 1 });
          queued = persistQueue.length;
        } else {
          queuedDropped += 1;
        }
      },
    });
  }
}

setInterval(() => {
  if (persistQueue.length) pumpQueue();
}, 200).unref?.();

function proxyToNext(req, res, bodyBuf, path = req.url || "/") {
  if (!nextHealthy() || nextInFlight >= MAX_NEXT_INFLIGHT) {
    // 同步通道忙：先放行，再异步记量
    if (bodyBuf && path.startsWith("/api/v1/check")) enqueuePersist("/api/v1/check", bodyBuf.toString("utf8"));
    else if (bodyBuf && path.startsWith("/api/v1/popup")) enqueuePersist("/api/v1/popup", bodyBuf.toString("utf8"));
    send(res, 200, path.startsWith("/api/v1/popup") ? JSON.stringify({ ok: true }) : allowBody());
    return;
  }
  const headers = { ...req.headers, host: `${NEXT_HOST}:${NEXT_PORT}` };
  delete headers["content-length"];
  if (bodyBuf) headers["content-length"] = String(bodyBuf.length);
  nextInFlight += 1;
  const done = () => {
    nextInFlight = Math.max(0, nextInFlight - 1);
    pumpQueue();
  };
  const upstream = httpRequest(
    {
      host: NEXT_HOST,
      port: NEXT_PORT,
      path,
      method: req.method,
      headers,
      timeout: NEXT_TIMEOUT_MS,
    },
    (up) => {
      noteNextOk();
      res.writeHead(up.statusCode || 502, { ...up.headers });
      up.on("end", done);
      up.on("close", done);
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => {
    noteNextFault();
    done();
    upstream.destroy();
    if (!res.headersSent) {
      if (bodyBuf && path.startsWith("/api/v1/check")) enqueuePersist("/api/v1/check", bodyBuf.toString("utf8"));
      else if (bodyBuf && path.startsWith("/api/v1/popup")) enqueuePersist("/api/v1/popup", bodyBuf.toString("utf8"));
      send(res, 200, path.startsWith("/api/v1/popup") ? JSON.stringify({ ok: true }) : allowBody());
    }
  });
  upstream.on("error", () => {
    noteNextFault();
    done();
    if (!res.headersSent) {
      if (bodyBuf && path.startsWith("/api/v1/check")) enqueuePersist("/api/v1/check", bodyBuf.toString("utf8"));
      else if (bodyBuf && path.startsWith("/api/v1/popup")) enqueuePersist("/api/v1/popup", bodyBuf.toString("utf8"));
      send(res, 200, path.startsWith("/api/v1/popup") ? JSON.stringify({ ok: true }) : allowBody());
    }
  });
  if (bodyBuf) upstream.end(bodyBuf);
  else req.pipe(upstream);
}

async function handleCheck(req, res) {
  let text = "";
  try {
    text = await readBody(req);
  } catch {
    send(res, 200, allowBody());
    return;
  }
  const followUp = peekFollowUp(text);
  // 首次进站本来就不记量
  if (!followUp) {
    send(res, 200, allowBody(peekAccount(text), peekSite(text)));
    return;
  }
  // 能同步转发就同步（可弹窗）；忙/冷启动则先放行并排队记量，保证不漏数
  if (!cold() && !overloaded() && nextHealthy() && nextInFlight < MAX_NEXT_INFLIGHT) {
    proxyToNext(req, res, Buffer.from(text), "/api/v1/check");
    return;
  }
  enqueuePersist("/api/v1/check", text);
  send(res, 200, allowBody(peekAccount(text), peekSite(text)));
}

const server = http.createServer(async (req, res) => {
  inFlight += 1;
  try {
    const url = req.url || "/";
    if (req.method === "OPTIONS" && (url.startsWith("/api/v1/check") || url.startsWith("/api/v1/popup"))) {
      send(res, 204, "");
      return;
    }
    if (req.method === "GET" && (url === "/api/v1/ping" || url.startsWith("/api/v1/ping?"))) {
      send(
        res,
        200,
        JSON.stringify({
          ok: true,
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          lagMs,
          inFlight,
          nextInFlight,
          nextOk: nextHealthy(),
          queue: queued,
          queuedDropped,
          persistedAsync,
          front: true,
        }),
      );
      return;
    }
    if (req.method === "POST" && (url === "/api/v1/check" || url.startsWith("/api/v1/check?"))) {
      await handleCheck(req, res);
      return;
    }
    if (req.method === "POST" && (url === "/api/v1/popup" || url.startsWith("/api/v1/popup?"))) {
      const text = await readBody(req).catch(() => "");
      if (!cold() && !overloaded() && nextHealthy() && nextInFlight < MAX_NEXT_INFLIGHT) {
        proxyToNext(req, res, Buffer.from(text || "{}"), "/api/v1/popup");
        return;
      }
      // 滑动成功等上报也排队，避免过载丢「改真实」
      if (text) enqueuePersist("/api/v1/popup", text);
      send(res, 200, JSON.stringify({ ok: true }));
      return;
    }
    proxyToNext(req, res, null, url);
  } catch {
    if (!res.headersSent) send(res, 200, allowBody());
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
});

server.requestTimeout = 5000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxRequestsPerSocket = 200;
server.listen(FRONT_PORT, "0.0.0.0", () => {
  console.log(`[check-front] :${FRONT_PORT} -> next :${NEXT_PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref?.();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
