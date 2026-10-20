import { passwordMatches, setSessionCookie } from "@/lib/auth"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { password?: string } | null
  const password = body?.password ?? ""
  if (!password || !passwordMatches(password)) {
    return Response.json({ error: "口令不正确" }, { status: 401 })
  }
  await setSessionCookie()
  return Response.json({ ok: true })
}
