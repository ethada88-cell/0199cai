import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { JumpClient } from "@/components/jump-client"
import { getLastGood, setLastGood } from "@/lib/last-good"
import { resolveJumpTarget, runJumpProbe } from "@/lib/jump-resolve"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "获取域名节点中",
  description: "获取域名节点中",
  robots: { index: false, follow: false },
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function param(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0]?.trim() ?? ""
  return value?.trim() ?? ""
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ""
    return url.href
  } catch {
    return value
  }
}

async function pickAndRedirect(input: {
  d: string
  siteCode: string
  token: string
}) {
  const resolved = await resolveJumpTarget(input)
  if (!resolved.ok) {
    return resolved.status === 404 ? ("missing" as const) : ("badcfg" as const)
  }

  const { target } = resolved
  const enabled = target.domains.filter((domain) => domain.enabled)
  if (!enabled.length) return "down" as const

  const enabledUrls = new Set(enabled.map((domain) => normalizeUrl(domain.url)))
  const sticky = getLastGood(target.cacheKey)
  if (sticky && enabledUrls.has(normalizeUrl(sticky))) {
    redirect(sticky)
  }

  const { targetUrl } = await runJumpProbe(target.domains, "quick")
  if (!targetUrl) return "down" as const
  setLastGood(target.cacheKey, targetUrl)
  redirect(targetUrl)
}

export default async function GoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const d = param(params.d)
  const siteCode = param(params.siteCode)
  const token = param(params.token)
  const optional = param(params.optional) === "1"
  const isCheck = param(params.isCheck) !== "0"
  const ready = Boolean(d || (siteCode && token))

  if (ready && !optional && isCheck) {
    const outcome = await pickAndRedirect({ d, siteCode, token })
    if (outcome === "down") {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-16 pt-8 text-center md:pt-16">
          <h1 className="text-3xl font-semibold tracking-tight">线路不可用</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">没有可用线路，请稍后重试。</p>
        </main>
      )
    }
    if (outcome === "missing") {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-16 pt-8 text-center md:pt-16">
          <h1 className="text-3xl font-semibold tracking-tight">暂时进不去</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">没有找到这个站点，或令牌不正确。</p>
        </main>
      )
    }
    if (outcome === "badcfg") {
      return (
        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center px-4 pb-16 pt-8 text-center md:pt-16">
          <h1 className="text-3xl font-semibold tracking-tight">配置无效</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">加密域名配置无法解析，请重新复制入口链接。</p>
        </main>
      )
    }
  }

  return (
    <Suspense fallback={<p className="px-8 py-10 text-sm text-muted-foreground">获取域名节点中…</p>}>
      <JumpClient />
    </Suspense>
  )
}
