import { isAdmin } from "@/lib/auth"
import { jsonError } from "@/lib/http"
import { deleteDomain, updateDomain } from "@/lib/sites"

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string; domainId: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const { id, domainId } = await ctx.params
  const body = (await request.json().catch(() => null)) as {
    label?: string
    enabled?: boolean
    move?: "up" | "down"
  } | null
  try {
    await updateDomain(id, domainId, {
      label: body?.label,
      enabled: body?.enabled,
      move: body?.move,
    })
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string; domainId: string }> }
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const { id, domainId } = await ctx.params
  try {
    await deleteDomain(id, domainId)
    return Response.json({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}
