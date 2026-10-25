import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { readMemo, writeMemo } from "@/lib/memo";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, text: readMemo(session.accountId) });
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let text: unknown;
  try {
    const body = (await request.json()) as { text?: unknown };
    text = body.text;
  } catch {
    return NextResponse.json({ ok: false, error: "备忘录没有保存" }, { status: 400 });
  }
  if (typeof text !== "string") return NextResponse.json({ ok: false, error: "备忘录没有保存" }, { status: 400 });
  const saved = writeMemo(session.accountId, text);
  if (saved == null) return NextResponse.json({ ok: false, error: "备忘录没有保存" }, { status: 400 });
  return NextResponse.json({ ok: true, text: saved });
}
