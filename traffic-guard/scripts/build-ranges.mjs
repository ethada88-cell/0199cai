import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SRC = "/tmp/ipdata";

function ipToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    const x = Number(part);
    if (!Number.isInteger(x) || x < 0 || x > 255) return null;
    n = n * 256 + x;
  }
  return n >>> 0;
}

function cidr(cidrText, provider, kind) {
  const [ip, bitsRaw] = cidrText.split("/");
  const start = ipToInt(ip);
  const bits = Number(bitsRaw);
  if (start == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const size = bits === 0 ? 2 ** 32 : 2 ** (32 - bits);
  const end = (start + size - 1) >>> 0;
  return { start, end, provider, kind, span: size };
}

function rangeFromEnds(a, b, provider, kind) {
  const start = ipToInt(a);
  const end = ipToInt(b);
  if (start == null || end == null || end < start) return null;
  return { start, end, provider, kind, span: end - start + 1 };
}

const items = [];

function addFile(path, provider, kind, asCidr = true) {
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const row = asCidr ? cidr(s, provider, kind) : null;
    if (row) items.push(row);
  }
}

addFile(`${SRC}/la-amazon.txt`, "Amazon AWS", "datacenter");
addFile(`${SRC}/la-microsoft.txt`, "Microsoft Azure", "datacenter");
addFile(`${SRC}/la-google.txt`, "Google", "datacenter");
addFile(`${SRC}/la-cloudflare.txt`, "Cloudflare", "proxy");
addFile(`${SRC}/digitalocean.txt`, "DigitalOcean", "datacenter");
addFile(`${SRC}/linode.txt`, "Linode", "datacenter");
addFile(`${SRC}/oracle.txt`, "Oracle Cloud", "datacenter");
addFile(`${SRC}/vultr.txt`, "Vultr", "datacenter");

const gcp = JSON.parse(readFileSync(`${SRC}/gcp.json`, "utf8"));
for (const row of gcp.prefixes || []) {
  if (!row.ipv4Prefix) continue;
  const rec = cidr(row.ipv4Prefix, "Google Cloud", "datacenter");
  if (rec) items.push(rec);
}

const ipcat = readFileSync(`${SRC}/ipcat.csv`, "utf8");
for (const line of ipcat.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [a, b, name] = line.split(",");
  const rec = rangeFromEnds(a, b, name || "机房", "datacenter");
  if (!rec) continue;
  if (rec.span > 2 ** 20) continue;
  if (/cloudflare|fastly/i.test(rec.provider)) rec.kind = "proxy";
  items.push(rec);
}

if (existsSync("data/extra-datacenters.txt")) {
  addFile("data/extra-datacenters.txt", "IDC", "datacenter");
}

items.sort((x, y) => x.start - y.start || x.end - y.end);

const compact = items.map((r) => [r.start, r.end, r.provider, r.kind === "proxy" ? 1 : 0]);
mkdirSync("data", { recursive: true });
writeFileSync("data/ip-ranges.json", JSON.stringify(compact));
console.log("ranges", compact.length, "bytes", Buffer.byteLength(JSON.stringify(compact)));
