import type { Domain, ProbeLine } from "./types"

async function probeOne(domain: Domain): Promise<ProbeLine> {
  const started = Date.now()
  try {
    const response = await fetch(domain.url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
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
  const workers = Array.from({ length: Math.min(6, enabled.length) }, async () => {
    while (cursor < enabled.length) {
      const index = cursor
      cursor += 1
      lines[index] = await probeOne(enabled[index])
    }
  })
  await Promise.all(workers)
  return lines
}

export function fastestLine(lines: ProbeLine[]) {
  return lines.reduce<ProbeLine | null>((best, line) => {
    if (line.status !== "ok" || line.ms === null) return best
    if (!best || best.ms === null || line.ms < best.ms) return line
    return best
  }, null)
}
