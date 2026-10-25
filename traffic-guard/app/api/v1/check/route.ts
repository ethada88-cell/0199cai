import { NextResponse } from "next/server";
import { accountById } from "@/lib/accounts";
import { runCheck } from "@/lib/check";
import { clientIp } from "@/lib/ip";
import { startEventLoopMonitor } from "@/lib/load";
import { normalizeSiteKey, siteFromHeaders } from "@/lib/site";
import type { ClientSignals } from "@/lib/types";

export const dynamic = "force-dynamic";

startEventLoopMonitor();

function withCors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
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
    signals?: ClientSignals;
    source?: unknown;
    followUp?: boolean;
  }>(request);
  const account = accountById(String(body.account || ""));
  if (!account || !account.enabled) {
    return withCors(NextResponse.json({ ok: true, action: "allow", tracked: false, accountId: "" }));
  }
  const observed = siteFromHeaders(request.headers);
  const claimed = normalizeSiteKey(body.siteKey);
  const siteKey = observed || claimed;
  const ua = request.headers.get("user-agent") || "";
  const leaving = Boolean(body.signals?.engagement?.leaving);
  const followUp = body.followUp === true || leaving;

  // 首次进站：快速放行、不记量（与前置一致）。二次监测一律完整评分并尽量落盘。
  if (!followUp) {
    return withCors(
      NextResponse.json({
        ok: true,
        id: "",
        at: Date.now(),
        accountId: account.id,
        siteKey: siteKey || "",
        verdict: "real",
        action: "allow",
        challenge: false,
        farm: false,
        virtual: false,
        tracked: false,
        score: 0,
        categories: [],
        reasons: [],
        ua,
      }),
    );
  }

  // 前置异步补记会带 x-tg-idempotency-key，避免超时重试双计。
  const idemRaw = request.headers.get("x-tg-idempotency-key") || "";
  const idem = /^[0-9a-f-]{36}$/i.test(idemRaw) ? idemRaw : undefined;

  // 二次监测一律完整评分并落盘，不再因 cold/overload 直接丢数。
  const result = runCheck({
    ip: clientIp(request.headers),
    accountId: account.id,
    siteKey: siteKey || "direct",
    signals: body.signals || {},
    headerUa: ua,
    source: body.source,
    persist: Boolean(siteKey),
    followUp: true,
    id: idem,
  });
  const { fp, ...publicResult } = result as typeof result & { fp?: string };
  void fp;
  if (!siteKey) publicResult.siteKey = "";
  return withCors(NextResponse.json(publicResult));
}
