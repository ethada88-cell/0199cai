import { fallbackLine, fastestLine, probeDomainsQuick } from "@/lib/probe"
import type { Domain } from "@/lib/types"

type Body = { urls?: string[] }

async function heartbeatOne(url: string, timeoutMs = 2500) {
  const started = Date.now()
  let host: string
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`)
    host = `${parsed.protocol}//${parsed.host}`
  } catch {
    return { ok: false as const, url, ms: null as number | null }
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
    return { ok, url, code, ms: Date.now() - started, restricted: code === "10008" }
  } catch {
    return { ok: false as const, url, ms: null as number | null }
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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Body | null
  const urls = Array.isArray(body?.urls)
    ? body!.urls!.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 40)
    : []
  if (!urls.length) {
    return Response.json({ error: "缺少域名列表" }, { status: 400 })
  }

  try {
    const winner = await promiseAnyFirst(
      urls.map((url) => heartbeatOne(url)),
      (item) => item.ok && !item.restricted
    )
    return Response.json({ url: winner.url, via: "heartbeat", ms: winner.ms })
  } catch {
    // heartbeat 全失败时回退到 HTTP 可达性探测，避免误报「无配置」
    const domains: Domain[] = urls.map((url, index) => ({
      id: `hb-${index}`,
      url: url.includes("://") ? url : `https://${url}`,
      label: "",
      enabled: true,
      createdAt: new Date().toISOString(),
    }))
    const lines = await probeDomainsQuick(domains)
    const best = fastestLine(lines)
    const fallback = fallbackLine(domains)
    const target = best?.url || fallback?.url || null
    if (!target) {
      return Response.json({ error: "未找到可用的域名节点" }, { status: 404 })
    }
    return Response.json({ url: target, via: "probe", ms: best?.ms ?? null })
  }
}
