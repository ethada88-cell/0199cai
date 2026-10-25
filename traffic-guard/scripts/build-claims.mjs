import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const VERSION = 2;
const MAX_IPS = 200_000;
const MAX_LABELS = 12;
const SPOOF = new Set(["virtual_gpu", "emulator", "cloud_phone", "device_mismatch"]);

function deviceLabel(ua) {
  const text = (ua || "").trim();
  if (!text) return "";
  if (/云手机|cloud.?phone|redfinger|vmos|geelark|红手指|多多云/i.test(text)) return "云手机";
  if (/bluestacks|nox|ldplayer|雷电|夜神|emulator|sdk_gphone|goldfish/i.test(text)) return "模拟器";
  if (/iPhone/i.test(text)) {
    const ver = text.match(/iPhone OS (\d+[_\d]*)/i);
    return ver ? `iPhone ${ver[1].replace(/_/g, ".")}` : "iPhone";
  }
  if (/iPad/i.test(text)) return "iPad";
  if (/OpenHarmony|HarmonyOS/i.test(text)) {
    const browser = text.match(/(HuaweiBrowser|VivoBrowser|MiuiBrowser|Chrome)\/[\d.]+/i);
    return browser ? `鸿蒙 · ${browser[1]}` : "鸿蒙手机";
  }
  if (/Android/i.test(text)) {
    const model = text.match(/;\s*([^;)]{2,40}?)\s+Build\//i);
    if (model) return model[1].trim();
    if (/Mobile|wv\)/i.test(text)) return "Android 手机";
    return "Android";
  }
  if (/Windows/i.test(text)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(text)) return "Mac";
  if (/Linux/i.test(text)) return "Linux";
  return text.slice(0, 40);
}

function claimedPhone(ua) {
  return /iPhone|iPad|iPod|Android/i.test(ua || "");
}

function kindOf(label) {
  if (label.startsWith("iPhone")) return "iPhone";
  if (label.startsWith("iPad")) return "iPad";
  if (label.startsWith("鸿蒙")) return "鸿蒙";
  if (label === "Windows" || label === "Mac" || label === "Linux" || label === "云手机" || label === "模拟器" || label === "Android" || label === "Android 手机") return label;
  return "Android";
}

function evictIndex(slot, incoming) {
  const incomingKind = kindOf(incoming);
  const tally = new Map();
  for (const label of slot.labels) tally.set(kindOf(label), (tally.get(kindOf(label)) || 0) + 1);
  const have = tally.get(incomingKind) || 0;
  let crowd = incomingKind;
  let crowdCount = have;
  if (have === 0) {
    crowd = "";
    crowdCount = 0;
    for (const [kind, count] of tally) {
      if (count > crowdCount) {
        crowd = kind;
        crowdCount = count;
      }
    }
    if (crowdCount <= 1) return -1;
  } else if (have <= 1) return -1;
  let evict = -1;
  let least = Infinity;
  for (let i = 0; i < slot.labels.length; i++) {
    if (kindOf(slot.labels[i]) !== crowd || (slot.counts[i] || 0) > 1) continue;
    if ((slot.counts[i] || 0) < least) {
      least = slot.counts[i] || 0;
      evict = i;
    }
  }
  return evict;
}

function addLabel(book, ip, label, spoof) {
  let slot = book.get(ip);
  if (!slot) {
    if (book.size >= MAX_IPS) return;
    slot = { labels: [], counts: [], spoof: false };
    book.set(ip, slot);
  }
  const index = slot.labels.indexOf(label);
  if (index >= 0) slot.counts[index] = (slot.counts[index] || 0) + 1;
  else if (slot.labels.length < MAX_LABELS) {
    slot.labels.push(label);
    slot.counts.push(1);
  } else {
    const evict = evictIndex(slot, label);
    if (evict >= 0) {
      slot.labels[evict] = label;
      slot.counts[evict] = 1;
    }
  }
  if (spoof) slot.spoof = true;
}

function saveBook(account, book) {
  const ips = {};
  for (const [ip, slot] of book) {
    if (!slot.spoof && slot.labels.length < 2) continue;
    ips[ip] = { s: slot.labels, n: slot.counts, f: slot.spoof ? 1 : 0 };
  }
  const file = path.join(ROOT, account, "claims.json");
  const tmp = `${file}.tmp`;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify({ v: VERSION, ips }));
  renameSync(tmp, file);
  return Object.keys(ips).length;
}

function phoneMark(labels, counts) {
  const ranked = labels.map((label, index) => ({ label, count: counts[index] || 0 })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "en"));
  const list = ranked.slice(0, 6).map((item) => item.label).join("、");
  const more = ranked.length > 6 ? "等" : "";
  return ranked.length > 1 ? `不是真手机 · 换过 ${list}${more}` : `不是真手机 · 自称 ${list}`;
}

const watch = "111.13.217.215";
if (!existsSync(ROOT)) {
  console.error("no accounts dir");
  process.exit(1);
}
for (const account of readdirSync(ROOT)) {
  if (!/^[a-f0-9]{24}$/.test(account)) continue;
  const sites = path.join(ROOT, account, "sites");
  if (!existsSync(sites)) continue;
  const book = new Map();
  for (const name of readdirSync(sites)) {
    const file = path.join(sites, name, "events.jsonl");
    if (!existsSync(file)) continue;
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        const ip = (event.ip || "").trim();
        const label = deviceLabel(event.ua || "");
        if (!ip || !label) continue;
        const spoof = claimedPhone(event.ua || "") && (event.categories || []).some((code) => SPOOF.has(code));
        addLabel(book, ip, label, spoof);
      } catch {
        /* skip a broken line */
      }
    }
  }
  const saved = saveBook(account, book);
  const slot = book.get(watch);
  console.log(account, "saved", saved, slot && slot.spoof ? phoneMark(slot.labels, slot.counts) : "");
}
