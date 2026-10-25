import type { TrafficSource } from "@/lib/types";

function httpUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 500);
  if (!/^https?:\/\//i.test(text)) return "";
  return text;
}

function hostName(value: unknown) {
  if (typeof value !== "string") return "";
  const text = value.trim().toLowerCase().replace(/\.+$/, "").slice(0, 200);
  if (!/^[a-z0-9.-]+$/.test(text) || text.includes("..")) return "";
  return text;
}

function token(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 80).replace(/[^\w\u4e00-\u9fff.-]/g, "");
}

export function cleanSource(input: unknown): TrafficSource {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    page: httpUrl(raw.page),
    referrer: httpUrl(raw.referrer),
    host: hostName(raw.host),
    utmSource: token(raw.utmSource),
    utmMedium: token(raw.utmMedium),
    utmCampaign: token(raw.utmCampaign),
  };
}
