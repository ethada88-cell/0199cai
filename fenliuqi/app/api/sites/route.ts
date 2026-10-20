import { isAdmin } from "@/lib/auth"
import { jsonError } from "@/lib/http"
import { createSite } from "@/lib/sites"
import { readStore } from "@/lib/store"

export async function GET() {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const store = await readStore()
  return Response.json({ sites: store.sites })
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return Response.json({ error: "请先登录后台" }, { status: 401 })
  }
  const body = (await request.json().catch(() => null)) as {
    name?: string
    siteCode?: string
    token?: string
  } | null
  try {
    const site = await createSite({
      name: body?.name ?? "",
      siteCode: body?.siteCode ?? "",
      token: body?.token ?? "",
    })
    return Response.json({ site }, { status: 201 })
  } catch (error) {
    return jsonError(error)
  }
}
