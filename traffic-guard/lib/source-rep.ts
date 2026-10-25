import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAccountId } from "@/lib/accounts";
import { decayCounts } from "@/lib/rep-decay";

/**
 * 来路域名信誉：按账号记住「这个广告来路被确认假量 / 滑过放行」的次数。
 * 查账本时按约 7 天半衰期衰减；滑过会冲淡历史假量，并在占比低时给负分降权。
 */

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const VERSION = 1;
const MAX_HOSTS = 8_000;
const SAVE_MS = 2_500;

type HostStat = { fake: number; human: number; at: number };
type Book = Map<string, HostStat>;
type FileShape = { v: number; hosts: Record<string, { f: number; h: number; t: number }> };

type RunGlobal = typeof globalThis & { __tgSourceRep?: Map<string, Book>; __tgSourceRepTimers?: Map<string, ReturnType<typeof setTimeout>> };
const g = globalThis as RunGlobal;
const books = g.__tgSourceRep || (g.__tgSourceRep = new Map());
const saveTimers = g.__tgSourceRepTimers || (g.__tgSourceRepTimers = new Map());

function fileOf(account: string) {
  return path.join(ROOT, account, "source-rep.json");
}

function normalizeHost(host: string) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .slice(0, 180);
}

/** 搜索引擎/大流量入口不参与「来路信誉」抬分，避免把正常投放或自然流量误伤。 */
function trustedReferrer(host: string) {
  return /(^|\.)(baidu\.com|google\.[a-z.]+|bing\.com|so\.com|sogou\.com|sm\.cn|qq\.com|weixin\.qq\.com|toutiao\.com|bytedance\.com|douyin\.com|tiktok\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|yahoo\.[a-z.]+)$/i.test(
    host,
  );
}

function bookOf(account: string) {
  let book = books.get(account);
  if (!book) {
    book = new Map();
    books.set(account, book);
    loadBook(account, book);
  }
  return book;
}

function loadBook(account: string, book: Book) {
  const file = fileOf(account);
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    if (!parsed || parsed.v !== VERSION || !parsed.hosts) return;
    for (const [host, row] of Object.entries(parsed.hosts)) {
      if (!row || !host) continue;
      book.set(host, {
        fake: Math.max(0, Number(row.f) || 0),
        human: Math.max(0, Number(row.h) || 0),
        at: Number(row.t) || 0,
      });
    }
  } catch {
    /* 坏文件下次写入覆盖 */
  }
}

function scheduleSave(account: string) {
  const pending = saveTimers.get(account);
  if (pending) clearTimeout(pending);
  const timer = setTimeout(() => saveBook(account), SAVE_MS);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
  saveTimers.set(account, timer);
}

function saveBook(account: string) {
  saveTimers.delete(account);
  const book = books.get(account);
  if (!book) return;
  // 只留最近活跃且有反馈的来路，防止文件无限涨。
  const rows = [...book.entries()]
    .filter(([, stat]) => (stat.fake || 0) + (stat.human || 0) > 0)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, MAX_HOSTS);
  const hosts: FileShape["hosts"] = {};
  for (const [host, stat] of rows) {
    hosts[host] = { f: stat.fake, h: stat.human, t: stat.at };
  }
  const file = fileOf(account);
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ v: VERSION, hosts }));
    renameSync(tmp, file);
  } catch {
    /* 内存里的账本仍可用 */
  }
}

function effective(stat: HostStat, now = Date.now()) {
  return decayCounts(stat.fake || 0, stat.human || 0, stat.at || now, now);
}

function touch(account: string, host: string, kind: "fake" | "human") {
  const id = normalizeAccountId(account);
  const key = normalizeHost(host);
  if (!id || !key || key === "(bot)") return;
  const book = bookOf(id);
  const cur = book.get(key) || { fake: 0, human: 0, at: 0 };
  const now = Date.now();
  // 写入前先衰减，避免旧假量永远压住新滑过。
  const d = effective(cur, now);
  cur.fake = d.fake;
  cur.human = d.human;
  if (kind === "fake") {
    cur.fake += 1;
  } else {
    cur.human += 1;
    // 滑过真降权：一笔滑过冲掉一笔衰减后的历史假量。
    cur.fake = Math.max(0, cur.fake - 1);
  }
  cur.fake = Math.min(cur.fake, 50_000);
  cur.human = Math.min(cur.human, 50_000);
  cur.at = now;
  book.set(key, cur);
  scheduleSave(id);
}

/** 确认假量（滑不过 / 关掉弹窗 / 超时落下）时记一笔。 */
export function noteSourceFake(accountId: string, host: string) {
  const key = normalizeHost(host);
  if (trustedReferrer(key)) return;
  touch(accountId, host, "fake");
}

/** 滑到头放行时记一笔，用来路信誉别误伤正常广告。 */
export function noteSourceHuman(accountId: string, host: string) {
  const key = normalizeHost(host);
  if (trustedReferrer(key)) return;
  touch(accountId, host, "human");
}

export type SourceRepHint = {
  weight: number;
  label: string;
  detail: string;
  code: "bad_source" | "watch_source" | "good_source";
};

/**
 * 查来路信誉（含衰减）。样本不够返回 null。
 * 假量占比高 → 抬分；滑过占比高 → 负分降权。
 */
export function lookupSourceRep(accountId: string, host: string): SourceRepHint | null {
  const id = normalizeAccountId(accountId);
  const key = normalizeHost(host);
  if (!id || !key || trustedReferrer(key)) return null;
  const raw = bookOf(id).get(key);
  if (!raw) return null;
  const { fake, human } = effective(raw);
  const total = fake + human;
  if (total < 5) return null;
  const rate = fake / total;
  const fakeN = Math.round(fake);
  const humanN = Math.round(human);
  if (rate >= 0.85 && fake >= 15) {
    return {
      code: "bad_source",
      label: "来路信誉差",
      detail: `这个广告来路已确认假量约 ${fakeN} 次、滑过约 ${humanN} 次，假量占比 ${(rate * 100).toFixed(0)}%（已按时间衰减）`,
      weight: 55,
    };
  }
  if (rate >= 0.7 && fake >= 8) {
    return {
      code: "bad_source",
      label: "来路信誉差",
      detail: `这个广告来路已确认假量约 ${fakeN} 次、滑过约 ${humanN} 次（已按时间衰减）`,
      weight: 40,
    };
  }
  if (rate >= 0.55 && fake >= 5) {
    return {
      code: "watch_source",
      label: "来路需留意",
      detail: `这个广告来路最近假量约 ${fakeN} 次、滑过约 ${humanN} 次（已按时间衰减）`,
      weight: 25,
    };
  }
  // 常滑过：真降权，压低其它软特征分。
  if (rate <= 0.15 && human >= 20) {
    return {
      code: "good_source",
      label: "来路常滑过",
      detail: `这个广告来路滑过约 ${humanN} 次、假量约 ${fakeN} 次，假量占比 ${(rate * 100).toFixed(0)}%`,
      weight: -35,
    };
  }
  if (rate <= 0.25 && human >= 10) {
    return {
      code: "good_source",
      label: "来路常滑过",
      detail: `这个广告来路滑过约 ${humanN} 次、假量约 ${fakeN} 次，假量占比 ${(rate * 100).toFixed(0)}%`,
      weight: -20,
    };
  }
  if (rate <= 0.35 && human >= 8) {
    return {
      code: "good_source",
      label: "来路偏真实",
      detail: `这个广告来路滑过约 ${humanN} 次、假量约 ${fakeN} 次`,
      weight: -12,
    };
  }
  return null;
}
