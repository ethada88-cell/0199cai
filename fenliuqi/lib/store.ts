import { randomUUID } from "crypto"
import { promises as fs } from "fs"
import path from "path"
import type { Store } from "./types"

const file = path.join(process.cwd(), "data", "store.json")

let chain: Promise<unknown> = Promise.resolve()

function withLock<T>(fn: () => Promise<T>) {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function seed(): Store {
  const now = new Date().toISOString()
  return {
    sites: [
      {
        id: randomUUID(),
        name: "示例站点",
        siteCode: "demo",
        token: "demo-token",
        createdAt: now,
        domains: [
          {
            id: randomUUID(),
            url: "https://example.com/",
            label: "示例线路",
            enabled: true,
            createdAt: now,
          },
          {
            id: randomUUID(),
            url: "https://www.cloudflare.com/",
            label: "Cloudflare",
            enabled: true,
            createdAt: now,
          },
          {
            id: randomUUID(),
            url: "https://linegate-down.invalid/",
            label: "不可用线路",
            enabled: true,
            createdAt: now,
          },
        ],
      },
    ],
  }
}

async function readUnlocked() {
  try {
    const raw = await fs.readFile(file, "utf8")
    const parsed = JSON.parse(raw) as Store
    if (!parsed || !Array.isArray(parsed.sites)) {
      throw new Error("域名库格式不正确")
    }
    return parsed
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code !== "ENOENT") throw error
    const data = seed()
    await writeUnlocked(data)
    return data
  }
}

async function writeUnlocked(data: Store) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))
  await fs.rename(tmp, file)
}

export function readStore() {
  return withLock(readUnlocked)
}

export function updateStore(mutator: (store: Store) => void) {
  return withLock(async () => {
    const store = await readUnlocked()
    mutator(store)
    await writeUnlocked(store)
    return store
  })
}
