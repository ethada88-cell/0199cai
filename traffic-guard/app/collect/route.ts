import { NextResponse } from "next/server";
import { acceptClick, originAllowed, sourceHost } from "@/lib/clicks";
import { clientIp } from "@/lib/ip";

export const dynamic = "force-dynamic";

const PIXEL = Uint8Array.from(Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
const IP_WINDOW_MS = 10 * 1000;
const IP_MAX = 40;
const hits = new Map<string, number[]>();

function limited(ip: string, now: number) {
  const recent = (hits.get(ip) || []).filter((at) => now - at < IP_WINDOW_MS);
  if (recent.length >= IP_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, list] of hits) {
      if (!list.length || now - list[list.length - 1] >= IP_WINDOW_MS) hits.delete(key);
    }
  }
  return false;
}

function finish(request: Request, status: number, body?: Uint8Array) {
  const origin = request.headers.get("origin");
  const host = sourceHost(request.headers);
  const res = body
    ? new NextResponse(new Blob([body as BlobPart]), { status, headers: { "Content-Type": "image/gif" } })
    : new NextResponse(null, { status });
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  if (origin && host && originAllowed(host)) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

function take(request: Request, input: Record<string, unknown>) {
  const now = Date.now();
  const ip = clientIp(request.headers);
  if (limited(ip, now)) return;
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 4000) return;
  try {
    acceptClick(request.headers, input, ip, request.headers.get("user-agent") || "", now);
  } catch {
    /* a full disk still must not change the response the browser is waiting on */
  }
}

export function OPTIONS(request: Request) {
  return finish(request, 204);
}

export async function POST(request: Request) {
  let input: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.length <= 4000) input = JSON.parse(text) as Record<string, unknown>;
  } catch {
    input = {};
  }
  take(request, input);
  return finish(request, 204);
}

export function GET(request: Request) {
  const url = new URL(request.url);
  take(request, {
    target: url.searchParams.get("target") || "",
    slot: url.searchParams.get("slot") || "",
    ad: url.searchParams.get("ad") || "",
    text: url.searchParams.get("text") || "",
    page: url.searchParams.get("page") || "",
    account: url.searchParams.get("account") || "",
  });
  return finish(request, 200, PIXEL);
}
