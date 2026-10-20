import { isAdmin } from "@/lib/auth"
import { jsonError } from "@/lib/http"
import { deleteSite, updateSite } from "@/lib/sites"

async function unauthorized() {
  if (await isAdmin()) return null
  return Response.json({ error: "请先登录后台" }, { status: 401 })
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await unauthorized()
  if (denied) return denied
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as {
    name?: string
    siteCode?: string
    token?: string
  } | null
  try {
    const site = await updateSite(id, {
      name: body?.name,
      siteCode: body?.siteCode,
      token: body?.token,
    })
    return Response.json({ site })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await unauthorized()
  if (denied) return denied
  const { id } = await ctx.params
  try {
    await deleteSite(id)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
