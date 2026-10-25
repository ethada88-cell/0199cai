import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { matchNetwork } from "@/lib/ip";

type SearcherLike = {
  search: (ip: string) => Promise<{ region?: string } | string>;
};

let searcher: SearcherLike | null = null;
let loadFailed = false;
const cache = new Map<string, string>();

function dbPath() {
  const local = path.join(process.cwd(), "data", "ip2region.xdb");
  if (existsSync(local)) return local;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("ip2region-ts") as { defaultDbFile?: string };
    if (mod.defaultDbFile && existsSync(mod.defaultDbFile)) return mod.defaultDbFile;
  } catch {
    /* optional */
  }
  return "";
}

function getSearcher(): SearcherLike | null {
  if (searcher || loadFailed) return searcher;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Searcher = require("ip2region-ts") as {
      defaultDbFile: string;
      loadContentFromFile: (file: string) => Buffer;
      newWithBuffer: (buf: Buffer) => SearcherLike;
    };
    const file = dbPath() || Searcher.defaultDbFile;
    const buf = Searcher.loadContentFromFile(file);
    searcher = Searcher.newWithBuffer(buf);
    return searcher;
  } catch {
    loadFailed = true;
    return null;
  }
}

/** 中国|0|江苏省|苏州市|电信 → 江苏 苏州 电信 */
export function formatIp2Region(raw: string) {
  const segs = String(raw || "").split("|").map((s) => s.trim());
  while (segs.length < 5) segs.push("");
  const country = segs[0] && segs[0] !== "0" ? segs[0] : "";
  const province = segs[2] && segs[2] !== "0" ? segs[2] : "";
  const city = segs[3] && segs[3] !== "0" && segs[3] !== "内网IP" ? segs[3] : "";
  const isp = segs[4] && segs[4] !== "0" && segs[4] !== "内网IP" ? segs[4] : "";

  const stem = (value: string) => value.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔)$/g, "");
  let place: string[] = [];
  if (province && city) {
    if (city === province || city.startsWith(stem(province)) || province.startsWith(stem(city))) {
      place = [city];
    } else {
      place = [province, city];
    }
  } else if (province || city) {
    place = [province || city];
  } else if (country) {
    place = [country];
  }
  if (country && country !== "中国" && !place.includes(country)) {
    place = [country, ...place];
  }
  if (isp) place.push(isp);
  return place.join(" ").replace(/\s+/g, " ").trim();
}

async function rawRegion(ip: string) {
  const engine = getSearcher();
  if (!engine) return "";
  try {
    const hit = await engine.search(ip);
    if (typeof hit === "string") return hit;
    return String(hit?.region || "");
  } catch {
    return "";
  }
}

/** 归属地文案，如「北京市 联通」；机房/代理时附带出口类型。 */
export async function lookupIpRegion(ip: string) {
  const key = String(ip || "").trim();
  if (!key || key === "—" || key === "0.0.0.0") return "";
  const cached = cache.get(key);
  if (cached != null) return cached;

  const geo = formatIp2Region(await rawRegion(key));
  const net = matchNetwork(key);
  let text = geo;
  if (net) {
    const tag = net.kind === "proxy" ? "代理" : "机房";
    const name = net.provider && net.provider !== "IDC" ? net.provider : "";
    const extra = name ? `${tag} ${name}` : tag;
    text = text ? `${text} · ${extra}` : extra;
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(key, text);
  return text;
}

export async function lookupIpRegions(ips: string[]) {
  const unique = [...new Set(ips.map((ip) => String(ip || "").trim()).filter(Boolean))];
  await Promise.all(unique.map((ip) => lookupIpRegion(ip)));
  const out: Record<string, string> = {};
  for (const ip of unique) out[ip] = cache.get(ip) || "";
  return out;
}

/** Warm the searcher so first admin page is not cold. */
export function warmIpGeo() {
  try {
    getSearcher();
    const file = dbPath();
    if (file) readFileSync(file);
  } catch {
    /* optional */
  }
}
