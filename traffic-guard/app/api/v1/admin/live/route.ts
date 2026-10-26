import { NextResponse } from "next/server";
import { normalizeAccountId, visibleAccounts } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { addDays, monthStart, shanghaiDay } from "@/lib/day";
import { liveDashboardTotals } from "@/lib/store";

export const dynamic = "force-dynamic";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampDay(value: string | null, fallback: string) {
  const day = String(value || "").trim();
  return DAY_RE.test(day) ? day : fallback;
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const today = shanghaiDay();
  const from = clampDay(url.searchParams.get("from"), today);
  const to = clampDay(url.searchParams.get("to"), today);
  const rangeOk = from <= to && from >= addDays(today, -366) && to <= addDays(today, 1);
  const safeFrom = rangeOk ? from : today;
  const safeTo = rangeOk ? to : today;

  const visible = visibleAccounts(session);
  const canPick = session.role === "admin" || session.opens || session.sharesParent;
  const requested = url.searchParams.get("account") || "*";
  let accounts = visible;
  if (!canPick) {
    accounts = visible.filter((item) => item.id === session.accountId);
  } else if (requested !== "*") {
    const id = normalizeAccountId(requested);
    const found = id ? visible.find((item) => item.id === id) : undefined;
    if (!found) return NextResponse.json({ ok: false, error: "invalid_account" }, { status: 400 });
    accounts = [found];
  }

  const totals = liveDashboardTotals(
    accounts.map((item) => ({ id: item.id })),
    safeFrom,
    safeTo,
  );

  return NextResponse.json({
    ok: true,
    at: Date.now(),
    from: safeFrom,
    to: safeTo,
    today,
    monthStart: monthStart(today),
    ...totals,
  });
}
