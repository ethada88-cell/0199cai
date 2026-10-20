import { promises as fs } from "fs"
import path from "path"
import { buildDcPayload, encryptDcPayload } from "./dc-crypto"
import type { Site, Store } from "./types"

const dcDir = path.join(process.cwd(), "data", "dc")

export function dcFileName(siteCode: string, token: string) {
  return `${siteCode}-${token}.txt`
}

export async function publishSiteDc(site: Site) {
  const enabled = site.domains.filter((domain) => domain.enabled)
  await fs.mkdir(dcDir, { recursive: true })
  const file = path.join(dcDir, dcFileName(site.siteCode, site.token))
  if (!enabled.length) {
    await fs.rm(file, { force: true })
    return null
  }
  const hex = encryptDcPayload(buildDcPayload(site))
  await fs.writeFile(file, hex, "utf8")
  return file
}

export async function removeSiteDc(siteCode: string, token: string) {
  await fs.rm(path.join(dcDir, dcFileName(siteCode, token)), { force: true })
}

export async function publishAllDc(store: Store) {
  await fs.mkdir(dcDir, { recursive: true })
  const keep = new Set<string>()
  for (const site of store.sites) {
    const name = dcFileName(site.siteCode, site.token)
    keep.add(name)
    await publishSiteDc(site)
  }
  const existing = await fs.readdir(dcDir).catch(() => [] as string[])
  await Promise.all(
    existing
      .filter((name) => name.endsWith(".txt") && !keep.has(name))
      .map((name) => fs.rm(path.join(dcDir, name), { force: true }))
  )
}

export async function readDcFile(name: string) {
  const safe = path.basename(name)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*-[A-Za-z0-9_-]+\.txt$/.test(safe)) {
    return null
  }
  try {
    return await fs.readFile(path.join(dcDir, safe), "utf8")
  } catch {
    return null
  }
}
