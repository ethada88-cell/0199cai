import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import path from "path"

type Entry = { url: string; at: number }
type FileShape = Record<string, Entry>

const TTL_MS = 120_000
const file = path.join(process.cwd(), "data", "last-good.json")

// process-local mirror; file is source of truth across workers/restarts
const memory = new Map<string, Entry>()

function readFile(): FileShape {
  try {
    if (!existsSync(file)) return {}
    const parsed = JSON.parse(readFileSync(file, "utf8")) as FileShape
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeFile(data: FileShape) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
}

function fresh(entry: Entry | undefined): string | null {
  if (!entry) return null
  if (Date.now() - entry.at > TTL_MS) return null
  return entry.url
}

export function getLastGood(siteCode: string): string | null {
  const fromMem = fresh(memory.get(siteCode))
  if (fromMem) return fromMem

  const data = readFile()
  const url = fresh(data[siteCode])
  if (!url) {
    memory.delete(siteCode)
    return null
  }
  memory.set(siteCode, data[siteCode])
  return url
}

export function setLastGood(siteCode: string, url: string) {
  const entry = { url, at: Date.now() }
  memory.set(siteCode, entry)
  try {
    const data = readFile()
    data[siteCode] = entry
    writeFile(data)
  } catch {
    // best-effort; memory still helps within this process
  }
}
