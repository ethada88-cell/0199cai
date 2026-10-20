import {
  lastResortEntryUrl,
  mintSafetyCandidates,
  splitFixedAndWild,
  wildcardRootsForFallback,
} from "@/lib/jump-guarantee"
import { fastestLine, probeDomainsQuick } from "@/lib/probe"
import type { Domain } from "@/lib/types"
import { expandLiveUrl, isWildcardUrl } from "@/lib/wildcard"

type Body = { urls?: string[]; guarantee?: boolean }

async function heartbeatOne(url: string, timeoutMs = 2200) {
  const started = Date.now()
  const live = isWildcardUrl(url) ? expandLiveUrl(url) : url
  let host: string
  try {
    const parsed = new URL(live.includes("://") ? live : `https://${live}`)
    host = `${parsed.protocol}//${parsed.host}`
  } catch {
    return { ok: false as const, url: live, ms: null as number | null }
  }
  try {
    const response = await fetch(`${host}/melody/api/v1/base/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    })
    const body = (await response.json().catch(() => null)) as { code?: string } | null
    const code = body?.code
    const ok = code === "12200" || code === "10008"
    return { ok, url: live, code, ms: Date.now() - started, restricted: code === "10008" }
  } catch {
    return { ok: false as const, url: live, ms: null as number | null }
  }
}

function promiseAnyFirst<T>(items: Promise<T>[], pred: (value: T) => boolean) {
  return new Promise<T>((resolve, reject) => {
    let failed = 0
    if (!items.length) {
      reject(new Error("empty"))
      return
    }
    items.forEach((item) => {
      item
        .then((value) => {
          if (pred(value)) resolve(value)
          else {
            failed += 1
            if (failed === items.length) reject(new Error("all failed"))
          }
        })
        .catch(() => {
          failed += 1
          if (failed === items.length) reject(new Error("all failed"))
        })
    })
  })
}

async function raceUrls(urls: string[]) {
  if (!urls.length) return null
  try {
    const winner = await promiseAnyFirst(
      urls.map((url) => heartbeatOne(url)),
      (item) => item.ok && !item.restricted
    )
    return { url: winner.url, via: "heartbeat" as const, ms: winner.ms }
  } catch {
    const domains: Domain[] = urls.map((url, index) => ({
      id: `hb-${index}`,
      url: url.includes("://") ? url : `https://${url}`,
      label: "",
      enabled: true,
      createdAt: new Date().toISOString(),
    }))
    const lines = await probeDomainsQuick(domains)
    const best = fastestLine(lines)
    if (best?.url) return { url: best.url, via: "probe" as const, ms: best.ms }
    return null
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null
  const urls = Array.isArray(body?.urls)
    ? body!.urls!.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 40)
    : []
  const guarantee = body?.guarantee !== false

  const { fixed, wild } = splitFixedAndWild(urls)
  const roots = wildcardRootsForFallback(wild)

  // 1) 先走通配子域名（配置里的 *.0199x/y/z 等，当场展开）
  const firstSubs = mintSafetyCandidates(roots.length ? roots : wildcardRootsForFallback([]), 1)
  const firstHit = await raceUrls(firstSubs)
  if (firstHit) {
    return Response.json({ ...firstHit, via: `${firstHit.via}-sub` })
  }

  // 2) 再走新生成的一批随机子域名
  const moreSubs = mintSafetyCandidates(roots.length ? roots : wildcardRootsForFallback([]), 3)
  const moreHit = await raceUrls(moreSubs)
  if (moreHit) {
    return Response.json({ ...moreHit, via: `${moreHit.via}-sub-gen` })
  }

  // 3) 最后才走固定域名
  if (fixed.length) {
    const fixedHit = await raceUrls(fixed)
    if (fixedHit) return Response.json({ ...fixedHit, via: `${fixedHit.via}-fixed` })
  }

  if (guarantee) {
    return Response.json({ url: lastResortEntryUrl(), via: "last-resort", ms: null })
  }

  return Response.json({ error: "未找到可用的域名节点" }, { status: 404 })
}
