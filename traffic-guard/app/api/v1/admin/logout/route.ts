import { NextResponse } from "next/server";
import { cookieSecure, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const dest = host ? `${proto}://${host}/login` : new URL("/login", request.url);
  const res = NextResponse.redirect(dest, 303);
  const cookie = sessionCookie(cookieSecure(request), "");
  res.cookies.set(cookie.name, "", cookie.options);
  return res;
}
