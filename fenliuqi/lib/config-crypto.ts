import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto"
import type { Domain } from "./types"

export type DomainPayload = {
  v: 1
  urls: string[]
  labels?: string[]
  name?: string
  iat?: number
}

function keyBytes() {
  const raw =
    process.env.CONFIG_SECRET || process.env.SESSION_SECRET || "linegate-dev-config-secret"
  return createHash("sha256").update(raw).digest()
}

/** AES-256-GCM → base64url(iv + tag + ciphertext) */
export function encryptDomainConfig(payload: DomainPayload): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv)
  const plain = Buffer.from(JSON.stringify(payload), "utf8")
  const enc = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString("base64url")
}

export function decryptDomainConfig(token: string): DomainPayload {
  const value = token.trim()
  if (!value) throw new Error("缺少加密配置")
  let buf: Buffer
  try {
    buf = Buffer.from(value, "base64url")
  } catch {
    throw new Error("加密配置格式不正确")
  }
  if (buf.length < 12 + 16 + 1) throw new Error("加密配置格式不正确")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv)
  decipher.setAuthTag(tag)
  let plain: Buffer
  try {
    plain = Buffer.concat([decipher.update(data), decipher.final()])
  } catch {
    throw new Error("加密配置无法解密")
  }
  let parsed: DomainPayload
  try {
    parsed = JSON.parse(plain.toString("utf8")) as DomainPayload
  } catch {
    throw new Error("加密配置内容无效")
  }
  if (parsed?.v !== 1 || !Array.isArray(parsed.urls) || !parsed.urls.length) {
    throw new Error("加密配置内容无效")
  }
  const urls = parsed.urls.map((item) => String(item || "").trim()).filter(Boolean)
  if (!urls.length) throw new Error("加密配置里没有域名")
  return {
    v: 1,
    urls,
    labels: Array.isArray(parsed.labels)
      ? parsed.labels.map((item) => String(item || ""))
      : undefined,
    name: parsed.name ? String(parsed.name) : undefined,
    iat: typeof parsed.iat === "number" ? parsed.iat : undefined,
  }
}

export function domainsFromPayload(payload: DomainPayload): Domain[] {
  const now = new Date().toISOString()
  return payload.urls.map((url, index) => ({
    id: `cfg-${index}`,
    url,
    label: payload.labels?.[index]?.trim() || "",
    enabled: true,
    createdAt: now,
  }))
}

export function payloadFromDomains(input: {
  name?: string
  domains: Array<{ url: string; label?: string; enabled?: boolean }>
}): DomainPayload {
  const enabled = input.domains.filter((domain) => domain.enabled !== false)
  return {
    v: 1,
    urls: enabled.map((domain) => domain.url),
    labels: enabled.map((domain) => domain.label || ""),
    name: input.name,
    iat: Date.now(),
  }
}
