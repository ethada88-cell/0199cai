import { NextResponse } from "next/server";
import { normalizeAccountId, visibleAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { readSiteNotes } from "@/lib/site-note";
import { listSitesForPicker } from "@/lib/store";

export const dynamic = "force-dynamic";

const LIMIT = 40;

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const visible = visibleAccounts(session);
  const canPick = session.role === "admin" || session.opens || session.sharesParent;
  const requested = url.searchParams.get("account") || "*";
  let accounts = visible;
  if (!canPick) accounts = visible.filter((item) => item.id === session.accountId);
  else if (requested !== "*") {
    const id = normalizeAccountId(requested);
    const found = id ? visible.find((item) => item.id === id) : undefined;
    if (!found) return NextResponse.json({ ok: false, error: "invalid_account" }, { status: 400 });
    accounts = [found];
  }
  const needle = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase();
  const notes = new Map<string, string>();
  const ranked: Array<{ site: string; note: string; hit: number }> = [];
  const seen = new Set<string>();

  for (const account of accounts) {
    for (const [site, note] of Object.entries(readSiteNotes(account.id))) {
      const prev = notes.get(site);
      if (!prev) notes.set(site, note);
      else if (prev !== note && !prev.split("、").includes(note)) notes.set(site, `${prev}、${note}`);
    }
    // 每账号最多取 LIMIT 条，禁止同步拼出十几万站再 sort。
    const picked = listSitesForPicker(account.id, needle, LIMIT).items;
    for (const site of picked) {
      if (seen.has(site)) continue;
      seen.add(site);
      const note = notes.get(site) || "";
      const hit = needle
        ? note.toLowerCase().includes(needle)
          ? 0
          : site.toLowerCase().startsWith(needle)
            ? 1
            : 2
        : 1;
      ranked.push({ site, note, hit });
    }
    if (!needle) {
      for (const [site, note] of notes) {
        if (seen.has(site)) continue;
        seen.add(site);
        ranked.push({ site, note, hit: 0 });
      }
    } else {
      for (const [site, note] of notes) {
        if (seen.has(site)) continue;
        if (!site.toLowerCase().includes(needle) && !note.toLowerCase().includes(needle)) continue;
        seen.add(site);
        ranked.push({ site, note, hit: note.toLowerCase().includes(needle) ? 0 : 1 });
      }
    }
  }

  ranked.sort((a, b) => a.hit - b.hit || a.site.localeCompare(b.site, "en"));
  const items = ranked.slice(0, LIMIT).map(({ site, note }) => ({ site, note }));
  return NextResponse.json({ ok: true, items, more: Math.max(0, ranked.length - items.length) });
}
