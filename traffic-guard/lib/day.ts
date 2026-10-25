const SHANGHAI_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDay(at = Date.now()) {
  return SHANGHAI_DAY.format(at);
}

export function addDays(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + delta));
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${next.getUTCFullYear()}-${mm}-${dd}`;
}

export function monthStart(day: string) {
  return `${day.slice(0, 8)}01`;
}

const SHANGHAI_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function shanghaiClock(at: number) {
  const parts = SHANGHAI_CLOCK.formatToParts(at);
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return `${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

export function formatStay(ms: number) {
  if (!Number.isFinite(ms) || ms < 1000) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  if (minutes < 60) return remain ? `${minutes}分${remain}秒` : `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}小时${mins}分` : `${hours}小时`;
}

export function referrerHost(referrer: string) {
  if (!referrer) return "";
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/\.+$/, "");
    if (!/^[a-z0-9.-]+$/.test(host) || host.includes("..") || host.length > 200) return "";
    return host;
  } catch {
    return "";
  }
}
