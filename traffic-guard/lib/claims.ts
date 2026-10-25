import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deviceLabel, phoneMark, spoofPhone } from "@/lib/device";
import { normalizeAccountId } from "@/lib/accounts";
import type { StoredEvent } from "@/lib/types";

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const VERSION = 2;
const MAX_IPS = 200_000;
const MAX_LABELS = 12;

type Slot = { labels: string[]; counts: number[]; spoof: boolean };
type Book = Map<string, Slot>;
type FileShape = { v: number; ips: Record<string, { s: string[]; n: number[]; f?: number }> };

const books = new Map<string, Book>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function fileOf(account: string) {
  return path.join(ROOT, account, "claims.json");
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

function storedVersion(account: string) {
  const file = fileOf(account);
  if (!existsSync(file)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape;
    return parsed && parsed.v === VERSION ? VERSION : 0;
  } catch {
    return 0;
  }
}

function loadBook(account: string, book: Book) {
  if (storedVersion(account) !== VERSION) return;
  try {
    const parsed = JSON.parse(readFileSync(fileOf(account), "utf8")) as FileShape;
    if (!parsed || !parsed.ips) return;
    for (const [ip, slot] of Object.entries(parsed.ips)) {
      if (!slot || !Array.isArray(slot.s)) continue;
      book.set(ip, { labels: slot.s.slice(0, MAX_LABELS), counts: (slot.n || []).slice(0, MAX_LABELS), spoof: slot.f === 1 });
    }
  } catch {
    /* a broken file is rebuilt from events */
  }
}

function scheduleSave(account: string) {
  const pending = saveTimers.get(account);
  if (pending) clearTimeout(pending);
  saveTimers.set(account, setTimeout(() => saveBook(account), 2000));
}

function saveBook(account: string) {
  saveTimers.delete(account);
  const book = books.get(account);
  if (!book) return;
  const ips: FileShape["ips"] = {};
  for (const [ip, slot] of book) {
    if (!slot.spoof && slot.labels.length < 2) continue;
    ips[ip] = { s: slot.labels, n: slot.counts, f: slot.spoof ? 1 : 0 };
  }
  const file = fileOf(account);
  const tmp = `${file}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ v: VERSION, ips }));
    renameSync(tmp, file);
  } catch {
    /* the in-memory book still answers the page */
  }
}

function kindOf(label: string) {
  if (label.startsWith("iPhone")) return "iPhone";
  if (label.startsWith("iPad")) return "iPad";
  if (label.startsWith("鸿蒙")) return "鸿蒙";
  if (label === "Windows" || label === "Mac" || label === "Linux" || label === "云手机" || label === "模拟器" || label === "Android" || label === "Android 手机") return label;
  return "Android";
}

function evictIndex(slot: Slot, incoming: string) {
  const incomingKind = kindOf(incoming);
  const tally = new Map<string, number>();
  for (const label of slot.labels) tally.set(kindOf(label), (tally.get(kindOf(label)) || 0) + 1);
  const have = tally.get(incomingKind) || 0;
  let crowd = incomingKind;
  let crowdCount = have;
  if (have === 0) {
    crowd = "";
    crowdCount = 0;
    for (const [kind, count] of tally) {
      if (count > crowdCount) {
        crowd = kind;
        crowdCount = count;
      }
    }
    if (crowdCount <= 1) return -1;
  } else if (have <= 1) return -1;
  let evict = -1;
  let least = Infinity;
  for (let i = 0; i < slot.labels.length; i++) {
    if (kindOf(slot.labels[i]) !== crowd || (slot.counts[i] || 0) > 1) continue;
    if ((slot.counts[i] || 0) < least) {
      least = slot.counts[i] || 0;
      evict = i;
    }
  }
  return evict;
}

function addLabel(book: Book, ip: string, label: string, spoof: boolean) {
  let slot = book.get(ip);
  if (!slot) {
    if (book.size >= MAX_IPS) return;
    slot = { labels: [], counts: [], spoof: false };
    book.set(ip, slot);
  }
  const index = slot.labels.indexOf(label);
  if (index >= 0) slot.counts[index] = (slot.counts[index] || 0) + 1;
  else if (slot.labels.length < MAX_LABELS) {
    slot.labels.push(label);
    slot.counts.push(1);
  } else {
    const evict = evictIndex(slot, label);
    if (evict >= 0) {
      slot.labels[evict] = label;
      slot.counts[evict] = 1;
    }
  }
  if (spoof) slot.spoof = true;
}

export function noteClaim(event: Pick<StoredEvent, "accountId" | "ip" | "ua" | "categories">) {
  const account = normalizeAccountId(event.accountId);
  const ip = (event.ip || "").trim();
  const label = deviceLabel(event.ua || "");
  if (!account || !ip || !label) return;
  addLabel(bookOf(account), ip, label, spoofPhone(event));
  scheduleSave(account);
}

export function deviceClaim(accountId: string, ip: string) {
  const account = normalizeAccountId(accountId);
  const key = (ip || "").trim();
  if (!account || !key) return "";
  const slot = bookOf(account).get(key);
  if (!slot?.spoof || slot.labels.length === 0) return "";
  const ranked = slot.labels
    .map((label, index) => ({ label, count: slot.counts[index] || 0 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
  return phoneMark(ranked.map((item) => item.label));
}

export function warmClaims() {
  if (!existsSync(ROOT)) return;
  try {
    for (const name of readdirSync(ROOT)) {
      if (normalizeAccountId(name) === name) bookOf(name);
    }
  } catch {
    /* claims load on the first admin request */
  }
}
