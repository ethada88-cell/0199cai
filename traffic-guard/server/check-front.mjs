/**
 * 检测热路径前置：用原生 http 扛洪峰，避免 Next 单线程被首检/半开连接拖死。
 * - 首次 check：立刻 allow（本来就不记量）
 * - 二次监测：优先同步转 Next；忙时先回 allow，再排队异步记量（不丢假量/真实量）
 * - 异步记量转发真实 IP/UA；超时不重投（防双计）；探活要求 Next 可达
 * - ping / OPTIONS 本进程处理；其它路径反代 Next
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

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
const NEXT_PROBE_MS = 2000;
const NEXT_PROBE_TIMEOUT_MS = 800;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

const CLIENT_HEADER_KEYS = [
  "x-real-ip",
  "x-forwarded-for",
  "cf-connecting-ip",
  "user-agent",
  "referer",
  "origin",
  "x-forwarded-proto",
  "x-tg-idempotency-key",
];

let lagMs = 0;
let startedAt = Date.now();
let inFlight = 0;
let nextInFlight = 0;
let nextBackoffUntil = 0;
let nextFaults = 0;
let nextReachable = false;
let queuedDropped = 0;
let persistedAsync = 0;
const persistQueue = [];

function nextHealthy() {
  return Date.now() >= nextBackoffUntil;
}

function noteNextOk() {
  nextFaults = 0;
  nextReachable = true;
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

function canSyncNext() {
  return !cold() && !overloaded() && nextHealthy() && nextInFlight < MAX_NEXT_INFLIGHT;
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

function captureClientHeaders(req) {
  const h = req.headers || {};
  const out = {};
  for (const k of CLIENT_HEADER_KEYS) {
    const v = h[k];
    if (v == null || v === "") continue;
    out[k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

function persistPath(path) {
  if (path.startsWith("/api/v1/check")) return "/api/v1/check";
  if (path.startsWith("/api/v1/popup")) return "/api/v1/popup";
  return "";
}

/**
 * 异步记量到 Next。
 * retryable：仅「请求未真正送出」时可重试（忙/连接拒绝）；
 * 一旦 body 已交给上游，或超时/已收到响应，不可再重投，避免双计。
 */
function postNext(path, bodyBuf, clientHeaders = {}, { timeoutMs = NEXT_TIMEOUT_MS, onDone } = {}) {
  if (!nextHealthy() || nextInFlight >= MAX_NEXT_INFLIGHT) {
    onDone?.(Object.assign(new Error("next busy"), { retryable: true }));
    return;
  }
  nextInFlight += 1;
  let retryable = true;
  let settled = false;
  const finished = (err) => {
    if (settled) return;
    settled = true;
    nextInFlight = Math.max(0, nextInFlight - 1);
    if (err) err.retryable = Boolean(err.retryable && retryable);
    onDone?.(err || null);
    pumpQueue();
  };
  const headers = {
    ...clientHeaders,
    "content-type": "text/plain;charset=UTF-8",
    "content-length": String(bodyBuf.length),
    connection: "keep-alive",
  };
  const upstream = http.request(
    {
      host: NEXT_HOST,
      port: NEXT_PORT,
      path,
      method: "POST",
      headers,
      timeout: timeoutMs,
    },
    (up) => {
      retryable = false;
      up.resume();
      up.on("end", () => {
        if ((up.statusCode || 500) >= 500) {
          noteNextFault();
          finished(Object.assign(new Error(`status ${up.statusCode}`), { retryable: false }));
        } else {
          noteNextOk();
          finished(null);
        }
      });
      up.on("error", (err) => {
        noteNextFault();
        finished(Object.assign(err, { retryable: false }));
      });
    },
  );
  upstream.on("timeout", () => {
    retryable = false;
    noteNextFault();
    upstream.destroy();
    finished(Object.assign(new Error("timeout"), { retryable: false }));
  });
  upstream.on("error", (err) => {
    noteNextFault();
    const code = err && err.code;
    const connectFail =
      code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND" || code === "EHOSTUNREACH";
    finished(Object.assign(err, { retryable: retryable && connectFail }));
  });
  upstream.end(bodyBuf, () => {
    retryable = false;
  });
}

function enqueuePersist(path, text, clientHeaders = {}, tries = 0, idemKey = "") {
  if (persistQueue.length >= MAX_QUEUE) {
    persistQueue.shift();
    queuedDropped += 1;
  }
  const incoming = clientHeaders["x-tg-idempotency-key"];
  const key =
    idemKey ||
    (typeof incoming === "string" && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : "") ||
    randomUUID();
  const headers = { ...clientHeaders, "x-tg-idempotency-key": key };
  persistQueue.push({ path, text, headers, tries, idemKey: key });
  pumpQueue();
}

function pumpQueue() {
  // 冷启动也要继续消化队列，否则会堆积后少记。
  while (persistQueue.length && nextHealthy() && nextInFlight < MAX_NEXT_INFLIGHT) {
    const item = persistQueue.shift();
    postNext(item.path, Buffer.from(item.text), item.headers || {}, {
      onDone: (err) => {
        if (!err) {
          persistedAsync += 1;
          return;
        }
        // 仅未送出时可重试；已送出/超时靠幂等键兜底，不再重投
        if (err.retryable && (item.tries || 0) < 6 && persistQueue.length < MAX_QUEUE) {
          persistQueue.push({ ...item, tries: (item.tries || 0) + 1 });
        } else if (err.retryable) {
          queuedDropped += 1;
        }
      },
    });
  }
}

setInterval(() => {
  if (persistQueue.length) pumpQueue();
}, 200).unref?.();

function probeNext() {
  const req = http.request(
    {
      host: NEXT_HOST,
      port: NEXT_PORT,
      path: "/api/v1/ping",
      method: "GET",
      timeout: NEXT_PROBE_TIMEOUT_MS,
    },
    (up) => {
      up.resume();
      up.on("end", () => {
        if ((up.statusCode || 500) < 500) noteNextOk();
        else {
          nextReachable = false;
          noteNextFault();
        }
      });
      up.on("error", () => {
        nextReachable = false;
      });
    },
  );
  req.on("timeout", () => {
    nextReachable = false;
    req.destroy();
  });
  req.on("error", () => {
    nextReachable = false;
  });
  req.end();
}
probeNext();
setInterval(probeNext, NEXT_PROBE_MS).unref?.();

function proxyToNext(req, res, bodyBuf, path = req.url || "/", clientHeaders = null) {
  const captured = clientHeaders || captureClientHeaders(req);
  const persist = bodyBuf ? persistPath(path) : "";
  if (!nextHealthy() || nextInFlight >= MAX_NEXT_INFLIGHT) {
    if (persist) enqueuePersist(persist, bodyBuf.toString("utf8"), captured);
    send(res, 200, persist === "/api/v1/popup" ? JSON.stringify({ ok: true }) : allowBody());
    return;
  }
  const headers = { ...req.headers, host: `${NEXT_HOST}:${NEXT_PORT}`, ...captured };
  delete headers["content-length"];
  if (bodyBuf) headers["content-length"] = String(bodyBuf.length);
  nextInFlight += 1;
  let requestSent = false;
  let settled = false;
  const done = () => {
    if (settled) return;
    settled = true;
    nextInFlight = Math.max(0, nextInFlight - 1);
    pumpQueue();
  };
  const softAllow = () => {
    if (res.headersSent) return;
    send(res, 200, persist === "/api/v1/popup" ? JSON.stringify({ ok: true }) : allowBody());
  };
  const upstream = http.request(
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
    // 请求可能已送出：不再 enqueuePersist，避免超时双计
    softAllow();
  });
  upstream.on("error", () => {
    noteNextFault();
    done();
    // 仅连接未建立时才异步补记
    if (!requestSent && persist) enqueuePersist(persist, bodyBuf.toString("utf8"), captured);
    softAllow();
  });
  if (bodyBuf) {
    upstream.end(bodyBuf, () => {
      requestSent = true;
    });
  } else {
    requestSent = true;
    req.pipe(upstream);
  }
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
  const captured = captureClientHeaders(req);
  if (!followUp) {
    send(res, 200, allowBody(peekAccount(text), peekSite(text)));
    return;
  }
  if (canSyncNext()) {
    proxyToNext(req, res, Buffer.from(text), "/api/v1/check", captured);
    return;
  }
  enqueuePersist("/api/v1/check", text, captured);
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
          nextReachable,
          queue: persistQueue.length,
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
      const captured = captureClientHeaders(req);
      if (canSyncNext()) {
        proxyToNext(req, res, Buffer.from(text || "{}"), "/api/v1/popup", captured);
        return;
      }
      if (text) enqueuePersist("/api/v1/popup", text, captured);
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
