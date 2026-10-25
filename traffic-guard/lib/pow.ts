import type { ClientSignals } from "@/lib/types";

/** 与 public/guard-run.js 的 fnv 必须逐字节一致。难度 10 bit，几千次循环即可。 */
export function fnv32(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function powSeed(signals: ClientSignals) {
  const screen = signals.screen || {};
  return [signals.canvas || "", signals.timezone || "", screen.w || 0, screen.h || 0].join("|");
}

/** 新采集脚本会带 probe=1。旧脚本没有该字段，不能因为缺 pow 判假。 */
export function powHolds(signals: ClientSignals) {
  if (signals.probe !== 1) return true;
  const pow = signals.pow;
  const n = pow?.n;
  const h = pow?.h || "";
  if (!Number.isInteger(n) || n == null || n < 0 || n > 20000 || !/^[0-9a-f]{1,8}$/.test(h)) return false;
  const digest = fnv32(`${powSeed(signals)}:${n}`);
  if ((digest & 1023) !== 0) return false;
  return digest.toString(16) === h;
}
