import { NextResponse } from "next/server";
import { currentSession } from "@/lib/auth";
import { runCheck } from "@/lib/check";
import { normalizeSiteKey } from "@/lib/site";
import type { ClientSignals } from "@/lib/types";

export const dynamic = "force-dynamic";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const NORMAL: ClientSignals = {
  ua: CHROME,
  language: "zh-CN",
  languages: ["zh-CN", "zh"],
  platform: "Win32",
  vendor: "Google Inc.",
  webdriver: false,
  automation: [],
  webglVendor: "Google Inc. (NVIDIA)",
  webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0)",
  screen: { w: 1920, h: 1080, dpr: 1 },
  maxTouchPoints: 0,
  hardwareConcurrency: 8,
  timezone: "Asia/Shanghai",
  outerWidth: 1920,
  outerHeight: 1040,
  plugins: 5,
};

const SCENARIOS: Record<string, { ip: string; signals: ClientSignals; headerUa: string; ipHits?: number }> = {
  real: { ip: "114.114.114.114", signals: NORMAL, headerUa: CHROME },
  datacenter: { ip: "1.178.1.10", signals: NORMAL, headerUa: CHROME },
  proxy: { ip: "104.16.1.1", signals: NORMAL, headerUa: CHROME },
  crawler: {
    ip: "114.114.114.114",
    signals: { ...NORMAL, ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    headerUa: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  },
  emulator: {
    ip: "114.114.114.114",
    signals: {
      ...NORMAL,
      ua: "Mozilla/5.0 (Linux; Android 11; LDPlayer Build/QP1A) AppleWebKit/537.36 Chrome/91.0.4472.114 Mobile Safari/537.36",
      platform: "Linux armv8l",
      webglRenderer: "BlueStacks",
      maxTouchPoints: 5,
    },
    headerUa: "Mozilla/5.0 (Linux; Android 11; LDPlayer Build/QP1A) AppleWebKit/537.36 Chrome/91.0.4472.114 Mobile Safari/537.36",
  },
  cloud_phone: {
    ip: "114.114.114.114",
    signals: {
      ...NORMAL,
      ua: "Mozilla/5.0 (Linux; Android 12; RedFinger Build/SP1A) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
      webglRenderer: "Adreno (TM) 640",
    },
    headerUa: "Mozilla/5.0 (Linux; Android 12; RedFinger Build/SP1A) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  headless: {
    ip: "114.114.114.114",
    signals: {
      ...NORMAL,
      ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
      webdriver: true,
      automation: ["playwright"],
      webglRenderer: "Google SwiftShader",
      outerWidth: 0,
      outerHeight: 0,
      plugins: 0,
    },
    headerUa: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/128.0.0.0 Safari/537.36",
  },
};

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ ok: false, action: "allow", tracked: false, error: "unauthorized" }, { status: 401 });
  }
  let scenario = "real";
  let siteKey = "";
  try {
    const body = (await request.json()) as { scenario?: string; siteKey?: string };
    if (body.scenario && SCENARIOS[body.scenario]) scenario = body.scenario;
    siteKey = normalizeSiteKey(body.siteKey) || "";
  } catch {
    scenario = "real";
  }
  if (!siteKey) {
    return NextResponse.json({ ok: false, action: "allow", tracked: false, error: "invalid_site" }, { status: 400 });
  }
  const sample = SCENARIOS[scenario];
  const result = runCheck({
    ip: sample.ip,
    accountId: session.accountId,
    siteKey,
    signals: sample.signals,
    headerUa: sample.headerUa,
    lab: true,
  });
  const { fp, ...publicResult } = result as typeof result & { fp?: string };
  void fp;
  return NextResponse.json({ ...publicResult, scenario });
}
