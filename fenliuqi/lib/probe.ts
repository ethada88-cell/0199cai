import type { Domain, ProbeLine } from "./types"

const PROBE_TIMEOUT_MS = 2000
const EARLY_SETTLE_MS = 350
const TOTAL_BUDGET_MS = 2200

async function probeOne(domain: Domain, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeLine> {
  const started = Date.now()
  try {
    const response = await fetch(domain.url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "LinegateHealth/1.0" },
    })
    await response.body?.cancel()
    const ms = Date.now() - started
    const ok = response.status >= 200 && response.status < 400
    return {
      id: domain.id,
      label: domain.label || hostOf(domain.url),
      url: domain.url,
      status: ok ? "ok" : "down",
      ms,
      detail: ok ? `${ms} ms` : `HTTP ${response.status}`,
    }
  } catch {
    return {
      id: domain.id,
      label: domain.label || hostOf(domain.url),
      url: domain.url,
      status: "down",
      ms: null,
      detail: "无法连接",
    }
  }
}

function hostOf(value: string) {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function pendingLine(domain: Domain): ProbeLine {
  return {
    id: domain.id,
    label: domain.label || hostOf(domain.url),
    url: domain.url,
    status: "down",
    ms: null,
    detail: "未完成",
  }
}

/** Probe all domains and wait for every result (选线页用). */
export async function probeDomains(domains: Domain[], check: boolean) {
  const enabled = domains.filter((domain) => domain.enabled)
  if (!check) {
    return enabled.map<ProbeLine>((domain) => ({
      id: domain.id,
      label: domain.label || hostOf(domain.url),
      url: domain.url,
      status: "skipped",
      ms: null,
      detail: "未检测",
    }))
  }

  const lines: ProbeLine[] = new Array(enabled.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(12, enabled.length) }, async () => {
    while (cursor < enabled.length) {
      const index = cursor
      cursor += 1
      lines[index] = await probeOne(enabled[index])
    }
  })
  await Promise.all(workers)
  return lines
}

/**
 * Race probes and return as soon as a good line is found.
 * Waits a short settle window after the first OK to pick a faster one,
 * instead of waiting for every domain (including timeouts).
 */
export async function probeDomainsQuick(domains: Domain[]) {
  const enabled = domains.filter((domain) => domain.enabled)
  if (!enabled.length) return [] as ProbeLine[]

  return new Promise<ProbeLine[]>((resolve) => {
    const results: Array<ProbeLine | undefined> = new Array(enabled.length)
    let completed = 0
    let firstOkAt: number | null = null
    let done = false
    const startedAt = Date.now()

    const finish = () => {
      if (done) return
      done = true
      resolve(enabled.map((domain, index) => results[index] ?? pendingLine(domain)))
    }

    const maybeFinish = () => {
      if (done) return
      const hasOk = results.some((line) => line?.status === "ok")
      const allDone = completed >= enabled.length
      const budgetOut = Date.now() - startedAt >= TOTAL_BUDGET_MS
      const settled =
        firstOkAt !== null && Date.now() - firstOkAt >= EARLY_SETTLE_MS

      if (allDone || (hasOk && settled) || budgetOut) finish()
    }

    for (let index = 0; index < enabled.length; index++) {
      const domain = enabled[index]
      void probeOne(domain).then((line) => {
        if (done) return
        results[index] = line
        completed += 1
        if (line.status === "ok" && firstOkAt === null) {
          firstOkAt = Date.now()
          setTimeout(maybeFinish, EARLY_SETTLE_MS)
        }
        maybeFinish()
      })
    }

    setTimeout(maybeFinish, TOTAL_BUDGET_MS)
  })
}

export function fastestLine(lines: ProbeLine[]) {
  return lines.reduce<ProbeLine | null>((best, line) => {
    if (line.status !== "ok" || line.ms === null) return best
    if (!best || best.ms === null || line.ms < best.ms) return line
    return best
  }, null)
}
