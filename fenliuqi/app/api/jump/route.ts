import { fastestLine, probeDomains } from "@/lib/probe"
import { readStore } from "@/lib/store"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  const token = url.searchParams.get("token")?.trim() ?? ""
  const check = url.searchParams.get("isCheck") !== "0"

  if (!siteCode || !token) {
    return Response.json({ error: "缺少站点代号或令牌" }, { status: 400 })
  }

  const store = await readStore()
  const site = store.sites.find((item) => item.siteCode === siteCode && item.token === token)
  if (!site) {
    return Response.json({ error: "没有找到这个站点，或令牌不正确" }, { status: 404 })
  }

  const enabled = site.domains.filter((domain) => domain.enabled)
  if (!enabled.length) {
    return Response.json({ error: "这个站点还没有启用的域名" }, { status: 404 })
  }

  const lines = await probeDomains(site.domains, check)
  return Response.json({
    site: { name: site.name, siteCode: site.siteCode },
    lines,
    fastestId: fastestLine(lines)?.id ?? null,
  })
}
