import type { StoredEvent } from "@/lib/types";

export function deviceLabel(ua: string) {
  const text = (ua || "").trim();
  if (!text) return "";
  if (/云手机|cloud.?phone|redfinger|vmos|geelark|红手指|多多云/i.test(text)) return "云手机";
  if (/bluestacks|nox|ldplayer|雷电|夜神|emulator|sdk_gphone|goldfish/i.test(text)) return "模拟器";
  if (/iPhone/i.test(text)) {
    const ver = text.match(/iPhone OS (\d+[_\d]*)/i);
    return ver ? `iPhone ${ver[1].replace(/_/g, ".")}` : "iPhone";
  }
  if (/iPad/i.test(text)) return "iPad";
  if (/OpenHarmony|HarmonyOS/i.test(text)) {
    const browser = text.match(/(HuaweiBrowser|VivoBrowser|MiuiBrowser|Chrome)\/[\d.]+/i);
    return browser ? `鸿蒙 · ${browser[1]}` : "鸿蒙手机";
  }
  if (/Android/i.test(text)) {
    const model = text.match(/;\s*([^;)]{2,40}?)\s+Build\//i);
    if (model) return model[1].trim();
    if (/Mobile|wv\)/i.test(text)) return "Android 手机";
    return "Android";
  }
  if (/Windows/i.test(text)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(text)) return "Mac";
  if (/Linux/i.test(text)) return "Linux";
  return text.slice(0, 40);
}

export function claimedPhone(ua: string) {
  return /iPhone|iPad|iPod|Android/i.test(ua || "");
}

const SPOOF = new Set(["virtual_gpu", "emulator", "cloud_phone", "device_mismatch"]);

export function spoofPhone(event: Pick<StoredEvent, "ua" | "categories">) {
  return claimedPhone(event.ua || "") && (event.categories || []).some((code) => SPOOF.has(code));
}

export function phoneMark(systems: string[]) {
  const list = systems.slice(0, 6).join("、");
  const more = systems.length > 6 ? "等" : "";
  if (systems.length > 1) return `不是真手机 · 换过 ${list}${more}`;
  return `不是真手机 · 自称 ${list}`;
}
