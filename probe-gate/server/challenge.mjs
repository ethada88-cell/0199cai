/**
 * 滑动验证：疑似假量时弹出滑块，滑对即记为真量并豁免记忆。
 * 无第三方依赖；挑战短时有效，校验偏移 + 耗时，防脚本秒过。
 */
import crypto from "node:crypto";
import { feedback, deviceFingerprint, markSlidePass } from "./learn.mjs";
import { clientIp, clientUa } from "./classify.mjs";

const SECRET = process.env.CHALLENGE_SECRET || process.env.ADMIN_PASS || "probe-gate-chal";
const TTL_MS = 2 * 60 * 1000;
const challenges = new Map(); // id -> { target, exp, ip, fp, ua, sig }

function prune() {
  const now = Date.now();
  for (const [id, c] of challenges) {
    if (!c || c.exp < now) challenges.delete(id);
  }
  if (challenges.size > 5000) {
    const keys = [...challenges.keys()].slice(0, challenges.size - 4000);
    keys.forEach((k) => challenges.delete(k));
  }
}

function sign(id, target, exp) {
  return crypto.createHmac("sha256", SECRET).update(`${id}.${target}.${exp}`).digest("hex").slice(0, 24);
}

/** 下发滑块挑战：target 为轨道百分比 35~85 */
export function issueChallenge(req, body = {}) {
  prune();
  const ip = clientIp(req);
  const ua = clientUa(req);
  const fp = deviceFingerprint(ua, body.signals || {});
  const id = crypto.randomBytes(12).toString("hex");
  const target = 35 + Math.floor(Math.random() * 51); // 35-85
  const exp = Date.now() + TTL_MS;
  const sig = sign(id, target, exp);
  challenges.set(id, { target, exp, ip, fp, ua, sig, created: Date.now() });
  return {
    id,
    target,
    exp,
    sig,
    tip: "请拖动滑块完成验证",
  };
}

/**
 * 校验滑动结果。成功则写入学习豁免（滑动通过），返回 human。
 * body: { id, sig, offset, durationMs, signals }
 */
export function verifyChallenge(req, body = {}) {
  prune();
  const id = String(body.id || "");
  const c = challenges.get(id);
  if (!c) throw Object.assign(new Error("验证已过期，请刷新重试"), { status: 400 });
  if (c.exp < Date.now()) {
    challenges.delete(id);
    throw Object.assign(new Error("验证已过期，请刷新重试"), { status: 400 });
  }
  if (String(body.sig || "") !== c.sig) {
    throw Object.assign(new Error("验证无效"), { status: 400 });
  }

  const offset = Number(body.offset);
  const durationMs = Number(body.durationMs);
  if (!Number.isFinite(offset) || !Number.isFinite(durationMs)) {
    throw Object.assign(new Error("验证数据不完整"), { status: 400 });
  }
  // 真人拖动通常 > 280ms；脚本秒过拒绝
  if (durationMs < 280 || durationMs > 60000) {
    throw Object.assign(new Error("请重新滑动验证"), { status: 400 });
  }
  // 允许 ±4% 误差
  if (Math.abs(offset - c.target) > 4) {
    throw Object.assign(new Error("请对齐滑块后再松开"), { status: 400 });
  }

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

  return {
    ok: true,
    human: true,
    message: "验证通过",
  };
}
