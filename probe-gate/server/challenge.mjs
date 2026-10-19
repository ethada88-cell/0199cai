/**
 * 滑动验证：必须带真人拖动轨迹才能通过。
 * 校验：点数、耗时、单调推进、速度波动、非匀速直线、无瞬移。
 */
import crypto from "node:crypto";
import { feedback, deviceFingerprint, markSlidePass } from "./learn.mjs";
import { clientIp, clientUa } from "./classify.mjs";

const SECRET = process.env.CHALLENGE_SECRET || process.env.ADMIN_PASS || "probe-gate-chal";
const TTL_MS = 2 * 60 * 1000;
const challenges = new Map();

function prune() {
  const now = Date.now();
  for (const [id, c] of challenges) {
    if (!c || c.exp < now) challenges.delete(id);
  }
  if (challenges.size > 5000) {
    [...challenges.keys()].slice(0, challenges.size - 4000).forEach((k) => challenges.delete(k));
  }
}

function sign(id, target, exp) {
  return crypto.createHmac("sha256", SECRET).update(`${id}.${target}.${exp}`).digest("hex").slice(0, 24);
}

function fail(msg) {
  throw Object.assign(new Error(msg), { status: 400 });
}

/**
 * 轨迹点：{ t: 相对起点 ms, x: 0~100 百分比 }
 * 机器人常见：点数少、匀速、瞬移、无抖动。
 */
function assertHumanTrack(track, offset, durationMs, target) {
  if (!Array.isArray(track) || track.length < 8) fail("请重新滑动验证");

  const pts = [];
  for (const raw of track.slice(0, 200)) {
    const t = Number(raw && raw.t);
    const x = Number(raw && raw.x);
    if (!Number.isFinite(t) || !Number.isFinite(x)) continue;
    if (t < 0 || t > 60000) continue;
    if (x < -2 || x > 102) continue;
    pts.push({ t, x: Math.max(0, Math.min(100, x)) });
  }
  if (pts.length < 8) fail("请重新滑动验证");

  // 按时间排序
  pts.sort((a, b) => a.t - b.t);

  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = t1 - t0;
  if (span < 320) fail("滑动太快，请按住拖动");
  if (span > 45000) fail("滑动超时，请重试");
  if (Math.abs(durationMs - span) > 1200) fail("请重新滑动验证");

  // 起点应靠近 0，终点应靠近申报 offset / target
  if (pts[0].x > 12) fail("请从左侧开始拖动");
  const endX = pts[pts.length - 1].x;
  if (Math.abs(endX - offset) > 6) fail("请重新滑动验证");
  if (Math.abs(endX - target) > 5) fail("请对齐滑块后再松开");

  // 整体应向前推进
  let forward = 0;
  let backward = 0;
  let bigJump = 0;
  const speeds = [];
  const dts = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dt = pts[i].t - pts[i - 1].t;
    if (dt <= 0) fail("请重新滑动验证");
    if (dt < 4 && Math.abs(dx) > 8) bigJump += 1; // 瞬间大跳
    if (Math.abs(dx) > 28) bigJump += 1; // 单步过大（脚本瞬移）
    if (dx >= 0) forward += 1;
    else backward += 1;
    speeds.push(dx / dt); // % per ms
    dts.push(dt);
  }
  if (bigJump >= 2) fail("滑动异常，请用手拖动");
  if (forward < pts.length * 0.55) fail("请重新滑动验证");
  // 允许少量回拉，但回拉不能占主导
  if (backward > forward * 0.45) fail("请重新滑动验证");

  // 速度方差：完全匀速 / 全 0 速度 = 机器人
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  let varSp = 0;
  for (const s of speeds) varSp += (s - mean) * (s - mean);
  varSp /= speeds.length;
  const std = Math.sqrt(varSp);
  if (std < 0.00015 && Math.abs(mean) > 0.00005) fail("滑动异常，请用手拖动"); // 近乎完美匀速

  // 采样时间间隔应有波动（rAF/事件不是完美等间隔）
  const meanDt = dts.reduce((a, b) => a + b, 0) / dts.length;
  let varDt = 0;
  for (const d of dts) varDt += (d - meanDt) * (d - meanDt);
  varDt /= dts.length;
  if (meanDt > 0 && Math.sqrt(varDt) / meanDt < 0.03 && pts.length > 15) {
    // 过于均匀的时钟间隔
    fail("滑动异常，请用手拖动");
  }

  // 线性拟合残差：轨迹不能是完美直线 x = k*t
  const n = pts.length;
  let sumT = 0,
    sumX = 0,
    sumTT = 0,
    sumTX = 0;
  for (const p of pts) {
    sumT += p.t;
    sumX += p.x;
    sumTT += p.t * p.t;
    sumTX += p.t * p.x;
  }
  const den = n * sumTT - sumT * sumT;
  if (den !== 0) {
    const k = (n * sumTX - sumT * sumX) / den;
    const b = (sumX - k * sumT) / n;
    let sse = 0;
    let sst = 0;
    const xMean = sumX / n;
    for (const p of pts) {
      const pred = k * p.t + b;
      sse += (p.x - pred) * (p.x - pred);
      sst += (p.x - xMean) * (p.x - xMean);
    }
    // R^2 极高且残差极小 = 直线脚本
    const r2 = sst > 1e-6 ? 1 - sse / sst : 1;
    const rmse = Math.sqrt(sse / n);
    if (r2 > 0.9995 && rmse < 0.15) fail("滑动异常，请用手拖动");
  }

  // 有效推进距离
  const travel = endX - pts[0].x;
  if (travel < Math.max(20, target * 0.5)) fail("请重新滑动验证");

  return true;
}

/** 下发滑块挑战：target 为轨道百分比 35~85 */
export function issueChallenge(req, body = {}) {
  prune();
  const ip = clientIp(req);
  const ua = clientUa(req);
  const fp = deviceFingerprint(ua, body.signals || {});
  const id = crypto.randomBytes(12).toString("hex");
  const target = 35 + Math.floor(Math.random() * 51);
  const exp = Date.now() + TTL_MS;
  const sig = sign(id, target, exp);
  challenges.set(id, { target, exp, ip, fp, ua, sig, created: Date.now() });
  return {
    id,
    target,
    exp,
    sig,
    tip: "请按住滑块拖到圆圈处",
  };
}

/**
 * body: { id, sig, offset, durationMs, track:[{t,x}], signals }
 */
export function verifyChallenge(req, body = {}) {
  prune();
  const id = String(body.id || "");
  const c = challenges.get(id);
  if (!c) fail("验证已过期，请刷新重试");
  if (c.exp < Date.now()) {
    challenges.delete(id);
    fail("验证已过期，请刷新重试");
  }
  if (String(body.sig || "") !== c.sig) fail("验证无效");

  const offset = Number(body.offset);
  const durationMs = Number(body.durationMs);
  if (!Number.isFinite(offset) || !Number.isFinite(durationMs)) fail("验证数据不完整");
  if (durationMs < 320 || durationMs > 60000) fail("请重新滑动验证");
  if (Math.abs(offset - c.target) > 4) fail("请对齐滑块后再松开");

  assertHumanTrack(body.track, offset, durationMs, c.target);

  challenges.delete(id);

  const ip = c.ip || clientIp(req);
  const ua = c.ua || clientUa(req);
  const fp = c.fp || deviceFingerprint(ua, body.signals || {});

  try {
    feedback({ ip, ua, fp, label: "human", note: "slide-pass" });
  } catch {
    /* ignore */
  }
  try {
    markSlidePass(ip, fp);
  } catch {
    /* ignore */
  }

  return { ok: true, human: true, message: "验证通过" };
}
