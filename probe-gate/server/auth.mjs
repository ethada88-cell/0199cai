/**
 * 后台多账号：
 * - shuji888 / admin123@  最高账号（owner，level 100）
 * - admin / admin123@     管理员（保持不变，level 50）
 * 持久化：DATA_DIR/admin-account.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync("/data") ? "/data" : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const FILE = path.join(DATA_DIR, "admin-account.json");

// 注意：不要用 ADMIN_USER 作为最高账号回退，避免和管理员 admin 冲突
const OWNER_USER = String(process.env.OWNER_USER || "shuji888").trim() || "shuji888";
const OWNER_PASS = String(process.env.OWNER_PASS || process.env.ADMIN_PASS || "admin123@");
const KEEP_ADMIN_USER = String(process.env.ADMIN_USER_KEEP || "admin").trim() || "admin";
const KEEP_ADMIN_PASS = String(process.env.ADMIN_PASS_KEEP || process.env.ADMIN_PASS || "admin123@");

const OWNER_ROLE = "owner";
const ADMIN_ROLE = "admin";

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

function makeUser(username, password, { role, level, label }) {
  const { salt, hash } = hashPass(password);
  const now = Date.now();
  return {
    username,
    salt,
    hash,
    role,
    level,
    label,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultStore() {
  return {
    version: 2,
    users: [
      makeUser(OWNER_USER, OWNER_PASS, { role: OWNER_ROLE, level: 100, label: "最高账号" }),
      makeUser(KEEP_ADMIN_USER, KEEP_ADMIN_PASS, { role: ADMIN_ROLE, level: 50, label: "管理员" }),
    ],
    updatedAt: Date.now(),
  };
}

function save(store) {
  ensureDir();
  const tmp = FILE + ".tmp";
  const out = { ...store, version: 2, updatedAt: Date.now() };
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2));
  fs.renameSync(tmp, FILE);
  cache = out;
}

function publicInfo(user) {
  if (!user) return null;
  const isOwner = user.role === OWNER_ROLE || user.username === OWNER_USER;
  return {
    username: user.username,
    role: isOwner ? OWNER_ROLE : ADMIN_ROLE,
    level: isOwner ? 100 : user.level == null ? 50 : user.level,
    label: isOwner ? "最高账号" : user.label || "管理员",
    isOwner,
  };
}

function normalizeUsers(rawUsers) {
  const byName = new Map();
  for (const u of rawUsers || []) {
    if (!u || !u.username || !u.salt || !u.hash) continue;
    // 同名保留较新的
    const prev = byName.get(u.username);
    if (!prev || (u.updatedAt || 0) >= (prev.updatedAt || 0)) byName.set(u.username, { ...u });
  }
  return [...byName.values()];
}

/**
 * 保证同时存在：
 * 1) 最高账号 OWNER_USER（shuji888）
 * 2) 管理员 KEEP_ADMIN_USER（admin）— 已有则不改密码
 */
function ensureBuiltinUsers(store) {
  let users = normalizeUsers(store.users);
  let changed = false;

  // 若 admin 被误标为 owner，降回管理员（保留其密码哈希）
  users = users.map((u) => {
    if (u.username === KEEP_ADMIN_USER && u.username !== OWNER_USER && u.role === OWNER_ROLE) {
      changed = true;
      return { ...u, role: ADMIN_ROLE, level: 50, label: "管理员" };
    }
    return u;
  });

  const owner = users.find((u) => u.username === OWNER_USER);
  if (!owner) {
    users.unshift(makeUser(OWNER_USER, OWNER_PASS, { role: OWNER_ROLE, level: 100, label: "最高账号" }));
    changed = true;
  } else if (owner.role !== OWNER_ROLE || owner.level !== 100) {
    owner.role = OWNER_ROLE;
    owner.level = 100;
    owner.label = "最高账号";
    changed = true;
  }

  const admin = users.find((u) => u.username === KEEP_ADMIN_USER);
  if (!admin) {
    users.push(makeUser(KEEP_ADMIN_USER, KEEP_ADMIN_PASS, { role: ADMIN_ROLE, level: 50, label: "管理员" }));
    changed = true;
  } else if (admin.username !== OWNER_USER && (admin.role !== ADMIN_ROLE || admin.level !== 50)) {
    admin.role = ADMIN_ROLE;
    admin.level = 50;
    admin.label = "管理员";
    changed = true;
  }

  // 规范化其余账号字段
  for (const u of users) {
    if (u.username === OWNER_USER) continue;
    if (u.username === KEEP_ADMIN_USER) continue;
    if (!u.role) {
      u.role = ADMIN_ROLE;
      changed = true;
    }
    if (u.level == null) {
      u.level = 50;
      changed = true;
    }
    if (!u.label) {
      u.label = "管理员";
      changed = true;
    }
  }

  store.users = normalizeUsers(users);
  store.version = 2;
  if (changed) save(store);
  else cache = store;
  return store;
}

function migrateLegacy(j) {
  if (j && j.username && j.salt && j.hash && !Array.isArray(j.users)) {
    const name = String(j.username);
    const legacy = {
      username: name,
      salt: j.salt,
      hash: j.hash,
      role: name === OWNER_USER ? OWNER_ROLE : ADMIN_ROLE,
      level: name === OWNER_USER ? 100 : 50,
      label: name === OWNER_USER ? "最高账号" : "管理员",
      createdAt: j.createdAt || Date.now(),
      updatedAt: j.updatedAt || Date.now(),
    };
    return ensureBuiltinUsers({ version: 2, users: [legacy], updatedAt: Date.now() });
  }
  return null;
}

function load() {
  if (cache) return cache;
  ensureDir();
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    const migrated = migrateLegacy(j);
    if (migrated) return migrated;
    if (j && Array.isArray(j.users)) return ensureBuiltinUsers(j);
  } catch {
    /* create default */
  }
  const store = defaultStore();
  save(store);
  return store;
}

function findUser(username) {
  const u = String(username || "").trim();
  if (!u) return null;
  return (load().users || []).find((x) => x && x.username === u) || null;
}

export function getUsername() {
  return OWNER_USER;
}

export function getAccountInfo(username) {
  const user = findUser(username);
  if (user) return publicInfo(user);
  return publicInfo((load().users || []).find((u) => u && u.username === OWNER_USER));
}

export function listAccounts() {
  return (load().users || []).map(publicInfo).filter(Boolean);
}

export function checkLogin(username, password) {
  const user = findUser(username);
  const p = String(password || "");
  if (!user || !p) return false;
  return verifyPass(p, user.salt, user.hash);
}

/**
 * 修改当前登录账号的用户名/密码。
 * actorUsername: 当前登录用户
 */
export function changeAccount(actorUsername, { currentPassword, newUsername, newPassword } = {}) {
  const store = load();
  const acc = findUser(actorUsername);
  if (!acc) throw Object.assign(new Error("账号不存在"), { status: 404 });
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
    const clash = (store.users || []).find((u) => u && u.username === username && u.username !== acc.username);
    if (clash) throw Object.assign(new Error("该账号名已被占用"), { status: 400 });
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

  const wasOwner = acc.role === OWNER_ROLE || acc.username === OWNER_USER;
  const role = wasOwner ? OWNER_ROLE : ADMIN_ROLE;
  const level = wasOwner ? 100 : 50;
  const label = wasOwner ? "最高账号" : "管理员";

  const next = (store.users || []).map((u) => {
    if (!u || u.username !== acc.username) return u;
    return {
      ...u,
      username,
      salt,
      hash,
      role,
      level,
      label,
      updatedAt: Date.now(),
    };
  });
  save({ ...store, users: next });

  return {
    ...publicInfo({ username, role, level, label }),
    message: "账号已更新，请使用新账号重新登录",
  };
}

load();
