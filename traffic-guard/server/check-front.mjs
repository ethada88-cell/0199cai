/**
 * 检测热路径前置：用原生 http 扛洪峰，避免 Next 单线程被首检/半开连接拖死。
 * - 首次 check / 过载 / 冷启动：本进程立刻 allow（不挡浏览）
 * - 健康时的二次监测：转发到本机 Next(43126) 做完整评分记量
 * - ping / OPTIONS 本进程处理
 * - 其它路径反代到 Next
 */
import http from "node:http";
import { request as httpRequest } from "node:http";

const FRONT_PORT = Number(process.env.TG_FRONT_PORT || 43127);
const NEXT_PORT = Number(process.env.TG_NEXT_PORT || 43126);
const NEXT_HOST = process.env.TG_NEXT_HOST || "127.0.0.1";
const MAX_BODY = 96 * 1024;
const COLD_SEC = 45;
const OVERLOAD_LAG_MS = 50;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

let lagMs = 0;
let startedAt = Date.now();
let inFlight = 0;
const MAX_INFLIGHT = 400;
/** 同时转发到 Next 的二次监测上限，超出直接放行，避免 Next 被打满。 */
let nextInFlight = 0;
const MAX_NEXT_INFLIGHT = 40;
/** Next 连续超时/失败时短暂熔断，只放行不评分，保护整机负载。 */
let nextBackoffUntil = 0;
let nextFaults = 0;

function nextHealthy() {
  return Date.now() >= nextBackoffUntil;
}

function noteNextOk() {
  nextFaults = 0;
}

function noteNextFault() {
  nextFaults += 1;
  if (nextFaults >= 3) {
    nextBackoffUntil = Date.now() + 8000;
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

function proxyToNext(req, res, bodyBuf) {
  if (!nextHealthy() || nextInFlight >= MAX_NEXT_INFLIGHT) {
    send(res, 200, allowBody());
    return;
  }
  const headers = { ...req.headers, host: `${NEXT_HOST}:${NEXT_PORT}` };
  delete headers["content-length"];
  if (bodyBuf) headers["content-length"] = String(bodyBuf.length);
  nextInFlight += 1;
  const done = () => {
    nextInFlight = Math.max(0, nextInFlight - 1);
  };
  const upstream = httpRequest(
    {
      host: NEXT_HOST,
      port: NEXT_PORT,
      path: req.url,
      method: req.method,
      headers,
      timeout: 1200,
    },
    (up) => {
      noteNextOk();
      const out = { ...up.headers };
      res.writeHead(up.statusCode || 502, out);
      up.on("end", done);
      up.on("close", done);
      up.pipe(res);
    },
  );
  upstream.on("timeout", () => {
    noteNextFault();
    done();
    upstream.destroy();
    if (!res.headersSent) send(res, 200, allowBody());
  });
  upstream.on("error", () => {
    noteNextFault();
    done();
    if (!res.headersSent) send(res, 200, allowBody());
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
  if (!followUp || cold() || overloaded() || !nextHealthy()) {
    send(res, 200, allowBody(peekAccount(text), peekSite(text)));
    return;
  }
  proxyToNext(req, res, Buffer.from(text));
}

async function handlePopup(req, res) {
  // 弹窗上报可丢，绝不能拖死事件循环
  try {
    await readBody(req);
  } catch {
    /* ignore */
  }
  if (cold() || overloaded()) {
    send(res, 200, JSON.stringify({ ok: true }));
    return;
  }
  proxyToNext(req, res, Buffer.from("{}"));
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
          nextOk: nextHealthy(),
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
      // popup 需要完整 body 才能记滑动；过载时丢弃，正常时整包转发
      if (cold() || overloaded()) {
        try {
          await readBody(req);
        } catch {
          /* ignore */
        }
        send(res, 200, JSON.stringify({ ok: true }));
        return;
      }
      const text = await readBody(req).catch(() => "");
      proxyToNext(req, res, Buffer.from(text || "{}"));
      return;
    }
    proxyToNext(req, res, null);
  } catch {
    if (!res.headersSent) send(res, 200, allowBody());
  } finally {
    inFlight = Math.max(0, inFlight - 1);
  }
});

server.requestTimeout = 4000;
// 与 nginx upstream keepalive 对齐，减少 TIME-WAIT / docker-proxy 抖动
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.maxRequestsPerSocket = 100;
server.listen(FRONT_PORT, "0.0.0.0", () => {
  console.log(`[check-front] :${FRONT_PORT} -> next :${NEXT_PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref?.();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
