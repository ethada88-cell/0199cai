/** 学习账本半衰期：约 7 天衰减一半，旧假量不再永远压住新滑过。 */
export const REP_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export function decayFactor(at: number, now = Date.now()) {
  const age = Math.max(0, now - (Number(at) || now));
  return Math.pow(0.5, age / REP_HALF_LIFE_MS);
}

export function decayCounts(fake: number, human: number, at: number, now = Date.now()) {
  const factor = decayFactor(at, now);
  return {
    fake: Math.max(0, (Number(fake) || 0) * factor),
    human: Math.max(0, (Number(human) || 0) * factor),
    factor,
  };
}
