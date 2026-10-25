import { readFileSync } from "node:fs";
import path from "node:path";

type Packed = [number, number, string, number];
type Ranged = { start: number; end: number; provider: string; proxy: number; order: number };

let packed: Ranged[] | null = null;
let maxSpan = 1;

function ranges(): Ranged[] {
  if (!packed) {
    const file = path.join(process.cwd(), "data", "ip-ranges.json");
    const list = JSON.parse(readFileSync(file, "utf8")) as Packed[];
    const indexed = list.map((item, order) => ({
      start: item[0],
      end: item[1],
      provider: item[2],
      proxy: item[3],
      order,
    }));
    indexed.sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order);
    maxSpan = 1;
    for (const item of indexed) {
      const span = item.end - item.start;
      if (span > maxSpan) maxSpan = span;
    }
    packed = indexed;
  }
  return packed;
}

export function ipToInt(ip: string): number | null {
  const clean = ip.trim().replace(/^::ffff:/i, "");
  const parts = clean.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const x = Number(part);
    if (x > 255) return null;
    n = n * 256 + x;
  }
  return n >>> 0;
}

type V6Range = { start: bigint; end: bigint; provider: string; proxy: number; span: bigint };

let v6packed: V6Range[] | null = null;
const B0 = BigInt(0);
const B1 = BigInt(1);
const B16 = BigInt(16);
const B128 = BigInt(128);
const B121 = BigInt(121);
const B118 = BigInt(118);
const ULA = BigInt("126");
const LINK = BigInt("1018");
let v6MaxSpan = B1;

function parseIpv6(input: string): bigint | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);
  if (!text.includes(":")) return null;
  const mapped = text.includes(".");
  let v4 = 0;
  if (mapped) {
    const last = text.lastIndexOf(":");
    const tail = ipToInt(text.slice(last + 1));
    if (tail == null) return null;
    v4 = tail;
    text = `${text.slice(0, last)}:`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  let value = B0;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << B16) + BigInt(parseInt(group, 16));
  }
  if (mapped) value = (value & ~BigInt("4294967295")) + BigInt(v4);
  return value;
}

function cidrRange(cidr: string): { start: bigint; end: bigint } | null {
  const [addr, bitsRaw] = cidr.split("/");
  const start = parseIpv6(addr || "");
  const bits = Number(bitsRaw);
  if (start == null || !Number.isInteger(bits) || bits < 0 || bits > 128) return null;
  const host = bits === 128 ? B0 : (B1 << BigInt(128 - bits)) - B1;
  const mask = bits === 0 ? B0 : ((B1 << B128) - B1) ^ host;
  const network = start & mask;
  return { start: network, end: network + host };
}

function v6ranges(): V6Range[] {
  if (v6packed) return v6packed;
  const file = path.join(process.cwd(), "data", "ipv6-ranges.json");
  const list = JSON.parse(readFileSync(file, "utf8")) as [string, string, number][];
  const indexed: V6Range[] = [];
  for (const [cidr, provider, proxy] of list) {
    const range = cidrRange(cidr);
    if (!range) continue;
    const span = range.end - range.start;
    if (span > v6MaxSpan) v6MaxSpan = span;
    indexed.push({ start: range.start, end: range.end, provider, proxy, span });
  }
  indexed.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.span < b.span ? -1 : 1));
  v6packed = indexed;
  return v6packed;
}

function matchV6(ip: bigint): { provider: string; kind: "datacenter" | "proxy" } | null {
  const list = v6ranges();
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= ip) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  let best: { provider: string; kind: "datacenter" | "proxy"; span: bigint } | null = null;
  const minStart = ip - v6MaxSpan;
  for (let i = found; i >= 0; i -= 1) {
    const item = list[i];
    if (item.start < minStart) break;
    if (ip > item.end) continue;
    if (!best || item.span < best.span) best = { provider: item.provider, kind: item.proxy ? "proxy" : "datacenter", span: item.span };
  }
  if (!best) return null;
  return { provider: best.provider, kind: best.kind };
}

export function isPrivateIp(ip: string): boolean {
  const n = ipToInt(ip);
  if (n != null) {
    const a = (n >>> 24) & 255;
    const b = (n >>> 16) & 255;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  const v6 = parseIpv6(ip);
  if (v6 == null) return false;
  if (v6 === B1) return true;
  if (v6 >> B121 === ULA) return true;
  if (v6 >> B118 === LINK) return true;
  return false;
}

export function matchNetwork(ip: string): { provider: string; kind: "datacenter" | "proxy" } | null {
  const mapped = ip.trim().toLowerCase();
  const v6 = mapped.includes(":") ? parseIpv6(mapped) : null;
  if (v6 != null && !mapped.startsWith("::ffff:")) return matchV6(v6);
  const n = ipToInt(ip);
  if (n == null) return null;
  const list = ranges();
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= n) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  let best: { provider: string; kind: "datacenter" | "proxy"; span: number; order: number } | null = null;
  const minStart = n - maxSpan;
  for (let i = found; i >= 0; i -= 1) {
    const { start, end, provider, proxy, order } = list[i];
    if (start < minStart) break;
    if (n > end) continue;
    const span = end - start;
    if (!best || span < best.span || (span === best.span && order < best.order)) {
      best = { provider, kind: proxy ? "proxy" : "datacenter", span, order };
    }
  }
  if (!best) return null;
  return { provider: best.provider, kind: best.kind };
}

function looksLikeIp(ip: string) {
  return ipToInt(ip) != null || parseIpv6(ip) != null;
}

export function clientIp(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for") || "";
  const candidates = [
    headerList.get("cf-connecting-ip") || "",
    headerList.get("x-real-ip") || "",
    ...forwarded.split(","),
  ];
  const cleaned = candidates.map((raw) => raw.trim().replace(/^::ffff:/i, "")).filter(Boolean);
  for (const ip of cleaned) {
    if (looksLikeIp(ip) && !isPrivateIp(ip)) return ip;
  }
  for (const ip of cleaned) {
    if (looksLikeIp(ip)) return ip;
  }
  return "0.0.0.0";
}
