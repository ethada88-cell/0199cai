/**
 * 刷量日志：把每次核验 / 关闭弹窗 / 点击写成按日 jsonl，并汇总给后台。
 * 数据目录 DATA_DIR/track/ ，默认保留 45 天。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyRequest, KIND_NAME, sourceOf, hostOf } from "./classify.mjs";
import { observe } from "./learn.mjs";

const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync("/data") ? "/data" : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const DIR = path.join(DATA_DIR, "track");
const KEEP_DAYS = 45;

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

/** 按香港日期切分日志文件，例如 2026-10-09 */
function hkDay(ts = Date.now()) {
  return new Date(ts).toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" }).slice(0, 10);
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString("sv-SE", { timeZone: "Asia/Hong_Kong" }).replace("T", " ");
}

function dayFile(day) {
  return path.join(DIR, "track-" + day + ".jsonl");
}

function sumFile(day) {
  return path.join(DIR, "sum-" + day + ".json");
}

function clip(v, n) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
}

function num(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(min, Math.min(max, n));
}

function loadSum(day) {
  try {
    const j = JSON.parse(fs.readFileSync(sumFile(day), "utf8"));
    if (j && typeof j === "object") return j;
  } catch {
    /* miss */
  }
  return {
    day,
    pv: 0,
    uv: {},
    clicks: 0,
    pages: {},
    labels: {},
    sites: {},
    sources: {},
    refs: {},
    kinds: {},
    trap: 0,
    trapClose: 0,
    fakePv: 0,
    realPv: 0,
  };
}

function saveSum(sum) {
  ensureDir();
  const tmp = sumFile(sum.day) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(sum));
  fs.renameSync(tmp, sumFile(sum.day));
}

function bump(map, key, n = 1) {
  if (!key) return;
  map[key] = (map[key] || 0) + n;
}

function pruneOld() {
  let names = [];
  try {
    names = fs.readdirSync(DIR);
  } catch {
    return;
  }
  const keep = new Set();
  const now = Date.now();
  for (let i = 0; i < KEEP_DAYS; i++) keep.add(hkDay(now - i * 86400000));
  for (const name of names) {
    const m = /^track-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name) || /^sum-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (m && !keep.has(m[1])) {
      try {
        fs.unlinkSync(path.join(DIR, name));
      } catch {
        /* ignore */
      }
    }
  }
}

let pruneAt = 0;
const queue = [];
let writing = false;

function flush() {
  if (writing || !queue.length) return;
  writing = true;
  const batch = queue.splice(0, 200);
  try {
    ensureDir();
    const byDay = new Map();
    for (const ev of batch) {
      const day = hkDay(ev.ts);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(ev);
    }
    for (const [day, rows] of byDay) {
      fs.appendFileSync(dayFile(day), rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
      const sum = loadSum(day);
      for (const ev of rows) {
        if (!sum.sources) sum.sources = {};
        if (!sum.refs) sum.refs = {};
        if (!sum.kinds) sum.kinds = {};
        if (ev.source) bump(sum.sources, ev.source);
        if (ev.refHost || ev.ref) bump(sum.refs, ev.refHost || hostOf(ev.ref) || "直接访问");
        if (ev.kind) bump(sum.kinds, ev.kind);
        if (ev.type === "page") {
          sum.pv += 1;
          if (ev.vid) sum.uv[ev.vid] = (sum.uv[ev.vid] || 0) + 1;
          bump(sum.pages, ev.pageName || ev.page);
          bump(sum.sites, ev.site || "web");
          if (
            ev.fake ||
            ev.kind === "crawler" ||
            ev.kind === "datacenter" ||
            ev.kind === "headless" ||
            ev.kind === "automation" ||
            ev.kind === "emulator" ||
            ev.kind === "learned"
          ) {
            sum.fakePv = (sum.fakePv || 0) + 1;
          } else sum.realPv = (sum.realPv || 0) + 1;
        } else if (ev.type === "click") {
          sum.clicks += 1;
          bump(sum.labels, ev.label || "未命名");
          bump(sum.pages, ev.pageName || ev.page);
          bump(sum.sites, ev.site || "web");
        } else if (ev.type === "probe" && ev.trap) {
          sum.trap = (sum.trap || 0) + 1;
        } else if (ev.type === "trap-close") {
          sum.trapClose = (sum.trapClose || 0) + 1;
        }
      }
      saveSum(sum);
    }
    if (Date.now() - pruneAt > 6 * 3600 * 1000) {
      pruneAt = Date.now();
      pruneOld();
    }
  } catch {
    /* keep going */
  }
  writing = false;
  if (queue.length) setImmediate(flush);
}

/** 清洗前端上报，丢掉后台页、非法 type */
function normalize(raw, ctx) {
  const type =
    raw &&
    (raw.type === "click" ||
      raw.type === "page" ||
      raw.type === "leave" ||
      raw.type === "probe" ||
      raw.type === "trap-close")
      ? raw.type
      : "";
  if (!type) return null;
  let page = clip(raw.page, 180);
  if (!page.startsWith("/")) page = "/" + page.replace(/^#\/?/, "");
  if (page.startsWith("/admin")) return null;
  const pageTitle = clip(raw.pageTitle || page.split("?")[0] || "/", 40);
  const site = clip(raw.site || "web", 20) || "web";
  const cls = ctx.cls || {};
  const host = ctx.host || cls.host || "";
  const rawRef = Object.prototype.hasOwnProperty.call(raw || {}, "ref") ? clip(raw.ref, 300) : "";
  const ref = rawRef || "";
  const source = sourceOf(ref, raw.utm, host);
  const kind = cls.kind || "human";
  const ev = {
    id: clip(raw.id, 40) || Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
    ts: Number(raw.ts) > 1e12 && Number(raw.ts) < Date.now() + 120000 ? Number(raw.ts) : ctx.now,
    type,
    vid: clip(raw.vid, 40),
    uid: clip(raw.uid, 40),
    page,
    pageName: pageTitle,
    site,
    siteName: site,
    label:
      clip(raw.label, 80) ||
      (type === "page"
        ? "打开页面"
        : type === "leave"
          ? "离开页面"
          : type === "probe"
            ? "埋点核验"
            : type === "trap-close"
              ? "关闭弹窗"
              : "点击"),
    tag: clip(raw.tag, 40),
    path: clip(raw.path, 220),
    href: clip(raw.href, 240),
    ref,
    refHost: hostOf(ref) || (ref ? clip(ref, 80) : "直接访问"),
    source,
    kind,
    kindName: KIND_NAME[kind] || kind,
    fake: kind !== "human",
    trap: Boolean(cls.trap && (type === "probe" || type === "trap-close" || type === "page")),
    x: Math.round(num(raw.x, 0, 4000)),
    y: Math.round(num(raw.y, 0, 8000)),
    nx: Math.round(num(raw.nx, 0, 100)),
    ny: Math.round(num(raw.ny, 0, 100)),
    vw: Math.round(num(raw.vw, 0, 4000)),
    vh: Math.round(num(raw.vh, 0, 4000)),
    sx: Math.round(num(raw.sx, 0, 20000)),
    sy: Math.round(num(raw.sy, 0, 40000)),
    ip: ctx.ip,
    ua: ctx.ua,
    fp: clip(cls.fp || raw.fp, 24),
    learnReason: clip(cls.learnReason || raw.learnReason, 80),
  };
  ev.at = fmtTime(ev.ts);
  return ev;
}

/** 接收 /api/track（关闭弹窗、点击等）。最多一次 40 条。 */
export function ingestTrack(req, body) {
  const list = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : body ? [body] : [];
  const first = list[0] || {};
  const cls = classifyRequest(req, {
    ref: body?.ref || first.ref,
    utm: body?.utm || first.utm,
    source: body?.source || first.source,
    signals: body?.signals || first.signals,
  });
  const ctx = { ip: cls.ip, ua: cls.ua, now: Date.now(), cls, host: cls.host };
  let n = 0;
  for (const raw of list.slice(0, 40)) {
    const ev = normalize(raw, ctx);
    if (!ev) continue;
    queue.push(ev);
    n += 1;
  }
  if (n) setImmediate(flush);
  return { ok: true, n };
}

/**
 * /api/probe 的处理：判定是否弹窗，并记一条 probe 日志。
 * 返回给前端的 trap 为 true 才会出「访问核验」。
 */
export function probeVisit(req, body = {}) {
  const cls = classifyRequest(req, body);
  try {
    observe(cls, body.signals || {});
  } catch {
    /* learn must not break probe */
  }
  const label = cls.fake
    ? cls.kind === "learned"
      ? "智能学习·" + (cls.learnReason || "记忆命中")
      : String(process.env.PROBE_MODE || "silent").toLowerCase() === "popup"
        ? "假量弹窗"
        : "假量检测"
    : "真实访问";
  const ev = normalize(
    {
      type: "probe",
      vid: body.vid,
      uid: body.uid,
      page: body.page || "/",
      pageTitle: body.pageTitle,
      site: body.site,
      ref: cls.ref,
      source: cls.source,
      label,
    },
    { ip: cls.ip, ua: cls.ua, now: Date.now(), cls, host: cls.host }
  );
  if (ev) {
    queue.push(ev);
    setImmediate(flush);
  }
  const mode = String(process.env.PROBE_MODE || "silent").toLowerCase();
  const showTrap = mode === "popup" && cls.trap;
  return {
    trap: showTrap,
    silent: mode !== "popup",
    kind: cls.kind,
    kindName: cls.kindName,
    source: cls.source,
    ref: cls.ref,
    refHost: hostOf(cls.ref) || "直接访问",
    fp: cls.fp || "",
    learnReason: cls.learnReason || "",
  };
}

function listDays() {
  ensureDir();
  let names = [];
  try {
    names = fs.readdirSync(DIR);
  } catch {
    names = [];
  }
  const days = [];
  for (const name of names) {
    const m = /^track-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (m) days.push(m[1]);
  }
  days.sort();
  days.reverse();
  return days;
}

function topMap(map, n = 8) {
  return Object.entries(map || {})
    .filter(([k]) => k !== "uv")
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

function readDayLines(day, max = 4000) {
  const file = dayFile(day);
  let raw = "";
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = raw.trim() ? raw.trim().split("\n") : [];
  const start = Math.max(0, lines.length - max);
  const out = [];
  for (let i = lines.length - 1; i >= start; i--) {
    try {
      const ev = JSON.parse(lines[i]);
      if (ev && ev.type) out.push(ev);
    } catch {
      /* skip */
    }
  }
  return out;
}

function matchEv(ev, q, type, page, site, kind) {
  if (type && ev.type !== type) return false;
  if (
    kind === "fake" &&
    !ev.fake &&
    ev.kind !== "crawler" &&
    ev.kind !== "datacenter" &&
    ev.kind !== "headless" &&
    ev.kind !== "automation" &&
    ev.kind !== "emulator" &&
    ev.kind !== "learned"
  )
    return false;
  if (kind && kind !== "fake" && ev.kind !== kind) return false;
  if (site && ev.site !== site) return false;
  if (page) {
    const p = String(ev.page || "");
    const n = String(ev.pageName || "");
    if (!p.includes(page) && !n.includes(page)) return false;
  }
  if (q) {
    const blob = [ev.label, ev.path, ev.href, ev.uid, ev.ip, ev.page, ev.pageName, ev.vid, ev.source, ev.ref, ev.kind, ev.kindName]
      .join(" ")
      .toLowerCase();
    if (!blob.includes(q)) return false;
  }
  return true;
}

function validDay(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
}

function daysInRange(from, to) {
  const a = Date.parse(from + "T00:00:00+08:00");
  const b = Date.parse(to + "T00:00:00+08:00");
  if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return [to];
  const out = [];
  for (let t = a; t <= b && out.length < 40; t += 86400000) out.push(hkDay(t));
  return out.length ? out : [to];
}

function mergeSum(into, add) {
  into.pv += add.pv || 0;
  into.clicks += add.clicks || 0;
  into.trap = (into.trap || 0) + (add.trap || 0);
  into.trapClose = (into.trapClose || 0) + (add.trapClose || 0);
  into.fakePv = (into.fakePv || 0) + (add.fakePv || 0);
  into.realPv = (into.realPv || 0) + (add.realPv || 0);
  for (const [k, n] of Object.entries(add.uv || {})) into.uv[k] = (into.uv[k] || 0) + n;
  for (const [k, n] of Object.entries(add.pages || {})) into.pages[k] = (into.pages[k] || 0) + n;
  for (const [k, n] of Object.entries(add.labels || {})) into.labels[k] = (into.labels[k] || 0) + n;
  for (const [k, n] of Object.entries(add.sites || {})) into.sites[k] = (into.sites[k] || 0) + n;
  if (!into.sources) into.sources = {};
  if (!into.refs) into.refs = {};
  if (!into.kinds) into.kinds = {};
  for (const [k, n] of Object.entries(add.sources || {})) into.sources[k] = (into.sources[k] || 0) + n;
  for (const [k, n] of Object.entries(add.refs || {})) into.refs[k] = (into.refs[k] || 0) + n;
  for (const [k, n] of Object.entries(add.kinds || {})) into.kinds[k] = (into.kinds[k] || 0) + n;
}

/** 后台查询：按日期、假量/真人、关键词过滤明细 */
export function adminTrack(query) {
  const to = validDay(query.to || query.day) || hkDay();
  const from = validDay(query.from) || to;
  const span = daysInRange(from, to);
  const type = String(query.type || "");
  const page = clip(query.page, 80);
  const site = String(query.site || "");
  const kind = String(query.kind || "");
  const q = clip(query.q, 80).toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(query.limit) || 80));
  const offset = Math.max(0, Number(query.offset) || 0);
  const sum = {
    pv: 0,
    uv: {},
    clicks: 0,
    pages: {},
    labels: {},
    sites: {},
    sources: {},
    refs: {},
    kinds: {},
    trap: 0,
    trapClose: 0,
    fakePv: 0,
    realPv: 0,
  };
  for (const d of span) mergeSum(sum, loadSum(d));
  const rows = span
    .flatMap((d) => readDayLines(d, span.length > 1 ? 2000 : 5000))
    .filter((ev) => matchEv(ev, q, type, page, site, kind));
  const src = {};
  const rf = {};
  for (const ev of rows) {
    bump(src, ev.source || "直接访问");
    bump(rf, ev.refHost || hostOf(ev.ref) || "直接访问");
  }
  return {
    day: to,
    from,
    to,
    days: listDays(),
    summary: {
      pv: sum.pv || 0,
      uv: Object.keys(sum.uv || {}).length,
      clicks: sum.clicks || 0,
      fakePv: sum.fakePv || 0,
      realPv: sum.realPv || 0,
      trap: sum.trap || 0,
      trapClose: sum.trapClose || 0,
      pages: topMap(sum.pages, 12),
      labels: topMap(sum.labels, 16),
      sites: topMap(sum.sites, 6),
      sources: kind || !Object.keys(sum.sources || {}).length ? topMap(src, 16) : topMap(sum.sources, 16),
      refs: kind || !Object.keys(sum.refs || {}).length ? topMap(rf, 16) : topMap(sum.refs, 16),
      kinds: topMap(sum.kinds, 8).map((x) => ({ ...x, label: KIND_NAME[x.name] || x.name })),
    },
    total: rows.length,
    items: rows.slice(offset, offset + limit),
  };
}
