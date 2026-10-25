import { NextResponse } from "next/server";
import { canWriteSiteNote, normalizeAccountId } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";
import { writeSiteNote } from "@/lib/site-note";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let accountId = "";
  let site = "";
  let note = "";
  try {
    const body = (await request.json()) as { accountId?: string; site?: string; note?: string };
    accountId = String(body.accountId || session.accountId);
    site = String(body.site || "");
    note = String(body.note || "");
  } catch {
    return NextResponse.json({ ok: false, error: "备注没有保存" }, { status: 400 });
  }
  const id = normalizeAccountId(accountId);
  if (!id || !canWriteSiteNote(session, id)) return NextResponse.json({ ok: false, error: "备注没有保存" }, { status: 400 });
  const saved = writeSiteNote(id, site, note);
  if (saved == null) return NextResponse.json({ ok: false, error: "备注没有保存" }, { status: 400 });
  return NextResponse.json({ ok: true, note: saved });
}
