import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAccountId } from "@/lib/accounts";
import { normalizeSiteKey } from "@/lib/site";

const ROOT = path.resolve(process.cwd(), "data", "accounts");
const MAX_NOTE = 80;

function locate(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return null;
  const dir = path.resolve(ROOT, account);
  if (dir !== path.join(ROOT, account)) return null;
  return { account, file: path.join(dir, "site-notes.json") };
}

export function cleanSiteNote(input: unknown) {
  return String(input || "").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
}

export function readSiteNotes(accountId: string) {
  const loc = locate(accountId);
  const notes: Record<string, string> = {};
  if (!loc || !existsSync(loc.file)) return notes;
  try {
    const parsed = JSON.parse(readFileSync(loc.file, "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return notes;
    for (const [key, value] of Object.entries(parsed)) {
      const site = normalizeSiteKey(key);
      const note = cleanSiteNote(value);
      if (site && note) notes[site] = note;
    }
  } catch {
    return notes;
  }
  return notes;
}

export function writeSiteNote(accountId: string, siteKey: string, note: unknown) {
  const loc = locate(accountId);
  const site = normalizeSiteKey(siteKey);
  if (!loc || !site) return null;
  const notes = readSiteNotes(loc.account);
  const clean = cleanSiteNote(note);
  if (clean) notes[site] = clean;
  else delete notes[site];
  mkdirSync(path.dirname(loc.file), { recursive: true });
  writeFileSync(loc.file, JSON.stringify(notes));
  return clean;
}
