import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"

const COOKIE = "lg_session"
const WEEK = 60 * 60 * 24 * 7

function secret() {
  return process.env.SESSION_SECRET || "linegate-dev-session-secret"
}

export function adminUser() {
  return process.env.ADMIN_USER || "admin"
}

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || "admin123@"
}

function safeEqualText(actual: string, expected: string) {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function credentialsMatch(username: string, password: string) {
  return safeEqualText(username.trim(), adminUser()) && safeEqualText(password, adminPassword())
}

export function signSession() {
  const exp = Date.now() + WEEK * 1000
  const payload = `v1.${exp}`
  const sig = createHmac("sha256", secret()).update(payload).digest("hex")
  return `${payload}.${sig}`
}

export function verifySession(token: string | undefined) {
  if (!token) return false
  const parts = token.split(".")
  if (parts.length !== 3) return false
  const payload = `${parts[0]}.${parts[1]}`
  const expected = createHmac("sha256", secret()).update(payload).digest("hex")
  const actual = Buffer.from(parts[2])
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length) return false
  if (!timingSafeEqual(actual, wanted)) return false
  return Number(parts[1]) > Date.now()
}

export async function isAdmin() {
  const jar = await cookies()
  return verifySession(jar.get(COOKIE)?.value)
}

export async function setSessionCookie() {
  const jar = await cookies()
  jar.set(COOKIE, signSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: WEEK,
  })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
}
