import { randomUUID } from "crypto"
import { updateStore } from "./store"
import type { Domain, Site } from "./types"
import { isSiteCode, isToken, normalizeHttpUrl } from "./urls"

export class StoreError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const DOMAIN_LIMIT = 40

function cleanName(name: string) {
  const value = name.trim()
  if (!value || value.length > 40) {
    throw new StoreError(400, "站点名称需要 1 到 40 个字")
  }
  return value
}

function cleanSiteCode(siteCode: string, sites: Site[], ignoreId?: string) {
  const value = siteCode.trim()
  if (!isSiteCode(value)) {
    throw new StoreError(400, "站点代号只能用字母、数字和短横线，最长 41 位")
  }
  if (sites.some((site) => site.siteCode === value && site.id !== ignoreId)) {
    throw new StoreError(400, "这个站点代号已经用过了")
  }
  return value
}

function cleanToken(token: string) {
  const value = token.trim()
  if (!isToken(value)) {
    throw new StoreError(400, "令牌需要 4 到 64 位字母、数字、下划线或短横线")
  }
  return value
}

function findSite(sites: Site[], id: string) {
  const site = sites.find((item) => item.id === id)
  if (!site) throw new StoreError(404, "站点不存在")
  return site
}

export async function createSite(input: { name: string; siteCode: string; token: string }) {
  const now = new Date().toISOString()
  const site: Site = {
    id: randomUUID(),
    name: "",
    siteCode: "",
    token: "",
    createdAt: now,
    domains: [],
  }

  await updateStore((store) => {
    site.name = cleanName(input.name)
    site.siteCode = cleanSiteCode(input.siteCode, store.sites)
    site.token = cleanToken(input.token)
    store.sites.unshift(site)
  })

  return site
}

export async function updateSite(
  id: string,
  input: { name?: string; siteCode?: string; token?: string }
) {
  let updated: Site | undefined
  await updateStore((store) => {
    const site = findSite(store.sites, id)
    if (input.name !== undefined) site.name = cleanName(input.name)
    if (input.siteCode !== undefined) {
      site.siteCode = cleanSiteCode(input.siteCode, store.sites, id)
    }
    if (input.token !== undefined) site.token = cleanToken(input.token)
    updated = site
  })
  return updated!
}

export async function deleteSite(id: string) {
  await updateStore((store) => {
    const index = store.sites.findIndex((site) => site.id === id)
    if (index < 0) throw new StoreError(404, "站点不存在")
    store.sites.splice(index, 1)
  })
}

export async function addDomains(siteId: string, entries: { url: string; label: string }[]) {
  if (!entries.length) throw new StoreError(400, "没有可添加的域名")

  const added: Domain[] = []
  const skipped: string[] = []

  await updateStore((store) => {
    const site = findSite(store.sites, siteId)
    for (const entry of entries) {
      const url = normalizeHttpUrl(entry.url)
      if (!url) {
        skipped.push(entry.url)
        continue
      }
      if (site.domains.some((domain) => domain.url === url)) {
        skipped.push(url)
        continue
      }
      if (site.domains.length >= DOMAIN_LIMIT) {
        skipped.push(url)
        continue
      }
      const domain: Domain = {
        id: randomUUID(),
        url,
        label: entry.label.trim().slice(0, 40),
        enabled: true,
        createdAt: new Date().toISOString(),
      }
      site.domains.push(domain)
      added.push(domain)
    }
  })

  return { added, skipped }
}

export async function updateDomain(
  siteId: string,
  domainId: string,
  input: { label?: string; enabled?: boolean; move?: "up" | "down" }
) {
  await updateStore((store) => {
    const site = findSite(store.sites, siteId)
    const index = site.domains.findIndex((domain) => domain.id === domainId)
    if (index < 0) throw new StoreError(404, "域名不存在")
    const domain = site.domains[index]
    if (input.label !== undefined) domain.label = input.label.trim().slice(0, 40)
    if (input.enabled !== undefined) domain.enabled = Boolean(input.enabled)
    if (input.move === "up" && index > 0) {
      const previous = site.domains[index - 1]
      site.domains[index - 1] = domain
      site.domains[index] = previous
    }
    if (input.move === "down" && index < site.domains.length - 1) {
      const next = site.domains[index + 1]
      site.domains[index + 1] = domain
      site.domains[index] = next
    }
  })
}

export async function deleteDomain(siteId: string, domainId: string) {
  await updateStore((store) => {
    const site = findSite(store.sites, siteId)
    const index = site.domains.findIndex((domain) => domain.id === domainId)
    if (index < 0) throw new StoreError(404, "域名不存在")
    site.domains.splice(index, 1)
  })
}
