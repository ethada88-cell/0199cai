import { createCipheriv, createDecipheriv } from "crypto"
import { publicJumpIv, publicJumpKey } from "./jump-keys"

/** Match reference Vue jump: CryptoJS AES-128-CBC, ciphertext as uppercase hex. */
export type DcPayload = {
  siteCode: string
  alias: string
  token: string
  domains: string
}

function keyIv() {
  const key = Buffer.from(publicJumpKey(), "utf8")
  const iv = Buffer.from(publicJumpIv(), "utf8")
  if (key.length !== 16 || iv.length !== 16) {
    throw new Error("JUMP_AES_KEY / JUMP_AES_IV 必须各 16 字节")
  }
  return { key, iv }
}

export function encryptDcPayload(payload: DcPayload): string {
  const { key, iv } = keyIv()
  const cipher = createCipheriv("aes-128-cbc", key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])
  return enc.toString("hex").toUpperCase()
}

export function decryptDcPayload(hex: string): DcPayload {
  const { key, iv } = keyIv()
  const decipher = createDecipheriv("aes-128-cbc", key, iv)
  const plain = Buffer.concat([decipher.update(Buffer.from(hex.trim(), "hex")), decipher.final()])
  return JSON.parse(plain.toString("utf8")) as DcPayload
}

export function buildDcPayload(site: {
  siteCode: string
  name: string
  token: string
  domains: Array<{ url: string; enabled: boolean }>
}): DcPayload {
  const urls = site.domains.filter((domain) => domain.enabled).map((domain) => domain.url)
  return {
    siteCode: site.siteCode,
    alias: site.name || site.siteCode,
    token: site.token,
    domains: urls.join(","),
  }
}
