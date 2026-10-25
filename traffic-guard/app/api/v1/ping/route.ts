import { NextResponse } from "next/server";
import { eventLoopLagMs } from "@/lib/load";

export const dynamic = "force-dynamic";

/** 轻量探活：不读盘、不评分，供 Docker healthcheck 使用。 */
export function GET() {
  return NextResponse.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    lagMs: eventLoopLagMs(),
  });
}
