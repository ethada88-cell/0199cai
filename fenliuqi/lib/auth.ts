import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"

const COOKIE = "lg_session"
const WEEK = 60 * 60 * 24 * 7

function secret() {
  return process.env.SESSION_SECRET || "linegate-dev-session-secret"
}

export function adminPassword() {
  return process.env.ADMIN_PASSWORD || "linegate-admin"
}

export function passwordMatches(input: string) {
  const expected = Buffer.from(adminPassword())
  const actual = Buffer.from(input)
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
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
