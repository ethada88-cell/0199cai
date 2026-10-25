const WINDOW_MS = 15 * 60 * 1000;

type Sample = { at: number; ip: string; fp: string; visitor: string };

const buckets = new Map<string, Sample[]>();

export function observeBurst(accountId: string, siteKey: string, ip: string, fp: string, visitor: string) {
  const now = Date.now();
  const key = `${accountId}\n${siteKey}`;
  let list = buckets.get(key);
  if (!list) {
    list = [];
    buckets.set(key, list);
  }
  let drop = 0;
  while (drop < list.length && now - list[drop].at > WINDOW_MS) drop += 1;
  if (drop) list.splice(0, drop);
  const visitorKey = visitor || fp || "unknown";
  list.push({ at: now, ip, fp, visitor: visitorKey });

  const ipVisitors = new Set<string>();
  const ipFingerprints = new Set<string>();
  const fpVisitors = new Set<string>();
  let ipVisits = 0;
  for (const row of list) {
    if (row.ip !== ip) continue;
    ipVisits += 1;
    ipVisitors.add(row.visitor);
    if (row.fp) ipFingerprints.add(row.fp);
    if (fp && row.fp === fp) fpVisitors.add(row.visitor);
  }
  return {
    ipVisits,
    ipVisitors: ipVisitors.size,
    ipFingerprints: ipFingerprints.size,
    fpVisitors: fpVisitors.size,
  };
}
