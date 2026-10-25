import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAccountId } from "@/lib/accounts";

const ROOT = path.resolve(process.cwd(), "data", "accounts");
export const MEMO_MAX = 8000;

function locate(accountId: string) {
  const account = normalizeAccountId(accountId);
  if (!account) return null;
  const dir = path.resolve(ROOT, account);
  if (dir !== path.join(ROOT, account)) return null;
  return { account, file: path.join(dir, "memo.json") };
}

export function cleanMemo(input: unknown) {
  const text = String(input ?? "").replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  return text.length > MEMO_MAX ? text.slice(0, MEMO_MAX) : text;
}

export function readMemo(accountId: string) {
  const loc = locate(accountId);
  if (!loc || !existsSync(loc.file)) return "";
  try {
    const parsed = JSON.parse(readFileSync(loc.file, "utf8")) as { text?: unknown };
    if (!parsed || typeof parsed !== "object") return "";
    return cleanMemo(parsed.text);
  } catch {
    return "";
  }
}

export function writeMemo(accountId: string, text: unknown) {
  const loc = locate(accountId);
  if (!loc) return null;
  const clean = cleanMemo(text);
  mkdirSync(path.dirname(loc.file), { recursive: true });
  writeFileSync(loc.file, JSON.stringify({ text: clean, updatedAt: Date.now() }));
  return clean;
}
