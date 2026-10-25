import { NextResponse } from "next/server";
import { accountById } from "@/lib/accounts";
import { normalizeSiteKey, siteFromHeaders } from "@/lib/site";
import { judgeSlide, type SlideTrace } from "@/lib/slide";
import { acceptHuman, failSlide, markPopup, noteDwell, notePerfectSlide } from "@/lib/store";

export const dynamic = "force-dynamic";

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}

/** 弹窗/滑动上报：缺字段时软失败，避免 access 日志被 400 刷屏。 */
function softFail(extra: Record<string, unknown> = {}) {
  return withCors(NextResponse.json({ ok: false, ...extra }));
}

async function readBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  // sendBeacon / 跨域嵌入用 text/plain 传 JSON；application/json 在 beacon 下常被静默丢弃。
  try {
    const text = await request.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  const body = await readBody<{
    account?: string;
    siteKey?: string;
    id?: string;
    kind?: string;
    trace?: SlideTrace;
    dwell?: number;
    commit?: boolean;
  }>(request);
  const account = accountById(String(body.account || ""));
  const observed = siteFromHeaders(request.headers);
  const claimed = normalizeSiteKey(body.siteKey);
  // Origin 与声明域名冲突：忽略本次上报（不当 400）
  if (!account || !account.enabled || (observed && claimed && observed !== claimed)) {
    return softFail();
  }
  // 优先 Origin；WebView / beacon 偶发无 Origin 时回退 body.siteKey
  const siteKey = observed || claimed;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!siteKey || !/^[0-9a-f-]{36}$/i.test(id)) {
    return softFail({ reason: "bad_request" });
  }
  if (body.kind === "dwell") {
    const dwell = typeof body.dwell === "number" ? body.dwell : Number(body.dwell);
    if (!Number.isFinite(dwell)) return softFail({ reason: "bad_dwell" });
    return withCors(NextResponse.json({ ok: noteDwell(account.id, siteKey, id, dwell, body.commit === true) }));
  }
  if (body.kind === "pass") {
    // 滑过仍记真量；轨迹像脚本则打回假量，用来压「滑动成功」、不放过刷量。
    const verdict = judgeSlide(body.trace || ({} as SlideTrace));
    if (verdict === "perfect") {
      notePerfectSlide(account.id, siteKey, id);
      return withCors(NextResponse.json({ ok: false, human: false }));
    }
    if (verdict !== "human") {
      failSlide(account.id, siteKey, id);
      return withCors(NextResponse.json({ ok: false, human: false }));
    }
    return withCors(NextResponse.json({ ok: acceptHuman(account.id, siteKey, id), human: true }));
  }
  const kind = body.kind === "close" ? "close" : body.kind === "show" ? "show" : "";
  if (!kind) {
    return softFail({ reason: "bad_kind" });
  }
  const saved = markPopup(account.id, siteKey, id, kind);
  return withCors(NextResponse.json({ ok: saved }));
}
