import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { referrerHost } from "@/lib/day";
import { sameSite } from "@/lib/registrable";
import type { TrafficSource } from "@/lib/types";

type Bucket = {
  total: number;
  emptyRef: number;
  sameSite: number;
  externalRef: number;
  withUtm: number;
  judgedFake: number;
  forcedReal: number;
  samples: Array<{ site: string; ref: string; utm: string; verdict: string; at: number }>;
};

const buckets = new Map<string, Bucket>();
let dirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const FILE = path.resolve(process.cwd(), "data", "cache", "source-probe.json");

function empty(): Bucket {
  return { total: 0, emptyRef: 0, sameSite: 0, externalRef: 0, withUtm: 0, judgedFake: 0, forcedReal: 0, samples: [] };
}

function flush() {
  timer = null;
  if (!dirty) return;
  dirty = false;
  const out: Record<string, Bucket> = {};
  for (const [id, bucket] of buckets) out[id] = bucket;
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    writeFileSync(FILE, JSON.stringify({ at: Date.now(), accounts: out }));
  } catch {
    /* ignore */
  }
}

/** Sample inbound check sources so we can see if ad referrers actually arrive. */
export function noteSourceProbe(input: {
  accountId: string;
  siteKey: string;
  source: TrafficSource;
  judgedVerdict: string;
  finalVerdict: string;
  direct: boolean;
}) {
  const id = input.accountId;
  if (!id) return;
  const bucket = buckets.get(id) || empty();
  bucket.total += 1;
  const ref = referrerHost(input.source.referrer || "");
  const page = input.source.host || input.siteKey;
  if (!ref) bucket.emptyRef += 1;
  else if (page && sameSite(ref, page)) bucket.sameSite += 1;
  else bucket.externalRef += 1;
  const utm = input.source.utmSource || input.source.utmMedium || input.source.utmCampaign || "";
  if (utm) bucket.withUtm += 1;
  if (input.judgedVerdict === "fake" || input.judgedVerdict === "suspicious") bucket.judgedFake += 1;
  if (input.direct && input.judgedVerdict !== "real") bucket.forcedReal += 1;
  if (bucket.samples.length < 40) {
    bucket.samples.push({
      site: input.siteKey.slice(0, 80),
      ref: ref.slice(0, 120),
      utm: String(utm).slice(0, 40),
      verdict: `${input.judgedVerdict}->${input.finalVerdict}`,
      at: Date.now(),
    });
  }
  buckets.set(id, bucket);
  dirty = true;
  if (!timer) timer = setTimeout(flush, 2000);
}
