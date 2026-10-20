import type { Metadata } from "next"
import { redirect } from "next/navigation"

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

/** 兼容旧 /go 链接，统一进与参考站相同的前端跳转页。 */
export default async function GoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const key of ["siteCode", "token", "optional", "isCheck", "routerecord", "d"]) {
    const value = param(params[key])
    if (value) query.set(key, value)
  }
  redirect(query.toString() ? `/jump?${query.toString()}` : "/jump")
}
