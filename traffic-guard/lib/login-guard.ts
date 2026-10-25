const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX = 8;
const GLOBAL_WINDOW_MS = 1000;
const GLOBAL_MAX = 5;

const ipHits = new Map<string, number[]>();
let globalHits: number[] = [];

// Password checks are expensive. A burst of login posts must not fill the
// process with them, or the rest of the admin waits behind that work.
export function loginLimited(ip: string, now = Date.now()) {
  const key = ip || "0";
  const recent = (ipHits.get(key) || []).filter((at) => now - at < IP_WINDOW_MS);
  globalHits = globalHits.filter((at) => now - at < GLOBAL_WINDOW_MS);
  if (recent.length >= IP_MAX || globalHits.length >= GLOBAL_MAX) {
    ipHits.set(key, recent);
    return true;
  }
  recent.push(now);
  ipHits.set(key, recent);
  globalHits.push(now);
  if (ipHits.size > 4000) {
    for (const [name, list] of ipHits) {
      if (!list.length || now - list[list.length - 1] >= IP_WINDOW_MS) ipHits.delete(name);
    }
  }
  return false;
}
