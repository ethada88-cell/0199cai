import type { ClientSignals } from "@/lib/types";

/** 嫌疑流量二次监测时的互动结论。 */
export type SuspectEngage = "idle" | "human" | "abnormal";

/**
 * 嫌疑 IP 看互动（放宽版）：
 * - 无操作，或仅有轻触、未形成正常浏览 → idle（继续嫌疑）
 * - 有正常下拉/浏览（轨迹不像脚本）→ human（改真实）；不强制要点击
 * - 只有脚本态（匀速直线、定时连点、human 分过低）→ abnormal（改假量）
 */
export function classifySuspectEngage(signals: ClientSignals): SuspectEngage {
  const eng = signals.engagement || {};
  const beh = signals.behavior || {};
  const moves = Math.max(Number(eng.pointerMoves) || 0, Number(beh.moves) || 0);
  const scroll = Number(eng.scroll) || 0;
  const clicks = Number(beh.clicks) || 0;
  const keys = Number(beh.keys) || 0;

  if (moves <= 0 && scroll <= 0 && clicks <= 0 && keys <= 0) return "idle";

  const speedCv = beh.speedCv ?? 1;
  const clickCv = beh.clickCv ?? 1;
  const scriptedPointer = beh.straight === true && moves >= 10 && speedCv < 0.08;
  const evenClicks = clicks >= 5 && clickCv < 0.08;
  const lowHuman = typeof beh.human === "number" && beh.human < 0.5;

  // 脚本态才升假量。
  if (scriptedPointer || evenClicks || lowHuman) return "abnormal";

  // 正常浏览即可偏向真实（下拉或足够移动）；点击加分但不做硬门槛。
  const browsed = scroll >= 12 || moves >= 8;
  if (browsed) return "human";

  // 有一点操作但还谈不上正常浏览，也不像脚本 → 继续嫌疑。
  return "idle";
}
