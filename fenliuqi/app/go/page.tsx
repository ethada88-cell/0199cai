import type { Metadata } from "next"
import { Suspense } from "react"
import { redirect } from "next/navigation"
import { JumpClient } from "@/components/jump-client"
import { getLastGood, setLastGood } from "@/lib/last-good"
import { fallbackLine, fastestLine, probeDomainsQuick } from "@/lib/probe"
import { readStore } from "@/lib/store"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "正在为您选择最优线路",
  description: "正在为您选择最优线路",
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
    let href = url.href
    if (href.endsWith("/") && url.pathname === "/") {
      // keep trailing slash consistency from store
      return href
    }
    return href
  } catch {
    return value
  }
}

async function pickAndRedirect(siteCode: string, token: string) {
  const store = await readStore()
  const site = store.sites.find((item) => item.siteCode === siteCode && item.token === token)
  const enabled = site?.domains.filter((domain) => domain.enabled) ?? []
  if (!site || !enabled.length) return "missing" as const

  const enabledUrls = new Set(enabled.map((domain) => normalizeUrl(domain.url)))
  const sticky = getLastGood(siteCode)
  if (sticky && enabledUrls.has(normalizeUrl(sticky))) {
    redirect(sticky)
  }

  const lines = await probeDomainsQuick(site.domains)
  const best = fastestLine(lines)
  const target = best?.url || fallbackLine(site.domains)?.url
  if (!target) return "down" as const
  setLastGood(siteCode, target)
  redirect(target)
}

export default async function GoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const siteCode = param(params.siteCode)
  const token = param(params.token)
  const optional = param(params.optional) === "1"
  const isCheck = param(params.isCheck) !== "0"

  if (siteCode && token && !optional && isCheck) {
    const outcome = await pickAndRedirect(siteCode, token)
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
  }

  return (
    <Suspense fallback={<p className="px-8 py-10 text-sm text-muted-foreground">正在打开入口…</p>}>
      <JumpClient />
    </Suspense>
  )
}
