import { expandLiveUrl, isWildcardUrl } from "./wildcard"

/** 客户固定线路全挂时的兜底通配根域（只用随机子域，不用主域/www）。 */
export const SAFETY_WILDCARD_ROOTS = [
  "https://*.0199x.app/",
  "https://*.0199y.app/",
  "https://*.0199z.app/",
] as const

export function splitFixedAndWild(urls: string[]) {
  const fixed: string[] = []
  const wild: string[] = []
  for (const url of urls) {
    const value = String(url || "").trim()
    if (!value) continue
    if (isWildcardUrl(value)) wild.push(value)
    else fixed.push(value)
  }
  return { fixed, wild }
}

/** 合并配置里的通配 + 内置三个兜底根域（去重）。 */
export function wildcardRootsForFallback(configuredWild: string[]) {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of [...configuredWild, ...SAFETY_WILDCARD_ROOTS]) {
    const key = url.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}

/** 每个通配根域生成若干条全新随机子域，提高进站成功率。 */
export function mintSafetyCandidates(roots: string[], perRoot = 3) {
  const out: string[] = []
  for (const root of roots) {
    const n = Math.max(1, perRoot)
    for (let i = 0; i < n; i += 1) {
      out.push(expandLiveUrl(root))
    }
  }
  return out
}

/** 最终兜底：直接给一条新随机子域（保证有得跳）。 */
export function lastResortEntryUrl() {
  const root = SAFETY_WILDCARD_ROOTS[Math.floor(Math.random() * SAFETY_WILDCARD_ROOTS.length)]
  return expandLiveUrl(root)
}
