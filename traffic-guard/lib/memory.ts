import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const FILE = path.resolve(process.cwd(), "data", "accounts", "_memory", "hits.json");
const DAY_MS = 24 * 60 * 60 * 1000;
const FAST_MS = 30 * 60 * 1000;
const MAX_HITS = 40_000;

type Hit = { at: number; ip: string; fp: string; site: string; visitor: string; pattern: string };

export type MemoryFacts = {
  ipVisits: number;
  ipVisitors: number;
  ipFingerprints: number;
  fpVisitors: number;
  deviceIps: number;
  deviceSites: number;
  ipDevices: number;
  patternSites: number;
};

type CountMap = Map<string, number>;
type FpAgg = { ips: CountMap; sites: CountMap; fastVisitors: CountMap };
type IpAgg = { visits: number; visitors: CountMap; fps: CountMap };

let hits: Hit[] = [];
let loaded = false;
let fastStart = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> = Promise.resolve();
const fpIndex = new Map<string, FpAgg>();
const ipIndex = new Map<string, IpAgg>();
const patternIndex = new Map<string, CountMap>();

function valid(item: unknown): item is Hit {
  if (!item || typeof item !== "object") return false;
  const row = item as Hit;
  return typeof row.at === "number" && typeof row.ip === "string" && typeof row.fp === "string" && typeof row.site === "string";
}

function bump(map: CountMap, key: string, delta: number) {
  const next = (map.get(key) || 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}

function rememberDay(hit: Hit) {
  if (hit.fp) {
    let agg = fpIndex.get(hit.fp);
    if (!agg) {
      agg = { ips: new Map(), sites: new Map(), fastVisitors: new Map() };
      fpIndex.set(hit.fp, agg);
    }
    bump(agg.ips, hit.ip, 1);
    bump(agg.sites, hit.site, 1);
  }
  if (hit.pattern) {
    let sites = patternIndex.get(hit.pattern);
    if (!sites) {
      sites = new Map();
      patternIndex.set(hit.pattern, sites);
    }
    bump(sites, hit.site, 1);
  }
}

function rememberFast(hit: Hit) {
  if (hit.fp) {
    const agg = fpIndex.get(hit.fp);
    if (agg) bump(agg.fastVisitors, hit.visitor || hit.fp, 1);
  }
  let agg = ipIndex.get(hit.ip);
  if (!agg) {
    agg = { visits: 0, visitors: new Map(), fps: new Map() };
    ipIndex.set(hit.ip, agg);
  }
  agg.visits += 1;
  bump(agg.visitors, hit.visitor || hit.fp || hit.ip, 1);
  if (hit.fp) bump(agg.fps, hit.fp, 1);
}

function forgetFast(hit: Hit) {
  if (hit.fp) {
    const agg = fpIndex.get(hit.fp);
    if (agg) bump(agg.fastVisitors, hit.visitor || hit.fp, -1);
  }
  const agg = ipIndex.get(hit.ip);
  if (!agg) return;
  agg.visits -= 1;
  bump(agg.visitors, hit.visitor || hit.fp || hit.ip, -1);
  if (hit.fp) bump(agg.fps, hit.fp, -1);
  if (agg.visits <= 0) ipIndex.delete(hit.ip);
}

function forgetDay(hit: Hit) {
  if (hit.fp) {
    const agg = fpIndex.get(hit.fp);
    if (agg) {
      bump(agg.ips, hit.ip, -1);
      bump(agg.sites, hit.site, -1);
      if (!agg.ips.size && !agg.sites.size && !agg.fastVisitors.size) fpIndex.delete(hit.fp);
    }
  }
  if (!hit.pattern) return;
  const sites = patternIndex.get(hit.pattern);
  if (!sites) return;
  bump(sites, hit.site, -1);
  if (!sites.size) patternIndex.delete(hit.pattern);
}

function indexAll(now: number) {
  fpIndex.clear();
  ipIndex.clear();
  patternIndex.clear();
  fastStart = 0;
  const fastCut = now - FAST_MS;
  for (let i = 0; i < hits.length; i += 1) {
    const hit = hits[i];
    rememberDay(hit);
    if (hit.at < fastCut) fastStart = i + 1;
    else rememberFast(hit);
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  if (!existsSync(FILE)) return;
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return;
    hits = parsed.filter(valid).slice(-MAX_HITS);
  } catch {
    hits = [];
  }
  indexAll(Date.now());
}

function save() {
  const payload = JSON.stringify(hits);
  writing = writing
    .catch(() => undefined)
    .then(() => writeFile(FILE, payload))
    .then(() => undefined)
    .catch(() => undefined);
}

function scheduleSave() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    mkdirSync(path.dirname(FILE), { recursive: true });
    save();
  }, 8000);
  if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
}

function expire(now: number) {
  const fastCut = now - FAST_MS;
  while (fastStart < hits.length && hits[fastStart].at < fastCut) {
    forgetFast(hits[fastStart]);
    fastStart += 1;
  }
  const dayCut = now - DAY_MS;
  let drop = 0;
  while (drop < hits.length && hits[drop].at < dayCut) drop += 1;
  if (hits.length - drop > MAX_HITS) drop = hits.length - MAX_HITS;
  for (let i = 0; i < drop; i += 1) {
    if (i >= fastStart) forgetFast(hits[i]);
    forgetDay(hits[i]);
  }
  if (!drop) return;
  hits.splice(0, drop);
  fastStart = Math.max(0, fastStart - drop);
}

function factsFor(ip: string, fp: string, pattern: string): MemoryFacts {
  const device = fp ? fpIndex.get(fp) : undefined;
  const recent = ipIndex.get(ip);
  const sites = pattern ? patternIndex.get(pattern) : undefined;
  const fingerprints = recent?.fps.size || 0;
  return {
    ipVisits: recent?.visits || 0,
    ipVisitors: recent?.visitors.size || 0,
    ipFingerprints: fingerprints,
    fpVisitors: device?.fastVisitors.size || 0,
    deviceIps: device?.ips.size || 0,
    deviceSites: device?.sites.size || 0,
    ipDevices: fingerprints,
    patternSites: sites?.size || 0,
  };
}

export function observeMemory(
  ip: string,
  fp: string,
  site: string,
  visitor: string,
  pattern: string,
  record: boolean,
): MemoryFacts {
  load();
  const now = Date.now();
  expire(now);
  if (record) {
    const hit: Hit = {
      at: now,
      ip: ip || "",
      fp: fp || "",
      site: site || "",
      visitor: (visitor || fp || "unknown").slice(0, 40),
      pattern: pattern || "",
    };
    hits.push(hit);
    rememberDay(hit);
    rememberFast(hit);
    scheduleSave();
  } else if (pattern) {
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i];
      if (now - hit.at >= 20_000) break;
      if (hit.fp === fp && hit.ip === ip && hit.site === site) {
        if (hit.pattern !== pattern) {
          if (hit.pattern) {
            const prev = patternIndex.get(hit.pattern);
            if (prev) {
              bump(prev, hit.site, -1);
              if (!prev.size) patternIndex.delete(hit.pattern);
            }
          }
          hit.pattern = pattern;
          let sites = patternIndex.get(pattern);
          if (!sites) {
            sites = new Map();
            patternIndex.set(pattern, sites);
          }
          bump(sites, hit.site, 1);
          scheduleSave();
        }
        break;
      }
    }
  }
  return factsFor(ip, fp, pattern);
}
