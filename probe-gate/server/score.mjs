/**
 * 假量评分（内地+香港方案落地）
 *
 * 等级：
 *   0–19  正常     放行
 *  20–39  观察     不拦截，仅标记
 *  40–69  高可疑   触发验证
 *  ≥70    假量     确认假量
 *
 * 原则：弱信号单独只进「观察」；硬证据 / 多项强信号才升高可疑或确认假量。
 */

export const LEVEL = {
  normal: { id: "normal", name: "正常", min: 0, max: 19 },
  watch: { id: "watch", name: "观察", min: 20, max: 39 },
  suspect: { id: "suspect", name: "高可疑", min: 40, max: 69 },
  fake: { id: "fake", name: "假量", min: 70, max: 100 },
};

/** 按主类型给基础分（硬规则） */
const KIND_SCORE = {
  crawler: { score: 75, reason: "爬虫/脚本UA" },
  headless: { score: 75, reason: "无头浏览器" },
  learned: { score: 70, reason: "学习记忆命中" },
  emulator: { score: 55, reason: "模拟器/云手机环境" },
  automation: { score: 50, reason: "自动化伪装" },
  datacenter: { score: 40, reason: "机房/云厂商IP" },
  human: { score: 0, reason: "" },
};

/**
 * 弱环境异常（辅证）。上限 30，单独无法触发验证。
 */
export function softWatchScore(ua, signals = {}) {
  const s = signals && typeof signals === "object" ? signals : {};
  const u = String(ua || "");
  let score = 0;
  const reasons = [];
  const uaMobile = Boolean(s.uaMobile) || /Mobile|Android|iPhone|iPad/i.test(u);
  const platform = String(s.platform || "");

  // UA 与平台轻微不符（未达模拟器定罪线）
  if (uaMobile && /MacIntel|MacARM/i.test(platform) && /iPhone|iPad/i.test(u)) {
    score += 8;
    reasons.push("桌面网站模式");
  }
  if (uaMobile && Number(s.touch) === 0) {
    score += 10;
    reasons.push("手机UA无触控");
  }
  if (uaMobile && s.hasOrientation === false && s.hasMotion === false) {
    score += 8;
    reasons.push("缺运动/方向传感器");
  }
  if (uaMobile && String(s.netType || "") === "ethernet") {
    score += 6;
    reasons.push("手机网络报ethernet");
  }
  try {
    const parts = String(s.screen || "0x0").split("x");
    const w = Number(parts[0]) || 0;
    const h = Number(parts[1]) || 0;
    if (uaMobile && w >= 1280 && h >= 720 && Number(s.dpr || 1) === 1) {
      score += 6;
      reasons.push("手机UA桌面分辨率");
    }
  } catch (_) {}

  if (score > 30) score = 30;
  return { score, reasons };
}

export function levelFromScore(score) {
  const n = Math.max(0, Math.min(100, Number(score) || 0));
  if (n >= 70) return LEVEL.fake;
  if (n >= 40) return LEVEL.suspect;
  if (n >= 20) return LEVEL.watch;
  return LEVEL.normal;
}

/**
 * 根据最终 kind + 弱信号计算评分与处理建议。
 * @returns {{ score, level, levelName, reasons, trap, fake, watch }}
 */
export function buildScore(cls, ua, signals = {}) {
  const kind = cls.kind || "human";
  const base = KIND_SCORE[kind] || KIND_SCORE.human;
  const soft = softWatchScore(ua, signals);
  const reasons = [];
  let score = 0;

  if (base.score > 0) {
    score += base.score;
    if (base.reason) reasons.push(base.reason);
  }
  // 已被硬规则定罪时，弱信号不再叠加（避免分数虚高）；观察档才用弱信号
  if (kind === "human" || kind === "datacenter") {
    // 机房 IP 已是 40；真人可叠加弱信号进入观察
    if (kind === "human" && soft.score > 0) {
      score += soft.score;
      reasons.push(...soft.reasons);
    }
  }
  if (cls.learnReason) reasons.push(String(cls.learnReason));

  if (score > 100) score = 100;
  const level = levelFromScore(score);
  // 方案：≥40 触发验证；≥70 确认假量；20–39 仅观察
  const trap = score >= 40;
  const fake = score >= 40;
  const watch = score >= 20 && score < 40;
  return {
    score,
    level: level.id,
    levelName: level.name,
    reasons,
    trap,
    fake,
    watch,
  };
}
