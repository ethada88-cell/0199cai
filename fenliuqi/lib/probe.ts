import type { Domain, ProbeLine } from "./types"

const PROBE_TIMEOUT_MS = 900
const QUICK_TIMEOUT_MS = 700
const QUICK_CONCURRENCY = 16
const QUICK_BUDGET_MS = 1200

/** Demo / seed hosts that should not win the auto-jump race. */
const DEMO_HOST_RE = /^(www\.)?(example\.com|cloudflare\.com|linegate-down\.invalid)$/i

function hostOf(value: string) {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

function isDemoHost(url: string) {
  return DEMO_HOST_RE.test(hostOf(url))
}

/** Prefer real lines first so seed domains do not burn the first concurrency slots. */
function orderForQuick(domains: Domain[]) {
  const real: Domain[] = []
  const demo: Domain[] = []
  for (const domain of domains) {
    if (isDemoHost(domain.url)) demo.push(domain)
    else real.push(domain)
  }
  return real.length ? [...real, ...demo] : domains
}

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
 * 自动跳转用：并发探测，一出现可用线路立刻返回（不再等全部超时）。
 * 真实线路优先探测；同批里若已有 OK 立刻结束。
 */
export async function probeDomainsQuick(domains: Domain[]) {
  const enabled = orderForQuick(domains.filter((domain) => domain.enabled))
  if (!enabled.length) return [] as ProbeLine[]

  return new Promise<ProbeLine[]>((resolve) => {
    const results: Array<ProbeLine | undefined> = new Array(enabled.length)
    let cursor = 0
    let completed = 0
    let done = false
    const startedAt = Date.now()

    const finish = () => {
      if (done) return
      done = true
      resolve(enabled.map((domain, index) => results[index] ?? pendingLine(domain)))
    }

    const onResult = (index: number, line: ProbeLine) => {
      if (done) return
      results[index] = line
      completed += 1
      // 第一个可用真实线路立刻走；演示域名不当作自动跳转赢家
      if (line.status === "ok" && !isDemoHost(line.url)) {
        finish()
        return
      }
      if (completed >= enabled.length) finish()
      else if (Date.now() - startedAt >= QUICK_BUDGET_MS) finish()
      else pump()
    }

    const pump = () => {
      while (!done && cursor < enabled.length) {
        const inFlight = cursor - completed
        if (inFlight >= QUICK_CONCURRENCY) break
        const index = cursor
        cursor += 1
        void probeOne(enabled[index], QUICK_TIMEOUT_MS).then((line) => onResult(index, line))
      }
    }

    pump()
    setTimeout(() => {
      if (!done) finish()
    }, QUICK_BUDGET_MS)
  })
}

export function fastestLine(lines: ProbeLine[]) {
  // Prefer non-demo OK lines for auto-jump
  const ranked = lines.filter((line) => line.status === "ok" && line.ms !== null)
  const real = ranked.filter((line) => !isDemoHost(line.url))
  const pool = real.length ? real : ranked
  return pool.reduce<ProbeLine | null>((best, line) => {
    if (!best || best.ms === null || (line.ms !== null && line.ms < best.ms)) return line
    return best
  }, null)
}
