/**
 * 假量自学习：用历史命中 + 后台纠错，越用越准。
 *
 * 机制：
 * 1. 每次 /api/probe 判定后写入记忆（IP / UA摘要 / 设备指纹）
 * 2. 同一指纹或 IP 多次假量 → 自动拉黑，下次即使静态规则漏掉也会判假
 * 3. 后台「标为假量 / 标为真人」立即强化或豁免（豁免不覆盖爬虫 UA 等硬规则）
 * 4. 长期不活跃的条目自动衰减删除
 *
 * 数据：DATA_DIR/learn/memory.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR =
  process.env.DATA_DIR ||
  (fs.existsSync("/data") ? "/data" : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data"));
const DIR = path.join(DATA_DIR, "learn");
const FILE = path.join(DIR, "memory.json");

/** 指纹假量次数达到此值 → 自动拉黑 */
const FP_FAKE_PROMOTE = Number(process.env.LEARN_FP_PROMOTE || 3);
/** IP 在窗口内假量次数 → 自动拉黑 */
const IP_FAKE_PROMOTE = Number(process.env.LEARN_IP_PROMOTE || 5);
/** 记忆保留天数 */
const KEEP_DAYS = Number(process.env.LEARN_KEEP_DAYS || 45);

let mem = null;
let dirty = false;
let saveTimer = null;

function ensureDir() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function emptyMem() {
  return {
    version: 1,
    updatedAt: Date.now(),
    ips: {}, // ip -> { fake, human, block, allow, last, note }
    uas: {}, // uaHash -> { fake, human, block, allow, sample, last }
    fps: {}, // fp -> { fake, human, block, allow, sample, last, features }
    stats: { observes: 0, autoBlocks: 0, feedbackFeedback: 0, learnedHits: 0 },
  };
}

function load() {
  if (mem) return mem;
  ensureDir();
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (j && typeof j === "object") {
      mem = { ...emptyMem(), ...j, ips: j.ips || {}, uas: j.uas || {}, fps: j.fps || {}, stats: { ...emptyMem().stats, ...(j.stats || {}) } };
      return mem;
    }
  } catch {
    /* miss */
  }
  mem = emptyMem();
  return mem;
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    try {
      ensureDir();
      const m = load();
      m.updatedAt = Date.now();
      const tmp = FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(m));
      fs.renameSync(tmp, FILE);
      dirty = false;
    } catch (e) {
      console.error("learn save failed", e.message);
    }
  }, 800);
}

function sha(s) {
  return crypto.createHash("sha1").update(String(s || "")).digest("hex").slice(0, 16);
}

/** 设备指纹：跨 IP 仍可识别同一刷量环境 */
export function deviceFingerprint(ua, signals = {}) {
  const s = signals && typeof signals === "object" ? signals : {};
  const uaFamily = String(s.uaFull || ua || "")
    .replace(/\d+\.\d+\.\d+\.\d+/g, "x")
    .replace(/Chrome\/[\d.]+/g, "Chrome/x")
    .replace(/Safari\/[\d.]+/g, "Safari/x")
    .replace(/Firefox\/[\d.]+/g, "Firefox/x")
    .slice(0, 160);
  const parts = [
    uaFamily,
    s.webgl || "",
    s.webglVendor || "",
    s.platform || "",
    s.screen || "",
    s.dpr || "",
    s.hw || "",
    s.touch || "",
    s.mem || "",
    s.uaMobile ? "m" : "d",
  ];
  return sha(parts.join("|"));
}

function uaHash(ua, signals = {}) {
  return sha(String((signals && signals.uaFull) || ua || "").slice(0, 240));
}

function prune() {
  const m = load();
  const cut = Date.now() - KEEP_DAYS * 86400000;
  for (const bag of [m.ips, m.uas, m.fps]) {
    for (const [k, v] of Object.entries(bag)) {
      if (!v || (v.last || 0) < cut) delete bag[k];
    }
  }
  // 控制体积
  for (const [name, bag] of [
    ["ips", m.ips],
    ["uas", m.uas],
    ["fps", m.fps],
  ]) {
    const keys = Object.keys(bag);
    if (keys.length <= 8000) continue;
    keys
      .sort((a, b) => (bag[a].last || 0) - (bag[b].last || 0))
      .slice(0, keys.length - 6000)
      .forEach((k) => delete bag[k]);
  }
  scheduleSave();
}

function bumpEntry(bag, key, patch) {
  if (!key) return null;
  const cur = bag[key] || { fake: 0, human: 0, block: false, allow: false, last: 0 };
  Object.assign(cur, patch);
  cur.last = Date.now();
  bag[key] = cur;
  return cur;
}

/**
 * 静态规则判定之后调用：用记忆决定是否升级为假量。
 * 硬规则已是假量时，只记观察、不降级。
 * 后台 allow 仅在「非硬假量」时保护为真人。
 */
export function applyLearning(cls, signals = {}) {
  const m = load();
  const ip = cls.ip || "";
  const ua = cls.ua || "";
  const fp = deviceFingerprint(ua, signals);
  const uh = uaHash(ua, signals);
  const ipE = m.ips[ip];
  const uaE = m.uas[uh];
  const fpE = m.fps[fp];

  // 人工豁免：只挡「学习升级」，不挡爬虫/无头等硬假量
  const hardFake = cls.kind && cls.kind !== "human" && cls.kind !== "learned";
  if (!hardFake && ((ipE && ipE.allow) || (uaE && uaE.allow) || (fpE && fpE.allow))) {
    return {
      ...cls,
      kind: "human",
      kindName: "真实用户",
      fake: false,
      trap: false,
      learned: false,
      learnReason: "人工豁免",
      fp,
    };
  }

  if (cls.fake) {
    return { ...cls, learned: false, fp };
  }

  const reasons = [];
  if (ipE && ipE.block) reasons.push("学习IP");
  if (uaE && uaE.block) reasons.push("学习UA");
  if (fpE && fpE.block) reasons.push("学习指纹");

  // 未拉黑但近期假量很密：软升级
  if (!reasons.length) {
    if (fpE && (fpE.fake || 0) >= FP_FAKE_PROMOTE - 1 && (fpE.fake || 0) > (fpE.human || 0)) reasons.push("指纹高频假量");
    if (ipE && (ipE.fake || 0) >= IP_FAKE_PROMOTE - 1 && (ipE.fake || 0) > (ipE.human || 0) * 2) reasons.push("IP高频假量");
  }

  if (!reasons.length) return { ...cls, learned: false, fp };

  m.stats.learnedHits = (m.stats.learnedHits || 0) + 1;
  scheduleSave();
  return {
    ...cls,
    kind: "learned",
    kindName: "智能学习",
    fake: true,
    trap: true,
    learned: true,
    learnReason: reasons.join("+"),
    fp,
  };
}

/** 判定完成后写入记忆，并自动晋升拉黑 */
export function observe(cls, signals = {}) {
  const m = load();
  m.stats.observes = (m.stats.observes || 0) + 1;
  const ip = cls.ip || "";
  const ua = cls.ua || "";
  const fp = cls.fp || deviceFingerprint(ua, signals);
  const uh = uaHash(ua, signals);
  const fake = Boolean(cls.fake);

  const ipE = bumpEntry(m.ips, ip, {});
  if (ipE) {
    if (fake) ipE.fake = (ipE.fake || 0) + 1;
    else ipE.human = (ipE.human || 0) + 1;
    if (!ipE.allow && !ipE.block && (ipE.fake || 0) >= IP_FAKE_PROMOTE && (ipE.fake || 0) >= (ipE.human || 0) * 2) {
      ipE.block = true;
      ipE.note = ipE.note || "auto:IP假量累计";
      m.stats.autoBlocks = (m.stats.autoBlocks || 0) + 1;
    }
  }

  const uaE = bumpEntry(m.uas, uh, { sample: String(ua).slice(0, 160) });
  if (uaE) {
    if (fake) uaE.fake = (uaE.fake || 0) + 1;
    else uaE.human = (uaE.human || 0) + 1;
    if (!uaE.allow && !uaE.block && (uaE.fake || 0) >= FP_FAKE_PROMOTE && (uaE.fake || 0) > (uaE.human || 0)) {
      uaE.block = true;
      uaE.note = uaE.note || "auto:UA假量累计";
      m.stats.autoBlocks = (m.stats.autoBlocks || 0) + 1;
    }
  }

  const s = signals || {};
  const fpE = bumpEntry(m.fps, fp, {
    sample: [s.webgl, s.platform, s.screen].filter(Boolean).join(" · ").slice(0, 160),
    features: {
      webgl: String(s.webgl || "").slice(0, 80),
      platform: String(s.platform || "").slice(0, 40),
      screen: String(s.screen || "").slice(0, 20),
    },
  });
  if (fpE) {
    if (fake) fpE.fake = (fpE.fake || 0) + 1;
    else fpE.human = (fpE.human || 0) + 1;
    if (!fpE.allow && !fpE.block && (fpE.fake || 0) >= FP_FAKE_PROMOTE && (fpE.fake || 0) > (fpE.human || 0)) {
      fpE.block = true;
      fpE.note = fpE.note || "auto:指纹假量累计";
      m.stats.autoBlocks = (m.stats.autoBlocks || 0) + 1;
    }
  }

  // 偶尔清理
  if (m.stats.observes % 200 === 0) prune();
  scheduleSave();
  return { fp, ipBlocked: !!(ipE && ipE.block), fpBlocked: !!(fpE && fpE.block) };
}

/**
 * 后台纠错反馈。
 * label: fake | human
 */
export function feedback({ ip = "", ua = "", fp = "", label, note = "" } = {}) {
  const m = load();
  const lab = String(label || "");
  if (lab !== "fake" && lab !== "human") throw Object.assign(new Error("label 必须是 fake 或 human"), { status: 400 });
  m.stats.adminFeedback = (m.stats.adminFeedback || 0) + 1;
  const uh = ua ? uaHash(ua, {}) : "";
  const targets = [];
  if (ip) targets.push(["ips", ip]);
  if (uh) targets.push(["uas", uh]);
  if (fp) targets.push(["fps", fp]);
  if (!targets.length) throw Object.assign(new Error("需要 ip / ua / fp 至少一项"), { status: 400 });

  for (const [bagName, key] of targets) {
    const bag = m[bagName];
    const e = bumpEntry(bag, key, { sample: ua ? String(ua).slice(0, 160) : bag[key]?.sample, note: String(note || "").slice(0, 80) });
    if (!e) continue;
    if (lab === "fake") {
      e.fake = (e.fake || 0) + 3;
      e.block = true;
      e.allow = false;
      e.note = e.note || "admin:标为假量";
    } else {
      e.human = (e.human || 0) + 3;
      e.allow = true;
      e.block = false;
      e.note = e.note || "admin:标为真人";
    }
  }
  scheduleSave();
  return summary();
}

export function removeLearned({ type, key } = {}) {
  const m = load();
  const bag = type === "ip" ? m.ips : type === "ua" ? m.uas : type === "fp" ? m.fps : null;
  if (!bag || !key) throw Object.assign(new Error("参数错误"), { status: 400 });
  delete bag[key];
  scheduleSave();
  return summary();
}

function topBlocked(bag, n = 12) {
  return Object.entries(bag)
    .filter(([, v]) => v && (v.block || v.allow))
    .sort((a, b) => (b[1].last || 0) - (a[1].last || 0))
    .slice(0, n)
    .map(([id, v]) => ({
      id,
      block: !!v.block,
      allow: !!v.allow,
      fake: v.fake || 0,
      human: v.human || 0,
      sample: v.sample || "",
      note: v.note || "",
      last: v.last || 0,
    }));
}

export function summary() {
  const m = load();
  const countBlock = (bag) => Object.values(bag).filter((v) => v && v.block).length;
  const countAllow = (bag) => Object.values(bag).filter((v) => v && v.allow).length;
  return {
    updatedAt: m.updatedAt,
    stats: m.stats,
    counts: {
      ipBlock: countBlock(m.ips),
      uaBlock: countBlock(m.uas),
      fpBlock: countBlock(m.fps),
      ipAllow: countAllow(m.ips),
      uaAllow: countAllow(m.uas),
      fpAllow: countAllow(m.fps),
      ips: Object.keys(m.ips).length,
      uas: Object.keys(m.uas).length,
      fps: Object.keys(m.fps).length,
    },
    recent: {
      ips: topBlocked(m.ips),
      uas: topBlocked(m.uas),
      fps: topBlocked(m.fps),
    },
    thresholds: { FP_FAKE_PROMOTE, IP_FAKE_PROMOTE, KEEP_DAYS },
  };
}

// 启动时加载
load();
