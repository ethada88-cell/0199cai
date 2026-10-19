/**
 * 隐藏弹窗独立服务入口（无第三方依赖，Node 22 即可跑）
 *
 * 接口：
 *   POST /api/probe         前端问：这次访问要不要弹窗
 *   POST /api/track         记录关闭弹窗等事件
 *   POST /api/admin/login   后台登录（账号+密码）
 *   POST /api/admin/account 修改账号密码
 *   GET  /api/admin/track   刷量统计
 * 静态：
 *   /probe.js               给任意网站嵌入的脚本
 *   /admin                  刷量检测后台页
 *
 * 环境变量见 README.md
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ingestTrack, probeVisit, adminTrack } from "./track.mjs";
import { summary as learnSummary, feedback as learnFeedback, removeLearned } from "./learn.mjs";
import { issueChallenge, verifyChallenge } from "./challenge.mjs";
import { checkLogin, changeAccount, getUsername, getAccountInfo, listAccounts } from "./auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 18471);
const tokens = new Map(); // token -> { exp, username }
const TOKEN_MS = 12 * 60 * 60 * 1000;

function json(res, data, status = 200, extra = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extra,
  });
  res.end(body);
}

/** 允许别的域名用 <script src="本站/probe.js"> 跨域调接口 */
function corsHeaders(req) {
  const allow = String(process.env.ALLOW_ORIGINS || "*").trim();
  const origin = String(req.headers.origin || "");
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Token",
    "Access-Control-Max-Age": "86400",
  };
  if (allow === "*") {
    headers["Access-Control-Allow-Origin"] = origin || "*";
    if (origin) headers["Vary"] = "Origin";
  } else {
    const ok = allow.split(",").map((x) => x.trim()).filter(Boolean);
    if (origin && ok.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
  }
  return headers;
}

function applyCors(req, res) {
  const h = corsHeaders(req);
  for (const [k, v] of Object.entries(h)) res.setHeader(k, v);
}

async function readBody(req, max = 120000) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function issueToken(username) {
  const token = crypto.randomBytes(24).toString("hex");
  tokens.set(token, { exp: Date.now() + TOKEN_MS, username: String(username || "") });
  return token;
}

function validToken(token) {
  const row = tokens.get(String(token || ""));
  if (!row) return false;
  if (row.exp < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

function tokenUser(token) {
  const row = tokens.get(String(token || ""));
  return row && row.exp >= Date.now() ? row.username : "";
}

function clearUserTokens(username) {
  for (const [t, row] of tokens) {
    if (row && row.username === username) tokens.delete(t);
  }
}

function adminToken(req, url) {
  return (
    req.headers["x-admin-token"] ||
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") ||
    url.searchParams.get("token") ||
    ""
  );
}

function typeOf(file) {
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".svg")) return "image/svg+xml";
  if (file.endsWith(".tar.gz") || file.endsWith(".tgz")) return "application/gzip";
  return "application/octet-stream";
}

function sendFile(res, file, cache) {
  const abs = path.resolve(PUBLIC, file);
  // 禁止跳出 public 目录
  if (!abs.startsWith(PUBLIC + path.sep) && abs !== PUBLIC) {
    res.writeHead(403);
    res.end("forbid");
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  const buf = fs.readFileSync(abs);
  const headers = {
    "Content-Type": typeOf(file),
    "Cache-Control": cache || "public, max-age=300",
    "Content-Length": buf.length,
  };
  if (file.endsWith(".tar.gz") || file.endsWith(".tgz")) {
    headers["Content-Disposition"] = 'attachment; filename="probe-gate.tar.gz"';
  }
  res.writeHead(200, headers);
  res.end(buf);
}

const server = http.createServer(async (req, res) => {
  try {
    applyCors(req, res);
    const url = new URL(req.url || "/", "http://" + (req.headers.host || "127.0.0.1"));
    const p = decodeURIComponent(url.pathname || "/");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 前台嵌入脚本会调这个：返回 trap=true 才出滑动验证
    if (p === "/api/probe" && (req.method === "GET" || req.method === "POST")) {
      let body = {};
      if (req.method === "POST") {
        try {
          body = JSON.parse((await readBody(req, 12000)).toString("utf8") || "{}");
        } catch {
          body = {};
        }
      } else {
        body = {
          page: url.searchParams.get("page") || "/",
          ref: url.searchParams.get("ref") || "",
          utm: url.searchParams.get("utm") || "",
          site: url.searchParams.get("site") || "",
        };
      }
      return json(res, { code: 200, data: probeVisit(req, body) });
    }

    // 滑动验证：下发挑战 / 校验通过后记为真量
    if (p === "/api/challenge" && req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse((await readBody(req, 12000)).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      return json(res, { code: 200, data: issueChallenge(req, body) });
    }
    if (p === "/api/challenge/verify" && req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse((await readBody(req, 12000)).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      return json(res, { code: 200, data: verifyChallenge(req, body) });
    }

    if (p === "/api/track" && req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse((await readBody(req, 120000)).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      return json(res, { code: 200, data: ingestTrack(req, body) });
    }

    if (p === "/api/admin/login" && req.method === "POST") {
      let body = {};
      try {
        body = JSON.parse((await readBody(req, 8000)).toString("utf8") || "{}");
      } catch {
        body = {};
      }
      const username = String(body.username || body.user || "").trim();
      const password = String(body.password || "");
      if (!checkLogin(username, password)) {
        return json(res, { code: 401, message: "账号或密码错误" }, 401);
      }
      const info = getAccountInfo(username) || { username };
      return json(res, {
        code: 200,
        data: {
          token: issueToken(info.username || username),
          username: info.username || username,
          role: info.role,
          level: info.level,
          label: info.label,
          isOwner: !!info.isOwner,
        },
      });
    }

    if (p.startsWith("/api/admin")) {
      const tok = adminToken(req, url);
      if (!validToken(tok)) return json(res, { code: 401, message: "请先登录后台" }, 401);
      if (p === "/api/admin/me" && req.method === "GET") {
        const u = tokenUser(tok) || getUsername();
        const info = getAccountInfo(u) || { username: u };
        return json(res, {
          code: 200,
          data: {
            username: info.username || u,
            role: info.role,
            level: info.level,
            label: info.label,
            isOwner: !!info.isOwner,
            accounts: listAccounts(),
          },
        });
      }
      if (p === "/api/admin/account" && req.method === "POST") {
        let body = {};
        try {
          body = JSON.parse((await readBody(req, 8000)).toString("utf8") || "{}");
        } catch {
          body = {};
        }
        const oldUser = tokenUser(tok) || getUsername();
        const data = changeAccount(oldUser, body);
        // 改密/改号后清掉旧会话，强制重登
        clearUserTokens(oldUser);
        clearUserTokens(data.username);
        return json(res, { code: 200, data });
      }
      if (p === "/api/admin/track") {
        return json(res, { code: 200, data: adminTrack(Object.fromEntries(url.searchParams)) });
      }
      if (p === "/api/admin/learn" && req.method === "GET") {
        return json(res, { code: 200, data: learnSummary() });
      }
      if (p === "/api/admin/feedback" && req.method === "POST") {
        let body = {};
        try {
          body = JSON.parse((await readBody(req, 8000)).toString("utf8") || "{}");
        } catch {
          body = {};
        }
        return json(res, { code: 200, data: learnFeedback(body) });
      }
      if (p === "/api/admin/learn/remove" && req.method === "POST") {
        let body = {};
        try {
          body = JSON.parse((await readBody(req, 4000)).toString("utf8") || "{}");
        } catch {
          body = {};
        }
        return json(res, { code: 200, data: removeLearned(body) });
      }
      return json(res, { code: 404, message: "not found" }, 404);
    }

    if (p === "/" || p === "/admin" || p === "/admin/") {
      return sendFile(res, "admin.html", "no-store");
    }
    if (p === "/probe.js") return sendFile(res, "probe.js", "public, max-age=120");
    if (p.startsWith("/") && p.indexOf("..") < 0) {
      const rel = p.slice(1);
      if (rel && fs.existsSync(path.join(PUBLIC, rel))) return sendFile(res, rel);
    }
    json(res, { code: 404, message: "not found" }, 404);
  } catch (e) {
    json(res, { code: e.status || 500, message: e.message || "error" }, e.status || 500);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("probe-gate http://0.0.0.0:" + PORT);
});
