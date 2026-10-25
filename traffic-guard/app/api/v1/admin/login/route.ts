import { NextResponse } from "next/server";
import { authenticate } from "@/lib/accounts";
import { authConfigured, cookieSecure, sessionCookie, signSession } from "@/lib/auth";
import { loginLimited } from "@/lib/login-guard";

export const dynamic = "force-dynamic";

function isFormPost(request: Request) {
  const type = request.headers.get("content-type") || "";
  return type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data");
}

function redirectTo(request: Request, path: string) {
  const proto = request.headers.get("x-forwarded-proto");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const origin = proto && host ? `${proto}://${host}` : new URL(request.url).origin;
  return NextResponse.redirect(new URL(path, origin), 303);
}

export async function POST(request: Request) {
  const form = isFormPost(request);
  if (!authConfigured()) {
    if (form) return redirectTo(request, "/login?e=1");
    return NextResponse.json({ ok: false, error: "登录尚未配置" }, { status: 503 });
  }
  let username = "";
  let password = "";
  try {
    if (form) {
      const body = await request.formData();
      username = String(body.get("username") || "");
      password = String(body.get("password") || "");
    } else {
      const body = (await request.json()) as { username?: string; password?: string };
      username = String(body.username || "");
      password = String(body.password || "");
    }
  } catch {
    if (form) return redirectTo(request, "/login?e=1");
    return NextResponse.json({ ok: false, error: "账号或密码不正确" }, { status: 400 });
  }
  const ip = (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (loginLimited(ip)) {
    if (form) return redirectTo(request, "/login?e=2");
    return NextResponse.json({ ok: false, error: "尝试太频繁，请稍后再登" }, { status: 429 });
  }
  const account = await authenticate(username, password);
  if (!account) {
    if (form) return redirectTo(request, "/login?e=1");
    return NextResponse.json({ ok: false, error: "账号或密码不正确" }, { status: 401 });
  }
  const cookie = sessionCookie(cookieSecure(request), signSession({
    username: account.username,
    accountId: account.id,
    role: account.role,
    opens: account.opens,
    sharesParent: account.sharesParent,
  }));
  const res = form ? redirectTo(request, "/admin") : NextResponse.json({ ok: true });
  res.cookies.set(cookie.name, cookie.value, cookie.options);
  return res;
}
