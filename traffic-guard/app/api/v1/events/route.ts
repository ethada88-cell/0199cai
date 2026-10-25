import { NextResponse } from "next/server";
import { normalizeAccountId, visibleAccounts } from "@/lib/accounts";
import { currentSession, type Session } from "@/lib/auth";
import { shanghaiDay } from "@/lib/day";
import { normalizeSiteKey } from "@/lib/site";
import { reportAccounts, type VerdictFilter } from "@/lib/store";

export const dynamic = "force-dynamic";

function dayParam(value: string | null, fallback: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return fallback;
}

function scopeFor(session: Session, requested: string | null) {
  const visible = visibleAccounts(session).map((account) => ({ id: account.id, username: account.username }));
  const canPick = session.role === "admin" || session.opens || session.sharesParent;
  if (!canPick) {
    return { account: session.accountId, accounts: visible };
  }
  const pick = requested || "*";
  if (pick === "*") return { account: "*", accounts: visible };
  const id = normalizeAccountId(pick);
  const found = visible.find((account) => account.id === id);
  if (!found) return null;
  return { account: found.id, accounts: [found] };
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const scope = scopeFor(session, url.searchParams.get("account"));
  if (!scope) {
    return NextResponse.json({ ok: false, error: "invalid_account" }, { status: 400 });
  }
  const rawSite = url.searchParams.get("site");
  const all = !rawSite || rawSite === "*";
  const siteKey = all ? null : normalizeSiteKey(rawSite);
  if (!all && !siteKey) {
    return NextResponse.json({ ok: false, error: "invalid_site" }, { status: 400 });
  }
  const today = shanghaiDay();
  let from = dayParam(url.searchParams.get("from"), today);
  let to = dayParam(url.searchParams.get("to"), today);
  if (from > to) [from, to] = [to, from];
  const picked = url.searchParams.get("verdict");
  const allowed: VerdictFilter[] = ["fake", "farm", "crawler", "other", "emulator", "cloud_phone", "auto"];
  const verdict: VerdictFilter = allowed.includes(picked as VerdictFilter) ? picked as VerdictFilter : "fake";
  return NextResponse.json({
    ok: true,
    account: scope.account,
    siteKey: siteKey || "*",
    from,
    to,
    verdict,
    ...reportAccounts(scope.accounts, siteKey, from, to, verdict),
  });
}
