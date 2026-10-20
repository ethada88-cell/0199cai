import { randomBytes, randomUUID } from "crypto"
import { publishAllDc, publishSiteDc, removeSiteDc } from "./dc-publish"
import { updateStore } from "./store"
import type { Domain, Site } from "./types"
import { isSiteCode, isToken, normalizeDomainEntry } from "./urls"

type AddDomainEntry = { url: string; label: string; wildcard?: boolean }

function makeToken() {
  return randomBytes(8).toString("hex")
}

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

async function republish(site: Site) {
  await publishSiteDc(site)
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
    const rawToken = input.token.trim() || makeToken()
    site.token = cleanToken(rawToken)
    store.sites.unshift(site)
  })
  await republish(site)
  return site
}

export async function updateSite(
  id: string,
  input: { name?: string; siteCode?: string; token?: string }
) {
  let updated: Site | undefined
  let previous: { siteCode: string; token: string } | undefined
  await updateStore((store) => {
    const site = findSite(store.sites, id)
    previous = { siteCode: site.siteCode, token: site.token }
    if (input.name !== undefined) site.name = cleanName(input.name)
    if (input.siteCode !== undefined) {
      site.siteCode = cleanSiteCode(input.siteCode, store.sites, id)
    }
    if (input.token !== undefined) site.token = cleanToken(input.token)
    updated = site
  })
  if (
    previous &&
    updated &&
    (previous.siteCode !== updated.siteCode || previous.token !== updated.token)
  ) {
    await removeSiteDc(previous.siteCode, previous.token)
  }
  await republish(updated!)
  return updated!
}

export async function deleteSite(id: string) {
  let removed: Site | undefined
  await updateStore((store) => {
    const index = store.sites.findIndex((item) => item.id === id)
    if (index < 0) throw new StoreError(404, "站点不存在")
    removed = store.sites[index]
    store.sites.splice(index, 1)
  })
  if (removed) await removeSiteDc(removed.siteCode, removed.token)
}

export async function addDomains(siteId: string, entries: AddDomainEntry[]) {
  if (!entries.length) throw new StoreError(400, "没有可添加的域名")

  const added: Domain[] = []
  const skipped: string[] = []
  let siteSnap: Site | undefined

  await updateStore((store) => {
    const site = findSite(store.sites, siteId)
    for (const entry of entries) {
      const url = normalizeDomainEntry(entry.url, { wildcard: entry.wildcard })
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
    siteSnap = { ...site, domains: [...site.domains] }
  })
  if (siteSnap) await republish(siteSnap)
  return { added, skipped }
}

export async function updateDomain(
  siteId: string,
  domainId: string,
  input: { label?: string; enabled?: boolean; move?: "up" | "down" }
) {
  let siteSnap: Site | undefined
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
    siteSnap = { ...site, domains: [...site.domains] }
  })
  if (siteSnap) await republish(siteSnap)
}

export async function deleteDomain(siteId: string, domainId: string) {
  let siteSnap: Site | undefined
  await updateStore((store) => {
    const site = findSite(store.sites, siteId)
    const index = site.domains.findIndex((domain) => domain.id === domainId)
    if (index < 0) throw new StoreError(404, "域名不存在")
    site.domains.splice(index, 1)
    siteSnap = { ...site, domains: [...site.domains] }
  })
  if (siteSnap) await republish(siteSnap)
}

export async function syncAllDcFiles() {
  const { readStore } = await import("./store")
  const store = await readStore()
  await publishAllDc(store)
}
