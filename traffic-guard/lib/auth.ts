import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { accountById, accountsReady, type Role } from "@/lib/accounts";

export const SESSION_COOKIE = "tg_session";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_SEC = 7 * 24 * 60 * 60;

export type Session = {
  username: string;
  accountId: string;
  role: Role;
  opens: boolean;
  sharesParent: boolean;
};

export function authConfigured() {
  return accountsReady();
}

export function signSession(session: Session) {
  const body = Buffer.from(JSON.stringify({
    u: session.username,
    id: session.accountId,
    role: session.role,
    exp: Date.now() + WEEK_MS,
  })).toString("base64url");
  const sig = createHmac("sha256", process.env.ADMIN_SESSION_SECRET || "").update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function sessionFromToken(token: string | undefined | null): Session | null {
  const secret = process.env.ADMIN_SESSION_SECRET || "";
  if (!token || !secret) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as { u?: string; id?: string; exp?: number };
    if (!payload.u || !payload.id || typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    const account = accountById(payload.id);
    if (!account || !account.enabled || account.username !== payload.u) return null;
    return { username: account.username, accountId: account.id, role: account.role, opens: account.opens, sharesParent: account.sharesParent };
  } catch {
    return null;
  }
}

export async function currentSession() {
  const jar = await cookies();
  return sessionFromToken(jar.get(SESSION_COOKIE)?.value);
}

export function cookieSecure(request: Request) {
  return request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
}

export function sessionCookie(secure: boolean, token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      secure,
      sameSite: "lax" as const,
      path: "/",
      maxAge: token ? WEEK_SEC : 0,
    },
  };
}
