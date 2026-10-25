import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(process.cwd(), "data", "clicks");
const args = process.argv.slice(2);

function flag(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || "" : "";
}

const from = flag("--from");
const to = flag("--to");
const by = flag("--by") || "url";
const source = flag("--source").toLowerCase();

function days() {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .map((name) => name.slice(0, 10))
    .filter((day) => (!from || day >= from) && (!to || day <= to))
    .sort();
}

const counts = new Map();
const ips = new Map();
const allIps = new Set();
let total = 0;
for (const day of days()) {
  const lines = readFileSync(path.join(root, `${day}.jsonl`), "utf8").split("\n");
  for (const line of lines) {
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (source && row.source !== source && !String(row.source || "").endsWith(`.${source}`)) continue;
    total += 1;
    const left = row.source || "未知站点";
    const key = by === "slot" ? `${left}\t${row.slot || "未标广告位"}` : by === "site" ? left : `${left}\t${row.target}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    const ip = String(row.ip || "").trim();
    if (!ip) continue;
    allIps.add(ip);
    const seen = ips.get(key) || new Set();
    seen.add(ip);
    ips.set(key, seen);
  }
}

const ranked = [...counts.entries()].sort((a, b) => (ips.get(b[0])?.size || 0) - (ips.get(a[0])?.size || 0) || b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
console.log(`合计 ${allIps.size} 个出站 IP，${total} 次点击`);
for (const [key, count] of ranked) {
  const label = String(key).split("\t").join("  ");
  console.log(`${String(ips.get(key)?.size || 0).padStart(6)} IP  ${String(count).padStart(6)} 次  ${label}`);
}
