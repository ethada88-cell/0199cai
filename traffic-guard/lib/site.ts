const SITE_KEY = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const SIMPLE_KEY = /^[a-z0-9_-]{1,48}$/;

export function normalizeSiteKey(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const key = input.trim().toLowerCase().replace(/\.$/, "").replace(/:\d+$/, "");
  if (!key || key.length > 253 || key.includes("..")) return null;
  if (SIMPLE_KEY.test(key) || SITE_KEY.test(key)) return key;
  return null;
}

function hostOf(value: string | null) {
  if (!value || value === "null") return null;
  try {
    return normalizeSiteKey(new URL(value).hostname);
  } catch {
    return null;
  }
}

export function siteFromHeaders(headers: Headers) {
  // 只认 Origin = 当前打开的页面。不要用 Referer 当站点键：
  // 很多 WebView / 跳转会丢掉 Referer，若再和错误回退搅在一起，容易把量算到别的域名上。
  return hostOf(headers.get("origin"));
}
