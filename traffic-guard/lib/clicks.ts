import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { accountById, normalizeAccountId } from "@/lib/accounts";
import { shanghaiDay } from "@/lib/day";
import { registrableHost, sameSite } from "@/lib/registrable";
import { normalizeSiteKey, siteFromHeaders } from "@/lib/site";

const ROOT = path.resolve(process.cwd(), "data", "clicks");
const ALLOW_FILE = path.resolve(process.cwd(), "data", "click-allow.txt");
const ACCOUNTS = path.resolve(process.cwd(), "data", "accounts");
const MAX_URL = 800;
const MAX_PAGE = 500;
const MAX_TEXT = 80;
const MAX_SLOT = 64;
const PAGE_SIZE = 50;

export type ClickRecord = {
  at: number;
  source: string;
  target: string;
  host: string;
  page: string;
  slot: string;
  ad: string;
  text: string;
  ip: string;
  ua: string;
  account: string;
};

type AllowRule = { host: string; exact: boolean };

let allowCache: { at: number; rules: AllowRule[]; open: boolean } | null = null;
let knownCache: { at: number; hosts: Map<string, string>; owners: Map<string, string[]> } | null = null;

function clip(input: unknown, max: number) {
  return String(input ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function httpUrl(input: unknown) {
  const raw = clip(input, MAX_URL + 40);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  const target = url.toString().slice(0, MAX_URL);
  const host = normalizeSiteKey(url.hostname);
  if (!host) return null;
  return { target, host };
}

function loadAllow(now: number) {
  if (allowCache && now - allowCache.at < 10000) return allowCache;
  const rules: AllowRule[] = [];
  let open = false;
  const lines = [
    ...(process.env.CLICK_ORIGINS || "").split(/[\s,]+/),
  ];
  if (existsSync(ALLOW_FILE)) {
    try {
      lines.push(...readFileSync(ALLOW_FILE, "utf8").split(/\r?\n/));
    } catch {
      /* an unreadable list denies rather than opening the gate */
    }
  }
  for (const line of lines) {
    const text = line.trim().toLowerCase();
    if (!text || text.startsWith("#")) continue;
    if (text === "*") {
      open = true;
      continue;
    }
    const exact = text.startsWith("=");
    const host = normalizeSiteKey(exact ? text.slice(1) : text);
    if (host) rules.push({ host, exact });
  }
  allowCache = { at: now, rules, open };
  return allowCache;
}

function knownIndex(now: number) {
  if (knownCache && now - knownCache.at < 30000) return knownCache;
  const hosts = new Map<string, string>();
  const grouped = new Map<string, string[]>();
  if (existsSync(ACCOUNTS)) {
    let accounts: string[] = [];
    try {
      accounts = readdirSync(ACCOUNTS);
    } catch {
      accounts = [];
    }
    for (const account of accounts) {
      if (!normalizeAccountId(account)) continue;
      const dir = path.join(ACCOUNTS, account, "sites");
      if (!existsSync(dir)) continue;
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        names = [];
      }
      for (const name of names) {
        const host = normalizeSiteKey(name);
        if (!host || hosts.has(host)) continue;
        hosts.set(host, account);
        const root = registrableHost(host);
        const owners = grouped.get(root);
        if (!owners) grouped.set(root, [account]);
        else if (!owners.includes(account)) owners.push(account);
      }
    }
  }
  knownCache = { at: now, hosts, owners: grouped };
  return knownCache;
}

export function originAllowed(host: string, now = Date.now()) {
  const name = normalizeSiteKey(host);
  if (!name) return false;
  const allow = loadAllow(now);
  if (allow.open) return true;
  const root = registrableHost(name);
  for (const rule of allow.rules) {
    if (rule.exact) {
      if (name === rule.host) return true;
      continue;
    }
    if (name === rule.host || root === rule.host || name.endsWith(`.${rule.host}`)) return true;
  }
  const known = knownIndex(now);
  if (known.hosts.has(name) || (root && known.owners.has(root))) return true;
  return false;
}

function accountFor(source: string, claimed: string, now: number) {
  const owners = knownIndex(now).owners.get(registrableHost(source)) || [];
  if (owners.length === 1) return owners[0];
  const id = normalizeAccountId(claimed);
  if (id && owners.includes(id)) return id;
  if (owners.length > 1) return owners[0];
  if (id && accountById(id)?.enabled) return id;
  return "";
}

export function sourceHost(headers: Headers) {
  return siteFromHeaders(headers) || "";
}

export function acceptClick(headers: Headers, input: Record<string, unknown>, ip: string, ua: string, now = Date.now()) {
  const source = sourceHost(headers);
  if (!source || !originAllowed(source, now)) return false;
  const parsed = httpUrl(input.target);
  if (!parsed || sameSite(source, parsed.host)) return false;
  const pageUrl = httpUrl(input.page);
  const record: ClickRecord = {
    at: now,
    source,
    target: parsed.target,
    host: parsed.host,
    page: pageUrl && sameSite(pageUrl.host, source) ? pageUrl.target.slice(0, MAX_PAGE) : "",
    slot: clip(input.slot, MAX_SLOT) || clip(input.text, MAX_SLOT) || parsed.host,
    ad: clip(input.ad, MAX_SLOT),
    text: clip(input.text, MAX_TEXT),
    ip: clip(ip, 64),
    ua: clip(ua, 200),
    account: accountFor(source, String(input.account || ""), now),
  };
  const day = shanghaiDay(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const file = path.join(ROOT, `${day}.jsonl`);
  mkdirSync(ROOT, { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
  trimOld(now);
  return true;
}

function trimOld(now: number) {
  const keep = Number(process.env.CLICK_KEEP_DAYS || "");
  if (!Number.isFinite(keep) || keep < 1) return;
  const cutoff = now - keep * 24 * 60 * 60 * 1000;
  let names: string[] = [];
  try {
    names = readdirSync(ROOT);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
    const file = path.join(ROOT, name);
    try {
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    } catch {
      /* a file disappearing mid-read is fine */
    }
  }
}

function readDay(day: string) {
  const file = path.join(ROOT, `${day}.jsonl`);
  if (!existsSync(file)) return [] as ClickRecord[];
  try {
    const raw = readFileSync(file, "utf8");
    const rows: ClickRecord[] = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as ClickRecord;
        if (row && typeof row.target === "string" && typeof row.source === "string") rows.push(row);
      } catch {
        /* skip a torn line */
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function eachDay(from: string, to: string) {
  const days: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return days;
  const [y, m, d] = from.split("-").map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 400; i += 1) {
    const day = cursor.toISOString().slice(0, 10);
    days.push(day);
    if (day >= to) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

type ClickTally = { count: number; ips: Set<string> };

function addClick(tally: ClickTally, ip: string) {
  tally.count += 1;
  if (ip) tally.ips.add(ip);
}

function finishTally(tally: ClickTally) {
  return { count: tally.count, ips: tally.ips.size };
}

type ClickSummary = {
  total: number;
  ips: number;
  urls: { target: string; host: string; source: string; count: number; ips: number }[];
  slots: { slot: string; source: string; count: number; ips: number }[];
  sites: { host: string; count: number; ips: number }[];
  urlTotal: number;
  slotTotal: number;
  siteTotal: number;
  page: number;
  pageSize: number;
};

const summaryCache = new Map<string, { stamp: string; value: Omit<ClickSummary, "urls" | "slots" | "sites" | "page" | "pageSize" | "pageCount"> & {
  urls: ClickSummary["urls"];
  slots: ClickSummary["slots"];
  sites: ClickSummary["sites"];
} }>();

function dayStamp(from: string, to: string) {
  const bits: string[] = [];
  for (const day of eachDay(from, to)) {
    const file = path.join(ROOT, `${day}.jsonl`);
    try {
      const stat = statSync(file);
      bits.push(`${day}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      bits.push(`${day}:0`);
    }
  }
  return bits.join("|");
}

function pageOf(value: unknown, fallback = 1) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

export function summarizeClicks(options: {
  from: string;
  to: string;
  accountIds: string[] | null;
  source?: string;
  detail?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const wanted = options.accountIds ? new Set(options.accountIds) : null;
  const source = normalizeSiteKey(options.source || "") || "";
  const detail = options.detail !== false;
  const pageSize = Math.min(200, Math.max(20, pageOf(options.pageSize, PAGE_SIZE)));
  const accountsKey = options.accountIds ? [...options.accountIds].sort().join(",") : "*";
  const cacheKey = `${options.from}\n${options.to}\n${source}\n${accountsKey}\n${detail ? "1" : "0"}`;
  const stamp = dayStamp(options.from, options.to);
  const saved = summaryCache.get(cacheKey);
  let full = saved && saved.stamp === stamp ? saved.value : null;
  if (!full) {
    const urls = new Map<string, { target: string; host: string; source: string } & ClickTally>();
    const slots = new Map<string, { slot: string; source: string } & ClickTally>();
    // 出站域名按根域名汇总，例如一堆 *.99951bb.app 合成一行 99951bb.app。
    const sites = new Map<string, { host: string } & ClickTally>();
    const allIps = new Set<string>();
    let total = 0;
    for (const day of eachDay(options.from, options.to)) {
      for (const row of readDay(day)) {
        if (wanted && !wanted.has(row.account)) continue;
        if (source && row.source !== source && !sameSite(row.source, source)) continue;
        const left = row.source || "未知站点";
        const root = registrableHost(left) || left;
        const ip = typeof row.ip === "string" ? row.ip.trim() : "";
        total += 1;
        if (ip) allIps.add(ip);
        const site = sites.get(root) || { host: root, count: 0, ips: new Set<string>() };
        addClick(site, ip);
        sites.set(root, site);
        if (!detail) continue;
        // 明细仍按具体子域名记，方便核对是哪台机器点出去的。
        const urlKey = `${left}\n${row.target}`;
        const url = urls.get(urlKey) || { target: row.target, host: row.host, source: left, count: 0, ips: new Set<string>() };
        addClick(url, ip);
        urls.set(urlKey, url);
        const slotName = row.slot || "未标广告位";
        const slotKey = `${left}\n${slotName}`;
        const slot = slots.get(slotKey) || { slot: slotName, source: left, count: 0, ips: new Set<string>() };
        addClick(slot, ip);
        slots.set(slotKey, slot);
      }
    }
    const byOutbound = <T extends { ips: number; count: number }>(list: T[]) =>
      list.sort((a, b) => b.ips - a.ips || b.count - a.count);
    full = {
      total,
      ips: allIps.size,
      urls: byOutbound([...urls.values()].map((row) => ({ target: row.target, host: row.host, source: row.source, ...finishTally(row) }))),
      slots: byOutbound([...slots.values()].map((row) => ({ slot: row.slot, source: row.source, ...finishTally(row) }))),
      sites: byOutbound([...sites.values()].map((row) => ({ host: row.host, ...finishTally(row) }))),
      urlTotal: urls.size,
      slotTotal: slots.size,
      siteTotal: sites.size,
    };
    if (summaryCache.size > 24) summaryCache.clear();
    summaryCache.set(cacheKey, { stamp, value: full });
  }
  const asked = pageOf(options.page, 1);
  const start = (asked - 1) * pageSize;
  return {
    total: full.total,
    ips: full.ips,
    urls: full.urls.slice(start, start + pageSize),
    slots: full.slots.slice(start, start + pageSize),
    sites: full.sites.slice(start, start + pageSize),
    urlTotal: full.urlTotal,
    slotTotal: full.slotTotal,
    siteTotal: full.siteTotal,
    page: asked,
    pageSize,
  };
}

export function resetClickCaches() {
  allowCache = null;
  knownCache = null;
  summaryCache.clear();
}
