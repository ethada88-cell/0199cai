import { isAdmin } from "@/lib/auth"
import { jsonError } from "@/lib/http"
import { addDomains } from "@/lib/sites"
import { parseDomainLines } from "@/lib/urls"

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as {
    url?: string
    label?: string
    bulk?: string
  } | null

  if (body?.bulk !== undefined) {
    if (body.bulk.length > 20000) {
      return Response.json({ error: "名单太长，请分成几次添加" }, { status: 400 })
    }
    const parsed = parseDomainLines(body.bulk)
    if (!parsed.items.length) {
      return Response.json(
        { error: "没有识别到可用的网址", skipped: parsed.skipped },
        { status: 400 }
      )
    }
    try {
      const result = await addDomains(id, parsed.items)
      return Response.json({ ...result, skipped: [...parsed.skipped, ...result.skipped] })
    } catch (error) {
      return jsonError(error)
    }
  }

  try {
    const result = await addDomains(id, [{ url: body?.url ?? "", label: body?.label ?? "" }])
    if (!result.added.length) {
      return Response.json({ error: "这个网址不能添加，或已经在列表里", ...result }, { status: 400 })
    }
    return Response.json(result, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
