export type SlideSample = { dt: number; x: number; y: number; p?: number; w?: number; h?: number };

export type SlideTrace = {
  reaction: number;
  duration: number;
  movesBefore: number;
  paused: boolean;
  pointer: string;
  track: number;
  travel: number;
  samples: SlideSample[];
};

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 滑到头才可能过；轨迹像脚本（太快/太直/无停顿）记 perfect → 仍假量。
 * 这样减少「滑动成功」，且不放过刷量。
 */
export function judgeSlide(input: SlideTrace): "human" | "perfect" | "incomplete" {
  const track = num(input?.track);
  const travel = num(input?.travel);
  const reaction = num(input?.reaction);
  const duration = num(input?.duration);
  const movesBefore = num(input?.movesBefore);
  const paused = Boolean(input?.paused);
  const pointer = typeof input?.pointer === "string" ? input.pointer : "";
  const samples = Array.isArray(input?.samples) ? input.samples : [];

  if (track < 8 || travel < track - 8) return "incomplete";
  if (samples.length < 2) return "perfect";

  let yMin = Infinity;
  let yMax = -Infinity;
  let xMin = Infinity;
  let xMax = -Infinity;
  let pMin = Infinity;
  let pMax = -Infinity;
  let wMin = Infinity;
  let wMax = -Infinity;
  let hMin = Infinity;
  let hMax = -Infinity;
  let maxStep = 0;
  const speeds: number[] = [];
  const gaps: number[] = [];

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const x = num(sample?.x);
    const y = num(sample?.y);
    const p = num(sample?.p);
    const w = num(sample?.w);
    const h = num(sample?.h);
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (p < pMin) pMin = p;
    if (p > pMax) pMax = p;
    if (w < wMin) wMin = w;
    if (w > wMax) wMax = w;
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
    if (i === 0) continue;
    const prev = samples[i - 1];
    const dt = num(sample?.dt) - num(prev?.dt);
    const dx = x - num(prev?.x);
    if (Math.abs(dx) > maxStep) maxStep = Math.abs(dx);
    if (dt <= 0) continue;
    gaps.push(dt);
    const dy = y - num(prev?.y);
    speeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
  }

  const yRange = yMax - yMin;
  let mean = 0;
  for (const speed of speeds) mean += speed;
  mean = mean / (speeds.length || 1);
  let variance = 0;
  for (const speed of speeds) variance += (speed - mean) ** 2;
  variance = variance / (speeds.length || 1);
  const speedCv = mean > 0.02 ? Math.sqrt(variance) / mean : 0;
  let gapMean = 0;
  for (const gap of gaps) gapMean += gap;
  gapMean = gapMean / (gaps.length || 1);
  let gapVar = 0;
  for (const gap of gaps) gapVar += (gap - gapMean) ** 2;
  gapVar = gapVar / (gaps.length || 1);
  const gapCv = gapMean > 0 ? Math.sqrt(gapVar) / gapMean : 0;
  const touchVary = pointer === "touch" && (pMax - pMin >= 0.04 || wMax - wMin >= 1 || hMax - hMin >= 1);
  const travelX = xMax - xMin;

  if (duration > 0 && duration < 160) return "perfect";
  if (reaction < 100 && duration < 450) return "perfect";
  if (samples.length <= 3 && travelX > 0 && maxStep > travelX * 0.85 && duration < 400) return "perfect";
  if (
    yRange < 0.8 &&
    speedCv < 0.06 &&
    gapCv < 0.15 &&
    gaps.length >= 4 &&
    movesBefore < 2 &&
    !paused &&
    !touchVary &&
    reaction < 180 &&
    duration < 420
  ) {
    return "perfect";
  }
  return "human";
}
