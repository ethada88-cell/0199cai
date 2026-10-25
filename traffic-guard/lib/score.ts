import { DETECT } from "@/lib/detect-flags";
import { isPrivateIp, matchNetwork } from "@/lib/ip";
import { powHolds } from "@/lib/pow";
import type { ClientSignals, Reason, Verdict } from "@/lib/types";

const CRAWLER =
  /(googlebot|bingbot|baiduspider|yandexbot|duckduckbot|slurp|sogou|bytespider|petalbot|ahrefs|semrush|mj12bot|dotbot|gptbot|chatgpt|oai-searchbot|claudebot|amazonbot|facebookexternalhit|twitterbot|telegrambot|applebot|pingdom|uptimerobot|phantomjs|python-requests|go-http-client|scrapy|okhttp|curl|wget\/|httpclient|headlesschrome|\bbot\b|\bspider\b|\bcrawler\b)/i;

const FAMOUS_CRAWLER =
  /(googlebot|adsbot-google|mediapartners-google|feedfetcher-google|storebot-google|google-inspectiontool|googleother|apis-google|baiduspider|bytespider|gptbot|chatgpt|oai-searchbot)/i;

const EMULATOR =
  /(bluestacks|bstg|nox|bignox|夜神|ldplayer|dnplayer|leidian|雷电|changzhi|畅指|memu|microvirt|mumu|nemu|genymotion|androvm|droid4x|windroy|koplayer|youwave|androws|gameloop|sdk_gphone|google_sdk|goldfish|ranchu|generic_x86|vbox86|qemu|android sdk built for|\bemulator\b|android_x86|ttvm|xiaoyao|逍遥|memuplay|primeos|waydroid|anbox|ldbox|leidians)/i;

const CLOUD_PHONE =
  /(redfinger|red finger|duoplus|duoduoyun|vmos|virtualapp|cloudphone|cloud-phone|云手机|cloud mobile|huaweicloudphone|geelark|ldcloud|hemayun|hema.?yun|红手指|多多云|雷电云|阿里云手机|wujie|无界云|云控|shoujiyun|phonecloud|xuanfeng|旋风云|aikeyun|爱客云)/i;

const VIRTUAL_GPU =
  /(swiftshader|llvmpipe|lavapipe|virtualbox|vmware|parallels|microsoft basic render|oray idd)/i;

function realHandset(ua: string) {
  if (EMULATOR.test(ua) || CLOUD_PHONE.test(ua)) return false;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  if (/OpenHarmony|HarmonyOS/i.test(ua)) return true;
  if (/Android/i.test(ua) && /Build\//i.test(ua)) return true;
  if (/Android/i.test(ua) && /HuaweiBrowser|VivoBrowser|HeyTap|MiuiBrowser|SamsungBrowser|OPPO|vivo|iQOO|IQOO|HUAWEI|HONOR|Redmi|Xiaomi|Realme|OnePlus/i.test(ua)) return true;
  return false;
}

function looksLikeNormalBrowser(ua: string) {
  if (ua.length < 20) return false;
  if (/headless|okhttp|\bcurl\b|\bwget\b/i.test(ua)) return false;
  if (!/Mozilla\/5\.0/i.test(ua)) return false;
  const chrome = /Chrome\/\d+/i.test(ua) && /Safari\/\d+/i.test(ua);
  const safari = /Version\/\d+/i.test(ua) && /Safari\/\d+/i.test(ua) && !/Chrome\//i.test(ua);
  return chrome || safari;
}

function claimsDesktopChrome(ua: string, platform: string) {
  if (!/Chrome\/\d+/i.test(ua) || /Mobile|Android|iPhone|iPad|iPod|Headless/i.test(ua)) return false;
  return /Windows|Win32|Win64|Macintosh|MacIntel|Linux|X11|CrOS/i.test(`${ua} ${platform}`);
}

function desktopRatio(screen: ClientSignals["screen"]) {
  const w = screen?.w || 0;
  const h = screen?.h || 0;
  if (w < 800 || h < 500) return false;
  return w / h >= 1.25;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "")).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function modelToken(ua: string) {
  const found = ua.match(/;\s*([^;)]{2,48}?)\s+Build\//i);
  return found ? found[1].trim() : "";
}

function modelLinesUp(ua: string, hintRaw: string) {
  const hint = hintRaw.trim();
  const token = modelToken(ua);
  if (hint.length >= 2) {
    const hinted = hint.toLowerCase();
    const named = token.toLowerCase();
    if (named && (named === hinted || named.includes(hinted) || hinted.includes(named))) return true;
    if (!named && hint.length >= 4 && ua.toLowerCase().includes(hinted)) return true;
    return false;
  }
  if (token && realHandset(ua)) return true;
  return /iPhone|iPad|iPod/i.test(ua);
}

function commercialIp(ip: string) {
  if (!ip || ip === "0.0.0.0" || isPrivateIp(ip)) return null;
  const net = matchNetwork(ip);
  if (!net) return null;
  if (net.kind === "proxy" && /cloudflare|fastly/i.test(net.provider)) return null;
  return net;
}

function textOf(signals: ClientSignals, headerUa: string): string {
  return [
    headerUa,
    signals.ua || "",
    signals.platform || "",
    signals.webglVendor || "",
    signals.webglRenderer || "",
    asList(signals.brands).join(" "),
    asList(signals.automation).join(" "),
    signals.architecture || "",
    signals.model || "",
  ].join(" ");
}

function push(reasons: Reason[], reason: Reason) {
  if (reasons.some((r) => r.code === reason.code)) return;
  reasons.push(reason);
}

export type MemoryFacts = {
  ipVisits?: number;
  ipVisitors?: number;
  ipFingerprints?: number;
  fpVisitors?: number;
  deviceIps?: number;
  deviceSites?: number;
  ipDevices?: number;
  patternSites?: number;
};

export type LearnHintInput = {
  code: string;
  label: string;
  detail: string;
  weight: number;
};

export function evaluateCheck(input: {
  ip: string;
  signals: ClientSignals;
  headerUa: string;
  followUp?: boolean;
  memory?: MemoryFacts;
  /** 自我学习提示：来路 / 出口 / 设备历史信誉，由 check 在有外部广告来路时传入。 */
  learnHints?: LearnHintInput[] | null;
}): { verdict: Verdict; score: number; categories: string[]; reasons: Reason[]; ua: string } {
  const signals = input.signals || {};
  const ua = (signals.ua || input.headerUa || "").slice(0, 400);
  const blob = textOf(signals, input.headerUa || "");
  const reasons: Reason[] = [];

  if (isPrivateIp(input.ip) || input.ip === "0.0.0.0") {
    push(reasons, {
      code: "private_ip",
      label: "内网地址",
      detail: "来源是本机或内网，不按机房计算",
      weight: 0,
    });
  } else {
    const net = matchNetwork(input.ip);
    if (net?.kind === "datacenter") {
      push(reasons, {
        code: "datacenter_ip",
        label: "机房 IP",
        detail: `${net.provider} 机房地址段`,
        weight: 70,
      });
    } else if (net?.kind === "proxy") {
      const cdn = /cloudflare|fastly/i.test(net.provider);
      if (cdn) {
        push(reasons, {
          code: "cdn_ip",
          label: "CDN 地址",
          detail: `${net.provider} 的地址不单独记假量`,
          weight: 0,
        });
      } else {
        push(reasons, {
          code: "proxy_ip",
          label: "代理 IP",
          detail: `${net.provider} 代理地址`,
          weight: 75,
        });
      }
    }
  }

  const headerUa = input.headerUa || "";
  const famous = FAMOUS_CRAWLER.test(ua) || FAMOUS_CRAWLER.test(headerUa);
  const toolUa = CRAWLER.test(ua) || CRAWLER.test(headerUa) || /bot|curl|okhttp|headlesschrome/i.test(ua);
  if (!ua || ua.length < 20) {
    push(reasons, {
      code: "known_crawler",
      label: "爬虫",
      detail: "浏览器标识为空或短于 20 个字符",
      weight: 90,
    });
  } else if (looksLikeNormalBrowser(ua)) {
    if (famous) {
      push(reasons, { code: "known_crawler", label: "爬虫", detail: ua.slice(0, 180), weight: 90 });
    }
  } else if (toolUa) {
    push(reasons, { code: "known_crawler", label: "爬虫", detail: ua.slice(0, 180), weight: 90 });
  }

  const brands = asList(signals.brands);
  if (/headless/i.test(blob) || brands.some((b) => /headless/i.test(b))) {
    push(reasons, { code: "headless", label: "无头浏览器", detail: "Headless Chrome 或同类标识", weight: 80 });
  }
  if (signals.webdriver) {
    push(reasons, { code: "webdriver", label: "自动化驱动", detail: "navigator.webdriver 为真", weight: 75 });
  }
  const tools = asList(signals.automation);
  if (tools.length) {
    push(reasons, {
      code: "automation",
      label: "自动化工具",
      detail: tools.slice(0, 4).join("、"),
      weight: 70,
    });
  }

  const gpuText = `${signals.webglVendor || ""} ${signals.webglRenderer || ""}`;
  const phoneUa = /Android|iPhone|iPad|iPod/i.test(ua);
  const x86Guest = /Android/i.test(ua) && /Linux x86_64|Linux i686|Linux i386/i.test(signals.platform || "");
  const desktopGpuOnPhone = phoneUa && /(direct3d|\bd3d11\b|\bd3d9\b|geforce|radeon|intel\(r\) (?:hd|uhd|iris|arc))/i.test(gpuText);
  const softwareGpuOnPhone = phoneUa && VIRTUAL_GPU.test(gpuText);
  const x86Arch = phoneUa && /x86|ia32/i.test(signals.architecture || "");
  const desktopHint = phoneUa && /windows|mac|linux|cros/i.test(signals.uaPlatform || "") && !/android/i.test(signals.uaPlatform || "");
  const fakePhoneUa = /^Mozilla\/5\.0 \((?!Linux\b|X11\b|Windows\b|Macintosh\b|iPhone\b|iPad\b|iPod\b|compatible\b)[^)]{0,48}; Linux; Android/i.test(ua);
  const handset = realHandset(ua);
  // iPhone reports MacIntel, and Harmony/OPPO/vivo often report a desktop platform. That is not an emulator.
  // Client-hint architecture stays ignored for real handsets; those hints mislabel OPPO and iQOO.
  const hostPlatform = !handset && phoneUa && /Win32|Win64|MacIntel|Linux x86_64|Linux i686|Linux i386/i.test(signals.platform || "");
  // A software renderer on a phone page that is not a real handset is an emulator.
  // SwiftShader on any other device, including an in-app webview, is a virtual GPU and counts as fake.
  const hostGpu = phoneUa && /(direct3d|\bd3d11\b|\bd3d9\b|\bgeforce\b|\bquadro\b|\bradeon\b|intel\(r\) (?:hd|uhd|iris|arc)|opengl es translator|android emulator)/i.test(gpuText);
  if (CLOUD_PHONE.test(blob)) {
    push(reasons, { code: "cloud_phone", label: "云手机", detail: "设备标识命中云手机特征", weight: 85 });
  }
  if (EMULATOR.test(blob) || hostPlatform || hostGpu || (!handset && (fakePhoneUa || x86Guest || x86Arch || desktopHint || desktopGpuOnPhone || softwareGpuOnPhone))) {
    const detail = EMULATOR.test(blob)
      ? "设备或显卡标识命中模拟器"
      : hostPlatform
        ? "手机页面跑在电脑环境里"
        : hostGpu
          ? "手机页面用的是电脑显卡"
          : fakePhoneUa
            ? "浏览器标识不是真机格式"
            : x86Guest || x86Arch || desktopHint
              ? "手机页面跑在电脑的 x86 环境里"
              : desktopGpuOnPhone
                ? "手机页面用的是电脑显卡"
                : "手机页面用的是软件显卡";
    push(reasons, { code: "emulator", label: "模拟器", detail, weight: 85 });
  } else if (VIRTUAL_GPU.test(blob)) {
    push(reasons, { code: "virtual_gpu", label: "虚拟显卡", detail: signals.webglRenderer || signals.webglVendor || "正常手机和正常电脑不会用软件渲染器", weight: 80 });
  }

  const platform = signals.platform || "";
  const touch = signals.maxTouchPoints || 0;
  const mobileUa = /Android|iPhone|iPad|iPod/i.test(ua);
  const desktopPlatform = /Win32|Win64|MacIntel|Windows|Macintosh/i.test(platform);
  if (!handset && mobileUa && desktopPlatform && touch === 0 && desktopRatio(signals.screen)) {
    push(reasons, {
      code: "emulator",
      label: "模拟器",
      detail: "手机标识配的是 Windows/Mac 平台，没有触控，屏幕比例像桌面",
      weight: 85,
    });
  } else {
    const androidOnDesktop = !handset && /Android/i.test(ua) && /Win32|Win64|MacIntel/.test(platform) && touch === 0;
    const appleOnDesktop = !handset && /iPhone|iPad/i.test(ua) && /Win32|Win64|Linux x86_64/.test(platform) && touch === 0;
    if (androidOnDesktop || appleOnDesktop) {
      push(reasons, {
        code: "device_mismatch",
        label: "设备自相矛盾",
        detail: "系统自称手机，环境却是没有触控的桌面",
        weight: 50,
      });
    }
  }

  if (claimsDesktopChrome(ua, platform)) {
    const missing: string[] = [];
    if (signals.chrome === false) missing.push("没有 window.chrome");
    if (Array.isArray(signals.languages) && signals.languages.length === 0) missing.push("语言列表是空的");
    if (signals.outerWidth === 0 && signals.outerHeight === 0) missing.push("窗口尺寸为 0");
    if (missing.length) {
      push(reasons, {
        code: "disguised_automation",
        label: "伪装自动化",
        detail: `自称电脑版 Chrome，${missing.join("、")}`,
        weight: 80,
      });
    }
  }

  if ((signals.outerWidth === 0 && signals.outerHeight === 0) || (signals.outerWidth === 0 && /Chrome/i.test(ua))) {
    push(reasons, { code: "hidden_window", label: "隐藏窗口", detail: "浏览器窗口尺寸为 0", weight: 40 });
  }

  const memory = input.memory || {};
  const ipVisits = memory.ipVisits || 0;
  const ipVisitors = memory.ipVisitors || 0;
  const ipFingerprints = memory.ipFingerprints || 0;
  const fpVisitors = memory.fpVisitors || 0;
  const rotatingDevice = !handset && fpVisitors >= 8;
  const oneDeviceCrowd = !handset && ipFingerprints === 1 && ipVisitors >= 8 && ipVisits >= 10 && fpVisitors >= 8;
  const refreshBot = ipVisits >= 30 && ipVisitors <= 2;
  if (rotatingDevice || oneDeviceCrowd || refreshBot) {
    const detail = refreshBot
      ? `同一出口 30 分钟内访问 ${ipVisits} 次`
      : `同一出口、同一台设备 30 分钟内对应 ${Math.max(fpVisitors, ipVisitors)} 个访客`;
    push(reasons, { code: "click_farm", label: "点击农场", detail, weight: 80 });
  }
  // 门槛抬高：公司/学校 NAT 常有十几台真机；过低会把整栋楼当群控。
  if (!handset && (memory.ipDevices || 0) >= 20) {
    push(reasons, {
      code: "shared_uplink",
      label: "共用出口",
      detail: `同一地址 30 分钟内有 ${memory.ipDevices} 台不同设备`,
      weight: 45,
    });
  }
  // 电脑端抬高：换网/多站浏览的真人常见 3～5；刷量通常远高于此。手机保持原门槛。
  const ipRotateNeed = handset ? 12 : 8;
  const siteHopNeed = handset ? 15 : 8;
  if ((memory.deviceIps || 0) >= ipRotateNeed) {
    push(reasons, {
      code: "residential_proxy",
      label: "住宅代理",
      detail: `同一台设备 24 小时内换了 ${memory.deviceIps} 个地址`,
      weight: 80,
    });
  }
  if ((memory.deviceSites || 0) >= siteHopNeed) {
    push(reasons, {
      code: "repeat_device",
      label: "同一台设备",
      detail: `同一台设备 24 小时内进了 ${memory.deviceSites} 个站`,
      weight: 80,
    });
  }
  const manyAddresses = (memory.deviceIps || 0) >= ipRotateNeed;
  const manySites = (memory.deviceSites || 0) >= siteHopNeed;
  const hosted = commercialIp(input.ip);
  if (manyAddresses && manySites && hosted && modelLinesUp(ua, signals.model || "")) {
    const place = hosted.kind === "datacenter" ? "机房" : "代理";
    push(reasons, {
      code: "rotated_host",
      label: "换址进站",
      detail: `同一机型对得上，24 小时换了 ${memory.deviceIps} 个地址、进了 ${memory.deviceSites} 个站，当前是${place}地址 ${hosted.provider}，不是住宅 IP`,
      weight: 80,
    });
  }
  if (!handset && (memory.patternSites || 0) >= 3) {
    push(reasons, {
      code: "repeat_pattern",
      label: "重复点法",
      detail: `同一种没有滑动的点法在 ${memory.patternSites} 个站出现`,
      weight: 80,
    });
  }

  const motion = signals.motion;
  if (!handset && phoneUa && motion && (motion.samples || 0) >= 6 && (motion.accelMag || 0) < 1.2) {
    push(reasons, {
      code: "flat_sensors",
      label: "传感器不动",
      detail: "手机自称有传感器，加速度却没有重力，像摆在架子上的假机",
      weight: 80,
    });
  }
  if (signals.stealthCdc || signals.stealthAttr || (!handset && signals.stealthBrand)) {
    const detail = signals.stealthCdc
      ? "页面留着自动化控制标记"
      : signals.stealthAttr
        ? "页面标记了 webdriver"
        : "浏览器标识和客户端提示对不上";
    push(reasons, { code: "stealth_browser", label: "隐蔽自动化", detail, weight: 80 });
  }
  const engagement = signals.engagement;
  if (input.followUp && engagement) {
    const elapsed = engagement.elapsed || 0;
    const pointer = engagement.pointerMoves || 0;
    const scroll = engagement.scroll || 0;
    if (!handset && engagement.leaving && elapsed >= 1200 && elapsed <= 9000 && pointer < 2 && scroll < 12) {
      push(reasons, {
        code: "rushed_exit",
        label: "秒退",
        detail: "进来几秒就离开，没有滑动也没有点击",
        weight: 70,
      });
    }
  }

  // 自我学习：假量占比高抬分；滑过占比高给负分降权，打断 bad_source 闭环。
  for (const hint of input.learnHints || []) {
    if (!hint || !hint.code || !hint.weight) continue;
    push(reasons, {
      code: hint.code,
      label: hint.label || "学习标记",
      detail: hint.detail || "",
      weight: hint.weight,
    });
  }

  // 以下只对带 probe=1 的新采集脚本计分。navigator.plugins 长度在现代 Chrome 已被固定，不再单独当假量。
  if (signals.probe === 1) {
    if (DETECT.nativeHook && signals.nativeHook) {
      const names = asList(signals.hooked).slice(0, 4);
      push(reasons, {
        code: "native_hook",
        label: "原生函数被改",
        detail: names.length ? `toString 不再是原生代码：${names.join("、")}` : "关键原生函数的 toString 被改写",
        weight: 60,
      });
    }
    if (DETECT.pow && !powHolds(signals)) {
      push(reasons, {
        code: "pow_fail",
        label: "脚本挑战失败",
        detail: "页面没有跑完工作量证明，或证明和指纹对不上",
        weight: 70,
      });
    }
    const behavior = signals.behavior;
    if (DETECT.scriptedPointer && input.followUp && behavior && !handset) {
      const moves = behavior.moves || 0;
      const speedCv = behavior.speedCv ?? 1;
      if (behavior.straight && moves >= 10 && speedCv < 0.08) {
        push(reasons, {
          code: "scripted_pointer",
          label: "轨迹过于匀速",
          detail: `前几秒 ${moves} 次移动几乎走直线，速度波动 ${speedCv.toFixed(2)}，真人概率 ${Number(behavior.human || 0).toFixed(2)}`,
          weight: 65,
        });
      }
      const clicks = behavior.clicks || 0;
      const clickCv = behavior.clickCv ?? 1;
      if (clicks >= 5 && clickCv < 0.08) {
        push(reasons, {
          code: "even_clicks",
          label: "点击间隔过匀",
          detail: `${clicks} 次点击间隔几乎一样，波动 ${clickCv.toFixed(2)}`,
          weight: 35,
        });
      }
    }
    if (DETECT.fontBlank && input.followUp && claimsDesktopChrome(ua, platform) && signals.fontCount === 0 && (signals.fonts || "") !== "") {
      push(reasons, {
        code: "font_blank",
        label: "系统字体为空",
        detail: "电脑版 Chrome 一个常见字体都量不出来，像没有装字体的无头环境",
        weight: 25,
      });
    }
  }

  const score = Math.min(100, Math.max(0, reasons.reduce((sum, r) => sum + (r.weight || 0), 0)));
  const categories = reasons.filter((r) => (r.weight || 0) > 0).map((r) => r.code);
  // 负分学习提示（常滑过）不参与「两类独立证据」拼假量。
  const positive = reasons.filter((r) => (r.weight || 0) > 0);
  // One soft signal stays suspicious. Two signals from different groups confirm a fake.
  const strong = independentGroups(positive) >= 2 || positive.some((r) => STRONG.has(r.code));
  const verdict: Verdict = strong ? "fake" : score >= SUSPICIOUS_SCORE ? "suspicious" : "real";
  return { verdict, score, categories, reasons, ua };
}

// Signals inside one group describe the same kind of evidence, so they do not confirm each other.
function independentGroups(reasons: Reason[]) {
  const codes = new Set(reasons.map((reason) => reason.code));
  const groups = [
    ["residential_proxy", "repeat_device", "shared_uplink"],
    ["hidden_window"],
    ["rushed_exit", "repeat_pattern", "scripted_pointer", "even_clicks"],
    ["datacenter_ip", "proxy_ip"],
    ["native_hook"],
    ["pow_fail"],
    ["font_blank"],
    ["bad_source", "watch_source"],
    ["bad_ip", "watch_ip"],
    ["bad_device", "watch_device"],
  ];
  let count = 0;
  for (const group of groups) {
    if (group.some((code) => codes.has(code))) count += 1;
  }
  return count;
}

export const SUSPICIOUS_SCORE = 20;

const STRONG = new Set([
  "known_crawler",
  "headless",
  "webdriver",
  "automation",
  "disguised_automation",
  "emulator",
  "virtual_gpu",
  "cloud_phone",
  "click_farm",
  "device_mismatch",
  "flat_sensors",
  "rotated_host",
  "stealth_browser",
]);

/**
 * 强假量特征（机房/虚拟环境/农场等）。记假量仍要求有外部广告来路；
 * 本函数只描述信号强度，不单独决定是否入账。
 */
export function isHardFakeSignal(input: {
  verdict?: string;
  categories?: string[] | null;
  score?: number;
  farm?: boolean;
}) {
  const cats = input.categories || [];
  if (input.farm || cats.includes("datacenter_ip")) return true;
  if (!cats.some((code) => STRONG.has(code))) return false;
  return input.verdict === "fake" || (input.score || 0) >= 80;
}

export function fingerprint(signals: ClientSignals, ua: string): string {
  const screen = signals.screen || {};
  return [
    ua,
    signals.platform || "",
    signals.timezone || "",
    signals.webglRenderer || "",
    signals.canvas || "",
    signals.model || "",
    screen.w || 0,
    screen.h || 0,
    signals.hardwareConcurrency || 0,
    signals.fonts || "",
    signals.audio || "",
  ].join("|").slice(0, 360);
}
