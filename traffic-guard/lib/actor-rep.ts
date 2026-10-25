import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAccountId } from "@/lib/accounts";
import { isPrivateIp } from "@/lib/ip";
import { decayCounts } from "@/lib/rep-decay";

/**
 * 出口 IP / 设备指纹信誉：确认假量与滑过会写进账号账本。
 * 查账本时按约 7 天半衰期衰减；滑过冲淡历史假量，占比低时负分降权。
 */

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const VERSION = 1;
const MAX_KEYS = 12_000;
const SAVE_MS = 2_500;

type Stat = { fake: number; human: number; at: number };
type Book = { ips: Map<string, Stat>; fps: Map<string, Stat> };
type FileShape = {
  v: number;
  ips: Record<string, { f: number; h: number; t: number }>;
  fps: Record<string, { f: number; h: number; t: number }>;
};

type RunGlobal = typeof globalThis & {
  __tgActorRep?: Map<string, Book>;
  __tgActorRepTimers?: Map<string, ReturnType<typeof setTimeout>>;
};
const g = globalThis as RunGlobal;
const books = g.__tgActorRep || (g.__tgActorRep = new Map());
const saveTimers = g.__tgActorRepTimers || (g.__tgActorRepTimers = new Map());

function fileOf(account: string) {
  return path.join(ROOT, account, "actor-rep.json");
}

function bookOf(account: string): Book {
  let book = books.get(account);
  if (!book) {
    book = { ips: new Map(), fps: new Map() };
    books.set(account, book);
    loadBook(account, book);
  }
  return book;
}

function loadMap(raw: FileShape["ips"] | undefined, into: Map<string, Stat>) {
  if (!raw) return;
  for (const [key, row] of Object.entries(raw)) {
    if (!key || !row) continue;
    into.set(key, {
      fake: Math.max(0, Number(row.f) || 0),
      human: Math.max(0, Number(row.h) || 0),
      at: Number(row.t) || 0,
    });
  }
}

function loadBook(account: string, book: Book) {
  const file = fileOf(account);
  if (!existsSync(file)) return;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    if (!parsed || parsed.v !== VERSION) return;
    loadMap(parsed.ips, book.ips);
    loadMap(parsed.fps, book.fps);
  } catch {
    /* 坏文件下次覆盖 */
  }
}

function dumpMap(map: Map<string, Stat>) {
  const rows = [...map.entries()]
    .filter(([, stat]) => (stat.fake || 0) + (stat.human || 0) > 0)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, MAX_KEYS);
  const out: FileShape["ips"] = {};
  for (const [key, stat] of rows) out[key] = { f: stat.fake, h: stat.human, t: stat.at };
  return out;
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
  const file = fileOf(account);
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ v: VERSION, ips: dumpMap(book.ips), fps: dumpMap(book.fps) }));
    renameSync(tmp, file);
  } catch {
    /* 内存账本仍可用 */
  }
}

function effective(stat: Stat, now = Date.now()) {
  return decayCounts(stat.fake || 0, stat.human || 0, stat.at || now, now);
}

function touch(map: Map<string, Stat>, key: string, kind: "fake" | "human") {
  const cur = map.get(key) || { fake: 0, human: 0, at: 0 };
  const now = Date.now();
  const d = effective(cur, now);
  cur.fake = d.fake;
  cur.human = d.human;
  if (kind === "fake") {
    cur.fake += 1;
  } else {
    cur.human += 1;
    cur.fake = Math.max(0, cur.fake - 1);
  }
  cur.fake = Math.min(cur.fake, 50_000);
  cur.human = Math.min(cur.human, 50_000);
  cur.at = now;
  map.set(key, cur);
}

function hintOf(
  stat: Stat | undefined,
  kind: "ip" | "fp",
): { code: string; label: string; detail: string; weight: number } | null {
  if (!stat) return null;
  const { fake, human } = effective(stat);
  const total = fake + human;
  // IP 共用出口多，门槛更高；设备指纹稍低。
  const minTotal = kind === "ip" ? 8 : 5;
  const hardFake = kind === "ip" ? 20 : 12;
  const midFake = kind === "ip" ? 12 : 8;
  const softFake = kind === "ip" ? 8 : 5;
  if (total < minTotal) return null;
  const rate = fake / total;
  const name = kind === "ip" ? "出口" : "设备";
  const fakeN = Math.round(fake);
  const humanN = Math.round(human);
  if (rate >= 0.85 && fake >= hardFake) {
    return {
      code: kind === "ip" ? "bad_ip" : "bad_device",
      label: `${name}信誉差`,
      detail: `这个${name}已确认假量约 ${fakeN} 次、滑过约 ${humanN} 次，假量占比 ${(rate * 100).toFixed(0)}%（已按时间衰减）`,
      weight: 50,
    };
  }
  if (rate >= 0.75 && fake >= midFake) {
    return {
      code: kind === "ip" ? "bad_ip" : "bad_device",
      label: `${name}信誉差`,
      detail: `这个${name}已确认假量约 ${fakeN} 次、滑过约 ${humanN} 次（已按时间衰减）`,
      weight: 35,
    };
  }
  if (rate >= 0.6 && fake >= softFake) {
    return {
      code: kind === "ip" ? "watch_ip" : "watch_device",
      label: `${name}需留意`,
      detail: `这个${name}最近假量约 ${fakeN} 次、滑过约 ${humanN} 次（已按时间衰减）`,
      weight: 22,
    };
  }
  const goodMinHuman = kind === "ip" ? 12 : 8;
  if (rate <= 0.2 && human >= goodMinHuman) {
    return {
      code: kind === "ip" ? "good_ip" : "good_device",
      label: `${name}常滑过`,
      detail: `这个${name}滑过约 ${humanN} 次、假量约 ${fakeN} 次，假量占比 ${(rate * 100).toFixed(0)}%`,
      weight: kind === "ip" ? -18 : -22,
    };
  }
  if (rate <= 0.35 && human >= (kind === "ip" ? 8 : 6)) {
    return {
      code: kind === "ip" ? "good_ip" : "good_device",
      label: `${name}偏真实`,
      detail: `这个${name}滑过约 ${humanN} 次、假量约 ${fakeN} 次`,
      weight: -10,
    };
  }
  return null;
}

export function noteActorFake(accountId: string, ip: string, fp: string) {
  const id = normalizeAccountId(accountId);
  if (!id) return;
  const book = bookOf(id);
  const address = (ip || "").trim();
  if (address && !isPrivateIp(address) && address !== "0.0.0.0") {
    touch(book.ips, address, "fake");
  }
  const device = (fp || "").trim().slice(0, 32);
  if (device) touch(book.fps, device, "fake");
  scheduleSave(id);
}

export function noteActorHuman(accountId: string, ip: string, fp: string) {
  const id = normalizeAccountId(accountId);
  if (!id) return;
  const book = bookOf(id);
  const address = (ip || "").trim();
  if (address && !isPrivateIp(address) && address !== "0.0.0.0") {
    touch(book.ips, address, "human");
  }
  const device = (fp || "").trim().slice(0, 32);
  if (device) touch(book.fps, device, "human");
  scheduleSave(id);
}

export function lookupActorRep(accountId: string, ip: string, fp: string) {
  const id = normalizeAccountId(accountId);
  if (!id) return [] as Array<{ code: string; label: string; detail: string; weight: number }>;
  const book = bookOf(id);
  const out: Array<{ code: string; label: string; detail: string; weight: number }> = [];
  const address = (ip || "").trim();
  if (address && !isPrivateIp(address)) {
    const hit = hintOf(book.ips.get(address), "ip");
    if (hit) out.push(hit);
  }
  const device = (fp || "").trim().slice(0, 32);
  if (device) {
    const hit = hintOf(book.fps.get(device), "fp");
    if (hit) out.push(hit);
  }
  return out;
}
