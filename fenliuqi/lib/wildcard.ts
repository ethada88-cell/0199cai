const LABEL_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"

/** 每次调用生成新的随机子域标签（不含 www / 空）。 */
export function randomSubLabel(length = 10) {
  const bytes = new Uint8Array(length)
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  let out = ""
  for (let i = 0; i < length; i += 1) {
    out += LABEL_ALPHABET[bytes[i] % LABEL_ALPHABET.length]
  }
  // 避免极低概率撞上保留名
  if (out === "www" || out === "mail" || out === "ftp") {
    return randomSubLabel(length)
  }
  return out
}

export function isWildcardUrl(value: string) {
  return /^https?:\/\/\*\.[^/]+/i.test(String(value || "").trim())
}

/** 把 https://*.0199x.app/ 展开成 https://{随机}.0199x.app/，绝不返回主域或 www。 */
export function expandLiveUrl(value: string): string {
  const raw = String(value || "").trim()
  const match = raw.match(/^(https?):\/\/\*\.([^/:]+)(?::(\d+))?(\/.*)?$/i)
  if (!match) return raw
  const protocol = match[1].toLowerCase()
  const root = match[2].toLowerCase()
  const port = match[3] ? `:${match[3]}` : ""
  const path = match[4] || "/"
  const label = randomSubLabel(10)
  return `${protocol}://${label}.${root}${port}${path}`
}

export function expandLiveUrls(urls: string[]) {
  return urls.map((url) => expandLiveUrl(url))
}

/** 根域规范化：0199x.app / *.0199x.app → https://*.0199x.app/ */
export function normalizeWildcardRoot(input: string): string | null {
  let raw = input.trim().toLowerCase()
  if (!raw) return null
  raw = raw.replace(/^wildcard:/i, "")
  raw = raw.replace(/^https?:\/\//i, "")
  raw = raw.replace(/\/.*$/, "")
  raw = raw.replace(/^\*\./, "")
  raw = raw.replace(/^www\./, "")
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw)) {
    return null
  }
  // 至少要有一个点（是域名而不是单标签）
  if (!raw.includes(".")) return null
  return `https://*.${raw}/`
}
