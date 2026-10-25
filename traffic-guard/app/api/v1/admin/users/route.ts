import { NextResponse } from "next/server";
import { createAccount, managedAccounts, resetPassword, setAccountEnabled } from "@/lib/accounts";
import { currentSession, type Session } from "@/lib/auth";
import { clickSnippet, embedSnippet } from "@/lib/origin";

export const dynamic = "force-dynamic";

async function manageSession() {
  const session = await currentSession();
  if (!session) return { error: NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }) };
  if (session.role !== "admin" && !session.opens) return { error: NextResponse.json({ ok: false, error: "没有开通账号的权限" }, { status: 403 }) };
  return { session };
}

function listed(session: Session) {
  return managedAccounts(session).map((account) => ({
    ...account,
    snippet: embedSnippet(account.id, account.username),
    clickSnippet: clickSnippet(account.id, account.username),
  }));
}

export async function GET() {
  const gate = await manageSession();
  if (gate.error) return gate.error;
  return NextResponse.json({ ok: true, accounts: listed(gate.session) });
}

export async function POST(request: Request) {
  const gate = await manageSession();
  if (gate.error) return gate.error;
  let body: { action?: string; username?: string; password?: string; enabled?: boolean } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }
  if (body.action === "status") {
    const error = setAccountEnabled(String(body.username || ""), Boolean(body.enabled), gate.session.accountId);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    return NextResponse.json({ ok: true, accounts: listed(gate.session) });
  }
  if (body.action === "password") {
    const error = resetPassword(String(body.username || ""), String(body.password || ""), gate.session.accountId);
    if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
    return NextResponse.json({ ok: true, accounts: listed(gate.session) });
  }
  const parentId = gate.session.role === "admin" ? "" : gate.session.accountId;
  const created = createAccount(String(body.username || ""), String(body.password || ""), parentId);
  if (created.error || !created.account) return NextResponse.json({ ok: false, error: created.error || "没有开通" }, { status: 400 });
  return NextResponse.json({
    ok: true,
    account: {
      ...created.account,
      snippet: embedSnippet(created.account.id, created.account.username),
      clickSnippet: clickSnippet(created.account.id, created.account.username),
    },
    accounts: listed(gate.session),
  });
}
