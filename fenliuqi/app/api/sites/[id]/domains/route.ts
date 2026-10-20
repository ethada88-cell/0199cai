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
    wildcard?: boolean
  } | null

  const wildcard = Boolean(body?.wildcard)

  if (body?.bulk !== undefined) {
    if (body.bulk.length > 20000) {
      return Response.json({ error: "名单太长，请分成几次添加" }, { status: 400 })
    }
    const parsed = parseDomainLines(body.bulk, { wildcard })
    if (!parsed.items.length) {
      return Response.json(
        { error: "没有识别到可用的网址（通配请勾选「通配符子域名」或写成 *.0199x.app）", skipped: parsed.skipped },
        { status: 400 }
      )
    }
    try {
      const result = await addDomains(
        id,
        parsed.items.map((item) => ({ ...item, wildcard }))
      )
      return Response.json({ ...result, skipped: [...parsed.skipped, ...result.skipped] })
    } catch (error) {
      return jsonError(error)
    }
  }

  try {
    const result = await addDomains(id, [
      { url: body?.url ?? "", label: body?.label ?? "", wildcard },
    ])
    if (!result.added.length) {
      return Response.json(
        {
          error: wildcard
            ? "这个通配根域不能添加，或已经在列表里（可填 0199x.app 或 *.0199x.app）"
            : "这个网址不能添加，或已经在列表里",
          ...result,
        },
        { status: 400 }
      )
    }
    return Response.json(result, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
