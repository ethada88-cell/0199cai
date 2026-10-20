import { credentialsMatch, setSessionCookie } from "@/lib/auth"

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    username?: string
    password?: string
  } | null
  const username = body?.username ?? ""
  const password = body?.password ?? ""
  if (!username || !password || !credentialsMatch(username, password)) {
    return Response.json({ error: "账号或密码不正确" }, { status: 401 })
  }
  await setSessionCookie()
  return Response.json({ ok: true })
}
