/**
 * 访问判定（隐藏弹窗的核心）
 *
 * 只有下面三类会弹窗（trap=true），真人浏览器不弹：
 * 1. crawler  爬虫 / 扫描器 / 脚本 UA
 * 2. headless 无头浏览器（webdriver、HeadlessChrome）
 * 3. datacenter 云厂商 / 机房 IP
 *
 * 后台「刷量检测」和前台弹窗用的是同一套结果。
 */
export function clientIp(req) {
  // 优先取反代传来的真实 IP，避免只看到 127.0.0.1
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const cand = [...xf, req.headers["x-real-ip"], req.headers["cf-connecting-ip"], req.socket?.remoteAddress];
  for (const raw of cand) {
    let ip = String(raw || "").trim();
    if (!ip) continue;
    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    if (ip === "::1") ip = "127.0.0.1";
    if (ip === "127.0.0.1" && xf.length) continue;
    return ip.slice(0, 80);
  }
  return "未知";
}

export function clientUa(req) {
  // UA 过长无意义，截断以免日志膨胀
  return String(req.headers["user-agent"] || "").slice(0, 240);
}

/** 来路域名 → 后台显示的「来源」文案 */
const SEARCH = [
  ["baidu.com", "搜索引擎·百度"],
  ["google.", "搜索引擎·谷歌"],
  ["bing.com", "搜索引擎·必应"],
  ["sogou.com", "搜索引擎·搜狗"],
  ["so.com", "搜索引擎·360"],
  ["sm.cn", "搜索引擎·神马"],
  ["yahoo.", "搜索引擎·雅虎"],
  ["duckduckgo.com", "搜索引擎·DuckDuckGo"],
];

/** 非浏览器 UA 关键词。真人 Chrome/Safari 不会单独命中这些。 */
const CRAWLER_RE =
  /bot|crawler|spider|crawling|slurp|wget|curl|python-requests|httpclient|libwww|scrapy|phantom|headless|puppeteer|playwright|selenium|axios\/|node-fetch|go-http|java\/|okhttp|httpie|postman|insomnia|aiohttp|guzzle|scrapy|httrack|preview|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|applebot|bingbot|yandex|baiduspider|sogou|360spider|bytespider|petalbot|semrush|ahrefs|mj12|dotbot|gptbot|claudebot|ccbot|amazonbot|ia_archiver|scanner|masscan|zgrab|nmap/i;

/**
 * 常见云 / 机房 IPv4 网段（AWS、阿里云、腾讯云、GCP、Azure、DO、Linode、Hetzner、OVH 等）。
 * 命中即视为刷量机房 IP。家宽 / 手机流量一般不在此列。
 */
const DC_CIDRS = [
  "3.0.0.0/8",
  "13.32.0.0/12",
  "13.48.0.0/13",
  "13.52.0.0/14",
  "13.56.0.0/14",
  "13.112.0.0/14",
  "18.0.0.0/8",
  "34.192.0.0/10",
  "35.160.0.0/12",
  "35.176.0.0/13",
  "35.184.0.0/13",
  "35.192.0.0/12",
  "35.208.0.0/12",
  "35.224.0.0/12",
  "35.240.0.0/13",
  "52.0.0.0/8",
  "54.0.0.0/8",
  "8.128.0.0/10",
  "39.96.0.0/12",
  "47.74.0.0/15",
  "47.76.0.0/14",
  "47.80.0.0/12",
  "47.96.0.0/12",
  "106.11.0.0/16",
  "120.24.0.0/14",
  "120.55.0.0/16",
  "121.40.0.0/14",
  "42.192.0.0/14",
  "43.128.0.0/13",
  "49.232.0.0/14",
  "81.68.0.0/14",
  "118.89.0.0/16",
  "119.28.0.0/16",
  "129.204.0.0/16",
  "129.211.0.0/16",
  "132.232.0.0/16",
  "134.175.0.0/16",
  "139.155.0.0/16",
  "150.109.0.0/16",
  "162.14.0.0/16",
  "114.115.0.0/16",
  "116.63.0.0/16",
  "117.78.0.0/16",
  "121.36.0.0/16",
  "124.70.0.0/16",
  "49.4.0.0/16",
  "3.0.0.0/15",
  "13.32.0.0/12",
  "13.48.0.0/13",
  "13.56.0.0/14",
  "13.112.0.0/14",
  "18.0.0.0/9",
  "34.192.0.0/10",
  "52.0.0.0/10",
  "54.64.0.0/11",
  "54.144.0.0/12",
  "54.160.0.0/11",
  "54.192.0.0/12",
  "54.208.0.0/13",
  "54.216.0.0/14",
  "54.220.0.0/15",
  "54.224.0.0/11",
  "35.184.0.0/13",
  "35.192.0.0/12",
  "35.208.0.0/12",
  "35.224.0.0/12",
  "35.240.0.0/13",
  "34.64.0.0/11",
  "104.196.0.0/14",
  "130.211.0.0/16",
  "13.64.0.0/11",
  "20.0.0.0/11",
  "20.36.0.0/14",
  "20.40.0.0/13",
  "20.48.0.0/12",
  "20.64.0.0/10",
  "40.64.0.0/10",
  "52.224.0.0/11",
  "104.40.0.0/13",
  "104.208.0.0/13",
  "104.131.0.0/16",
  "138.68.0.0/16",
  "138.197.0.0/16",
  "143.198.0.0/16",
  "157.230.0.0/16",
  "157.245.0.0/16",
  "159.65.0.0/16",
  "159.89.0.0/16",
  "159.203.0.0/16",
  "164.90.0.0/16",
  "165.22.0.0/16",
  "165.227.0.0/16",
  "167.71.0.0/16",
  "167.99.0.0/16",
  "167.172.0.0/16",
  "174.138.0.0/16",
  "188.166.0.0/16",
  "206.189.0.0/16",
  "45.33.0.0/16",
  "45.56.0.0/16",
  "45.79.0.0/16",
  "139.162.0.0/16",
  "172.104.0.0/15",
  "173.255.192.0/18",
  "198.58.96.0/19",
  "45.32.0.0/16",
  "45.63.0.0/16",
  "45.76.0.0/16",
  "66.42.0.0/16",
  "108.61.0.0/16",
  "140.82.0.0/16",
  "144.202.0.0/16",
  "149.28.0.0/16",
  "155.138.0.0/16",
  "207.246.0.0/16",
  "5.9.0.0/16",
  "23.88.0.0/16",
  "37.27.0.0/16",
  "49.12.0.0/16",
  "65.21.0.0/16",
  "78.46.0.0/15",
  "88.99.0.0/16",
  "95.216.0.0/16",
  "116.202.0.0/16",
  "128.140.0.0/16",
  "135.181.0.0/16",
  "136.243.0.0/16",
  "138.201.0.0/16",
  "142.132.0.0/16",
  "144.76.0.0/16",
  "148.251.0.0/16",
  "157.90.0.0/16",
  "159.69.0.0/16",
  "162.55.0.0/16",
  "167.233.0.0/16",
  "168.119.0.0/16",
  "176.9.0.0/16",
  "178.63.0.0/16",
  "188.40.0.0/16",
  "195.201.0.0/16",
  "51.38.0.0/16",
  "51.68.0.0/16",
  "51.75.0.0/16",
  "51.77.0.0/16",
  "51.79.0.0/16",
  "51.83.0.0/16",
  "51.89.0.0/16",
  "51.91.0.0/16",
  "54.36.0.0/15",
  "137.74.0.0/16",
  "141.94.0.0/15",
  "145.239.0.0/16",
  "146.59.0.0/16",
  "147.135.0.0/16",
  "149.56.0.0/16",
  "151.80.0.0/16",
  "164.132.0.0/16",
  "167.114.0.0/16",
  "176.31.0.0/16",
  "178.32.0.0/15",
  "188.165.0.0/16",
  "46.105.0.0/16",
  "87.98.0.0/16",
  "91.121.0.0/16",
  "94.23.0.0/16",
];

/** 云厂商 IPv6 前缀，命中同样算机房 */
const DC_V6 = ["2400:3200", "2400:3201", "2401:b180", "2402:4e00", "2409:8c00", "2600:1f", "2600:9000", "2a01:4f8", "2a01:4f9", "2a00:1450", "2001:4860", "2607:f8b0"];

const parsedCidrs = DC_CIDRS.map((c) => {
  const [net, bits] = c.split("/");
  const n = ip4ToInt(net);
  const b = Number(bits);
  const mask = b === 0 ? 0 : (~0 << (32 - b)) >>> 0;
  return { n, mask };
}).filter((x) => x.n != null);

/** 把 IPv4 转成 32 位整数，方便做网段掩码比较 */
function ip4ToInt(ip) {
  const p = String(ip || "").split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    const v = Number(x);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = ((n << 8) + v) >>> 0;
  }
  return n;
}

/** 内网 / 本机 IP 不当作机房，避免本地调试误弹 */
function isPrivate(ip) {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "未知") return true;
  const n = ip4ToInt(ip);
  if (n == null) return String(ip).startsWith("fe80:") || String(ip).startsWith("fc") || String(ip).startsWith("fd");
  if ((n & 0xff000000) === 0x0a000000) return true;
  if ((n & 0xfff00000) === 0xac100000) return true;
  if ((n & 0xffff0000) === 0xc0a80000) return true;
  if ((n & 0xff000000) === 0x7f000000) return true;
  return false;
}

function isDatacenterIp(ip) {
  if (!ip || isPrivate(ip)) return false;
  if (ip.includes(":")) {
    const low = ip.toLowerCase();
    return DC_V6.some((p) => low.startsWith(p.toLowerCase()));
  }
  const a = ip4ToInt(ip);
  if (a == null) return false;
  for (const c of parsedCidrs) {
    if ((a & c.mask) === (c.n & c.mask)) return true;
  }
  return false;
}

/** 看起来像正常人用的浏览器（排除 HeadlessChrome 等） */
function looksLikePersonBrowser(ua) {
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright/i.test(ua)) return false;
  return /Mozilla\/\d/i.test(ua) && /(Chrome|CriOS|Firefox|FxiOS|Safari|Edg|OPR|Version)\//i.test(ua);
}

function isCrawlerUa(ua) {
  // UA 太短或空：基本是脚本，直接当爬虫
  const s = String(ua || "");
  if (!s || s.length < 20) return true;
  if (looksLikePersonBrowser(s)) {
    return /Googlebot|AdsBot|Bingbot|YandexBot|YandexImages|Baiduspider|Bytespider|PetalBot|Applebot|GPTBot|ClaudeBot|facebookexternalhit|Twitterbot/i.test(
      s
    );
  }
  return CRAWLER_RE.test(s);
}

/** 前端 probe.js 上报的信号：webdriver / Headless 字样 */
function isHeadless(signals) {
  if (!signals || typeof signals !== "object") return false;
  if (signals.webdriver) return true;
  if (signals.headless) return true;
  return false;
}

/** 从完整 URL 取出主机名，去掉 www. */
export function hostOf(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

/** 来路是本站首页时，算直接访问，不算外部来路 */
function isOwnLanding(ref, selfHost) {
  const h = hostOf(ref);
  const self = String(selfHost || "")
    .replace(/^www\./i, "")
    .toLowerCase()
    .split(":")[0];
  if (!h || !self || (h !== self && !h.endsWith("." + self))) return false;
  try {
    const u = new URL(ref);
    const path = u.pathname || "/";
    const hash = (u.hash || "").replace(/^#/, "");
    if (path !== "/" && path !== "/index.html" && path !== "/index.htm") return false;
    return !hash || hash === "/" || hash.startsWith("/home");
  } catch {
    return true;
  }
}

/**
 * 后台「来源」字段：
 * 投放参数 utm > 本站首页直接进 > 搜索引擎 > 站内跳转 > 其它来路域名
 */
export function sourceOf(ref, utm, selfHost) {
  const u = String(utm || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (u) return "投放·" + u;
  if (isOwnLanding(ref, selfHost)) return "直接访问";
  const h = hostOf(ref);
  if (!h) return "直接访问";
  const self = String(selfHost || "")
    .replace(/^www\./i, "")
    .toLowerCase()
    .split(":")[0];
  if (self && (h === self || h.endsWith("." + self))) return "站内跳转";
  for (const [key, name] of SEARCH) {
    if (key.endsWith(".")) {
      if (h === key.slice(0, -1) || h.endsWith("." + key.slice(0, -1)) || h.includes(key)) return name;
    } else if (h === key || h.endsWith("." + key)) return name;
  }
  return "来路·" + h;
}

export const KIND_NAME = {
  human: "真实用户",
  crawler: "爬虫",
  datacenter: "机房IP",
  headless: "无头浏览器",
};

/** 判定优先级：爬虫 UA → 无头 → 机房 IP → 真人 */
export function classifyKind(ip, ua, signals) {
  if (isCrawlerUa(ua)) return "crawler";
  if (isHeadless(signals)) return "headless";
  if (isDatacenterIp(ip)) return "datacenter";
  return "human";
}

/** 优先用前端传来的 document.referrer；本站首页来路清空 */
function pickRef(req, body, host) {
  const sent = body && Object.prototype.hasOwnProperty.call(body, "ref");
  let ref = sent
    ? String(body.ref || "")
    : String(req.headers.referer || req.headers.referrer || "");
  ref = ref.replace(/\s+/g, " ").trim().slice(0, 300);
  if (isOwnLanding(ref, host)) return "";
  return ref;
}

/**
 * 一次请求的完整判定结果。
 * trap === true 时，前端必须弹出「访问核验」。
 */
export function classifyRequest(req, body = {}) {
  const ip = clientIp(req);
  const ua = clientUa(req);
  const host = String(req.headers.host || "")
    .split(":")[0]
    .replace(/^www\./i, "");
  const ref = pickRef(req, body, host);
  const utm = String(body.utm || "").slice(0, 60);
  const source = sourceOf(ref, utm, host);
  const kind = classifyKind(ip, ua, body.signals);
  const fake = kind !== "human";
  return {
    ip,
    ua,
    host,
    ref,
    source,
    kind,
    kindName: KIND_NAME[kind] || kind,
    trap: fake,
    fake,
  };
}
