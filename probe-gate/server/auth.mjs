/**
 * 后台账号：用户名 + 密码，可在后台修改，持久化到 DATA_DIR/admin-account.json
 * 默认：admin / admin123@
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync("/data") ? "/data" : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const FILE = path.join(DATA_DIR, "admin-account.json");

const DEFAULT_USER = String(process.env.ADMIN_USER || "admin").trim() || "admin";
const DEFAULT_PASS = String(process.env.ADMIN_PASS || "admin123@");

let cache = null;

function ensureDir() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function hashPass(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), s, 32).toString("hex");
  return { salt: s, hash };
}

function verifyPass(password, salt, hash) {
  try {
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(crypto.scryptSync(String(password), salt, 32));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function save(account) {
  ensureDir();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(account, null, 2));
  fs.renameSync(tmp, FILE);
  cache = account;
}

function load() {
  if (cache) return cache;
  ensureDir();
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (j && j.username && j.salt && j.hash) {
      cache = j;
      return cache;
    }
  } catch {
    /* create default */
  }
  const { salt, hash } = hashPass(DEFAULT_PASS);
  const account = {
    username: DEFAULT_USER,
    salt,
    hash,
    updatedAt: Date.now(),
    createdAt: Date.now(),
  };
  save(account);
  return account;
}

export function getUsername() {
  return load().username;
}

export function checkLogin(username, password) {
  const acc = load();
  const u = String(username || "").trim();
  const p = String(password || "");
  if (!u || !p) return false;
  // 用户名也做常量时间倾向比较（长度不同时直接 false）
  const ua = Buffer.from(u);
  const ub = Buffer.from(String(acc.username || ""));
  if (ua.length !== ub.length || !crypto.timingSafeEqual(ua, ub)) return false;
  return verifyPass(p, acc.salt, acc.hash);
}

/**
 * 修改账号/密码。
 * body: { currentPassword, newUsername?, newPassword? }
 */
export function changeAccount({ currentPassword, newUsername, newPassword } = {}) {
  const acc = load();
  if (!verifyPass(currentPassword, acc.salt, acc.hash)) {
    throw Object.assign(new Error("当前密码不正确"), { status: 400 });
  }

  let username = acc.username;
  if (newUsername != null && String(newUsername).trim() !== "") {
    username = String(newUsername).trim();
    if (username.length < 3 || username.length > 32) {
      throw Object.assign(new Error("账号长度需 3~32 位"), { status: 400 });
    }
    if (!/^[A-Za-z0-9_\u4e00-\u9fa5.-]+$/.test(username)) {
      throw Object.assign(new Error("账号仅支持字母数字下划线中文"), { status: 400 });
    }
  }

  let salt = acc.salt;
  let hash = acc.hash;
  if (newPassword != null && String(newPassword) !== "") {
    const np = String(newPassword);
    if (np.length < 6 || np.length > 64) {
      throw Object.assign(new Error("密码长度需 6~64 位"), { status: 400 });
    }
    ({ salt, hash } = hashPass(np));
  }

  if (username === acc.username && salt === acc.salt && hash === acc.hash) {
    throw Object.assign(new Error("请填写新账号或新密码"), { status: 400 });
  }

  save({
    username,
    salt,
    hash,
    createdAt: acc.createdAt || Date.now(),
    updatedAt: Date.now(),
  });

  return { username, message: "账号已更新，请使用新账号重新登录" };
}

// 启动时确保默认账号文件存在
load();
