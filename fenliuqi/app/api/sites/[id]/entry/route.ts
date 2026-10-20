import { isAdmin } from "@/lib/auth"
import { encryptDomainConfig, payloadFromDomains } from "@/lib/config-crypto"
import { readStore } from "@/lib/store"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, ctx: Ctx) {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const { id } = await ctx.params
  const store = await readStore()
  const site = store.sites.find((item) => item.id === id)
  if (!site) return Response.json({ error: "站点不存在" }, { status: 404 })

  const enabled = site.domains.filter((domain) => domain.enabled)
  if (!enabled.length) {
    return Response.json({ error: "请先启用至少一条域名" }, { status: 400 })
  }

  const payload = payloadFromDomains({ name: site.name, domains: enabled })
  const d = encryptDomainConfig(payload)
  const url = new URL(request.url)
  const origin = `${url.protocol}//${url.host}`

  return Response.json({
    d,
    link: `${origin}/go?d=${d}`,
    optionalLink: `${origin}/go?d=${d}&optional=1`,
    domainCount: enabled.length,
  })
}
