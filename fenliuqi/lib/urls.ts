export function isBlockedHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/\.+$/, "").replace(/^\[|\]$/g, "")
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "metadata.google.internal" ||
    host === "metadata.internal"
  ) {
    return true
  }

  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!match) return false

  const parts = match.slice(1).map(Number)
  if (parts.some((part) => part > 255)) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function normalizeHttpUrl(input: string) {
  let raw = input.trim()
  if (!raw || raw.startsWith("#")) return null
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
    raw = `https://${raw}`
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.username || url.password) return null
  if (!url.hostname || isBlockedHost(url.hostname)) return null
  return url.toString()
}

export function parseDomainLines(text: string) {
  const items: { url: string; label: string }[] = []
  const skipped: string[] = []

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const pieces = trimmed.split(/\s+\|\s+|\s{2,}|\t+/)
    const urlPart = pieces[0]?.trim() ?? ""
    const label = pieces.slice(1).join(" ").trim()
    const url = normalizeHttpUrl(urlPart)
    if (!url) {
      skipped.push(trimmed)
      continue
    }
    items.push({ url, label })
  }

  return { items, skipped }
}

export function isSiteCode(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,40}$/.test(value)
}

export function isToken(value: string) {
  return /^[A-Za-z0-9_-]{4,64}$/.test(value)
}
