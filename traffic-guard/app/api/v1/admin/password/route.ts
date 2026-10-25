import { NextResponse } from "next/server";
import { changePassword } from "@/lib/accounts";
import { currentSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let oldPassword = "";
  let newPassword = "";
  try {
    const body = (await request.json()) as { oldPassword?: string; newPassword?: string };
    oldPassword = String(body.oldPassword || "");
    newPassword = String(body.newPassword || "");
  } catch {
    return NextResponse.json({ ok: false, error: "密码没有改成" }, { status: 400 });
  }
  const error = changePassword(session.accountId, oldPassword, newPassword);
  if (error) return NextResponse.json({ ok: false, error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
