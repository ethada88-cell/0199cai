import { decryptDomainConfig, domainsFromPayload } from "./config-crypto"
import { fallbackLine, fastestLine, probeDomains, probeDomainsQuick } from "./probe"
import { readStore } from "./store"
import type { Domain, ProbeLine } from "./types"

export type JumpTarget = {
  site: { name: string; siteCode: string }
  domains: Domain[]
  source: "encrypted" | "site"
  cacheKey: string
}

export async function resolveJumpTarget(input: {
  d?: string
  siteCode?: string
  token?: string
}): Promise<{ ok: true; target: JumpTarget } | { ok: false; status: number; error: string }> {
  const d = input.d?.trim() || ""
  if (d) {
    try {
      const payload = decryptDomainConfig(d)
      const domains = domainsFromPayload(payload)
      return {
        ok: true,
        target: {
          site: {
            name: payload.name || "加密入口",
            siteCode: "encrypted",
          },
          domains,
          source: "encrypted",
          cacheKey: `d:${createHashKey(d)}`,
        },
      }
    } catch (error) {
      return {
        ok: false,
        status: 400,
        error: error instanceof Error ? error.message : "加密配置无效",
      }
    }
  }

  const siteCode = input.siteCode?.trim() || ""
  const token = input.token?.trim() || ""
  if (!siteCode || !token) {
    return { ok: false, status: 400, error: "缺少加密配置，或站点代号/令牌" }
  }

  const store = await readStore()
  const site = store.sites.find((item) => item.siteCode === siteCode && item.token === token)
  if (!site) {
    return { ok: false, status: 404, error: "没有找到这个站点，或令牌不正确" }
  }
  const enabled = site.domains.filter((domain) => domain.enabled)
  if (!enabled.length) {
    return { ok: false, status: 404, error: "这个站点还没有启用的域名" }
  }
  return {
    ok: true,
    target: {
      site: { name: site.name, siteCode: site.siteCode },
      domains: site.domains,
      source: "site",
      cacheKey: `s:${site.siteCode}`,
    },
  }
}

function createHashKey(value: string) {
  let h = 0
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0
  }
  return h.toString(16)
}

export async function runJumpProbe(
  domains: Domain[],
  mode: "quick" | "full" | "skip"
): Promise<{ lines: ProbeLine[]; targetUrl: string | null }> {
  const lines =
    mode === "skip"
      ? await probeDomains(domains, false)
      : mode === "full"
        ? await probeDomains(domains, true)
        : await probeDomainsQuick(domains)
  const best = fastestLine(lines)
  const fallback = fallbackLine(domains)
  return {
    lines,
    targetUrl: best?.url || fallback?.url || null,
  }
}
