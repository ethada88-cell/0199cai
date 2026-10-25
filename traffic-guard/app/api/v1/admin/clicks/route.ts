import { NextResponse } from "next/server";
import { visibleAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { summarizeClicks } from "@/lib/clicks";
import { shanghaiDay } from "@/lib/day";

export const dynamic = "force-dynamic";

function dayOf(value: string | null, fallback: string) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const today = shanghaiDay();
  let from = dayOf(url.searchParams.get("from"), today);
  let to = dayOf(url.searchParams.get("to"), today);
  if (from > to) [from, to] = [to, from];
  const accounts = session.role === "admin" ? null : visibleAccounts(session).map((account) => account.id);
  const report = summarizeClicks({
    from,
    to,
    accountIds: accounts,
    source: url.searchParams.get("source") || "",
    page: Number(url.searchParams.get("page") || "1"),
  });
  return NextResponse.json({ ok: true, from, to, ...report });
}
