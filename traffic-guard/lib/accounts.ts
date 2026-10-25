import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Role = "admin" | "user";

type Account = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  enabled: boolean;
  createdAt: number;
  parentId: string;
  opens: boolean;
  sharesParent: boolean;
};

export type PublicAccount = {
  id: string;
  username: string;
  role: Role;
  enabled: boolean;
  createdAt: number;
  parentId: string;
  parentUsername: string;
  opens: boolean;
  sharesParent: boolean;
};

export type AccountActor = {
  accountId: string;
  role: Role;
  opens: boolean;
};

const FILE = path.resolve(process.cwd(), "data", "accounts", "index.json");
let cache: Account[] | null = null;

export function normalizeAccountId(input: unknown) {
  if (typeof input !== "string") return null;
  const id = input.trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  return id;
}

export function normalizeUsername(input: unknown) {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(name)) return null;
  return name;
}

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

const scryptAsync = promisify(scrypt);

async function verifyPassword(password: string, stored: string) {
  const [kind, saltHex, hashHex] = stored.split(":");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  if (password.length > 128) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parentIdOf(value: unknown, selfId: string) {
  if (typeof value !== "string") return "";
  const id = value.trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(id) || id === selfId) return "";
  return id;
}

function adopt(item: Account): Account {
  const parentId = parentIdOf(item.parentId, item.id);
  return {
    id: item.id,
    username: item.username,
    passwordHash: item.passwordHash,
    role: item.role === "admin" ? "admin" : "user",
    enabled: item.enabled !== false,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
    parentId,
    opens: item.role !== "admin" && item.opens === true && parentId === "",
    sharesParent: item.role !== "admin" && item.sharesParent === true && parentId !== "",
  };
}

function publish(account: Account, list: Account[]): PublicAccount {
  const parent = account.parentId ? list.find((item) => item.id === account.parentId) : undefined;
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    enabled: account.enabled,
    createdAt: account.createdAt,
    parentId: account.parentId,
    parentUsername: parent?.username || "",
    opens: account.opens,
    sharesParent: account.sharesParent,
  };
}

function save() {
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(cache || []));
}

function seed(): Account[] {
  const username = process.env.ADMIN_USER || "";
  const password = process.env.ADMIN_PASSWORD || "";
  if (!normalizeUsername(username) || password.length < 8 || !process.env.ADMIN_SESSION_SECRET) return [];
  return [{
    id: randomBytes(12).toString("hex"),
    username,
    passwordHash: hashPassword(password),
    role: "admin",
    enabled: true,
    createdAt: Date.now(),
    parentId: "",
    opens: false,
    sharesParent: false,
  }];
}

function load() {
  if (!existsSync(FILE)) {
    cache = seed();
    if (cache.length) save();
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Account[];
    cache = Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.username === "string").map(adopt)
      : [];
  } catch {
    cache = cache || [];
  }
  return cache;
}

export function accountsReady() {
  return load().length > 0 && Boolean(process.env.ADMIN_SESSION_SECRET);
}

export async function authenticate(username: string, password: string) {
  const account = load().find((item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.enabled);
  if (!account || !(await verifyPassword(password, account.passwordHash))) return null;
  const list = load();
  return publish(account, list);
}

export function accountById(id: string) {
  const key = normalizeAccountId(id);
  if (!key) return null;
  const list = load();
  const account = list.find((item) => item.id === key);
  return account ? publish(account, list) : null;
}

export function listAccounts() {
  const list = load();
  return list
    .map((account) => publish(account, list))
    .sort((a, b) => a.createdAt - b.createdAt || a.username.localeCompare(b.username));
}

export function visibleAccounts(actor: AccountActor) {
  const all = listAccounts();
  if (actor.role === "admin") return all;
  const self = all.find((item) => item.id === actor.accountId);
  if (!self) return [];
  if (self.opens) return all.filter((item) => item.id === self.id || item.parentId === self.id);
  if (self.sharesParent && self.parentId) return all.filter((item) => item.id === self.id || item.id === self.parentId);
  return [self];
}

export function managedAccounts(actor: AccountActor) {
  const all = listAccounts();
  if (actor.role === "admin") return all;
  if (actor.opens) return all.filter((item) => item.parentId === actor.accountId);
  return [];
}

export function canWriteSiteNote(actor: AccountActor, accountId: string) {
  const id = normalizeAccountId(accountId);
  if (!id) return false;
  if (actor.role === "admin") return true;
  if (id === actor.accountId) return true;
  const self = load().find((item) => item.id === actor.accountId);
  if (!self) return false;
  if (self.opens) return load().some((item) => item.id === id && item.parentId === self.id);
  return self.sharesParent && self.parentId === id;
}

export function changePassword(accountId: string, oldPassword: string, newPassword: string) {
  if (newPassword.length < 8 || newPassword.length > 128) return "新密码至少 8 位";
  const account = load().find((item) => item.id === accountId && item.enabled);
  if (!account || !verifyPassword(oldPassword, account.passwordHash)) return "原密码不正确";
  account.passwordHash = hashPassword(newPassword);
  save();
  return null;
}

export function createAccount(username: string, password: string, parentId = "") {
  const name = normalizeUsername(username);
  if (!name) return { error: "账号用 3 到 32 位字母、数字、下划线或横线" };
  if (password.length < 8 || password.length > 128) return { error: "密码至少 8 位" };
  const list = load();
  if (list.some((item) => item.username.toLowerCase() === name.toLowerCase())) return { error: "这个账号已经有了" };
  const parentKey = parentIdOf(parentId, "");
  const parent = parentKey ? list.find((item) => item.id === parentKey) : undefined;
  if (parentKey && (!parent || !parent.opens || parent.parentId || !parent.enabled)) return { error: "没有开通子账号的权限" };
  const account: Account = {
    id: randomBytes(12).toString("hex"),
    username: name,
    passwordHash: hashPassword(password),
    role: "user",
    enabled: true,
    createdAt: Date.now(),
    parentId: parent ? parent.id : "",
    opens: false,
    // 主账号开出的子账号默认与主账号互通数据。
    sharesParent: Boolean(parent),
  };
  list.push(account);
  save();
  return { account: publish(account, list) };
}

function canManage(actorId: string, account: Account) {
  // Use the list already loaded by the caller. Calling load() again replaces
  // that list, so the account object about to be saved is no longer in it.
  const actor = (cache || []).find((item) => item.id === actorId);
  if (!actor) return false;
  if (actor.role === "admin") return true;
  return actor.opens && account.parentId === actor.id;
}

function cachedAccount(id: string) {
  return (cache || []).find((item) => item.id === id);
}

export function setAccountEnabled(username: string, enabled: boolean, actorId: string) {
  const account = load().find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
  if (!account) return "没有这个账号";
  if (!canManage(actorId, account)) return "只能管理自己开出的子账号";
  if (account.id === actorId) return "不能停用当前登录的账号";
  if (account.role === "admin") return "不能停用管理账号";
  const current = cachedAccount(account.id);
  if (!current) return "没有这个账号";
  current.enabled = enabled;
  save();
  return null;
}

export function resetPassword(username: string, password: string, actorId: string) {
  if (password.length < 8 || password.length > 128) return "密码至少 8 位";
  const account = load().find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
  if (!account) return "没有这个账号";
  if (!canManage(actorId, account)) return "只能重置自己开出的子账号";
  if (account.role === "admin" && account.id !== actorId) return "不能修改其他管理账号的密码";
  const current = cachedAccount(account.id);
  if (!current) return "没有这个账号";
  current.passwordHash = hashPassword(password);
  save();
  return null;
}
