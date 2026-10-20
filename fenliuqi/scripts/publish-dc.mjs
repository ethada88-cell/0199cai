import { createCipheriv, createHash } from "crypto"
import { promises as fs } from "fs"
import path from "path"

const root = process.cwd()
const storePath = path.join(root, "data", "store.json")
const dcDir = path.join(root, "data", "dc")

function loadEnv() {
  try {
    const raw = require("fs").readFileSync(path.join(root, ".env"), "utf8")
    for (const line of raw.split("\n")) {
      const i = line.indexOf("=")
      if (i <= 0 || line.startsWith("#")) continue
      const k = line.slice(0, i).trim()
      const v = line.slice(i + 1).trim()
      if (!process.env[k]) process.env[k] = v
    }
  } catch {}
}

loadEnv()

const key = Buffer.from(
  process.env.JUMP_AES_KEY || process.env.NEXT_PUBLIC_JUMP_AES_KEY || "01sg4CXbluB1it3b",
  "utf8"
)
const iv = Buffer.from(
  process.env.JUMP_AES_IV || process.env.NEXT_PUBLIC_JUMP_AES_IV || "Tssmyuzo24eraO5f",
  "utf8"
)

function encrypt(payload) {
  const cipher = createCipheriv("aes-128-cbc", key, iv)
  return Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()])
    .toString("hex")
    .toUpperCase()
}

const store = JSON.parse(await fs.readFile(storePath, "utf8"))
await fs.mkdir(dcDir, { recursive: true })
for (const site of store.sites || []) {
  const urls = (site.domains || []).filter((d) => d.enabled).map((d) => d.url)
  if (!urls.length) continue
  const payload = {
    siteCode: site.siteCode,
    alias: site.name || site.siteCode,
    token: site.token,
    domains: urls.join(","),
  }
  const file = path.join(dcDir, `${site.siteCode}-${site.token}.txt`)
  await fs.writeFile(file, encrypt(payload), "utf8")
  console.log("published", path.basename(file), urls.length, "domains")
}
console.log("ok", createHash("sha256").update(key).digest("hex").slice(0, 8))
