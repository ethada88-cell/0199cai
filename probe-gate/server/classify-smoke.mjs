/**
 * 本地冒烟：验证精准化后的判定样例（不依赖 HTTP）。
 * 运行：node server/classify-smoke.mjs
 */
import { classifyKind } from "./classify.mjs";

function check(name, got, expect) {
  if (got !== expect) {
    console.error("FAIL", name, "got", got, "expect", expect);
    process.exitCode = 1;
  } else {
    console.log("ok", name, "->", got);
  }
}

const iphoneUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1";
const androidUa =
  "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const bluestacksUa =
  "Mozilla/5.0 (Linux; Android 9; BlueStacks) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const curlUa = "curl/8.5.0";

// 真人手机：有触控，即使缺传感器也不应判假
check(
  "real-iphone",
  classifyKind("183.20.1.1", iphoneUa, {
    uaMobile: true,
    platform: "iPhone",
    touch: 5,
    hasOrientation: false,
    hasMotion: false,
  }),
  "human"
);

// 桌面「请求桌面网站」：iPhone UA + MacIntel，不应再直接判模拟器
check(
  "iphone-desktop-mode",
  classifyKind("183.20.1.1", iphoneUa, {
    uaMobile: true,
    platform: "MacIntel",
    touch: 0,
    hasOrientation: false,
    hasMotion: false,
  }),
  "human"
);

// 仅无触控+无传感器：旧规则会假，新规则应真人
check(
  "weak-signals-only",
  classifyKind("120.1.1.1", androidUa, {
    uaMobile: true,
    platform: "Linux armv8l",
    touch: 0,
    hasOrientation: false,
    hasMotion: false,
  }),
  "human"
);

// 经典模拟器：手机 UA + Win32
check(
  "android-on-win32",
  classifyKind("1.2.3.4", androidUa, {
    uaMobile: true,
    platform: "Win32",
    touch: 0,
  }),
  "emulator"
);

// 已知模拟器 UA
check("bluestacks-ua", classifyKind("1.2.3.4", bluestacksUa, { uaMobile: true, platform: "Win32" }), "emulator");

// 虚拟 GPU
check(
  "swiftshader",
  classifyKind("1.2.3.4", androidUa, {
    uaMobile: true,
    platform: "Linux armv8l",
    touch: 5,
    webgl: "Google SwiftShader",
  }),
  "emulator"
);

// 爬虫
check("curl", classifyKind("1.2.3.4", curlUa, {}), "crawler");

// 自动化硬证据
check(
  "selenium-cdc",
  classifyKind("1.2.3.4", androidUa, { uaMobile: true, platform: "Linux armv8l", touch: 5, cdc: true }),
  "automation"
);

// 自动化弱堆叠（无硬信号）应放过
check(
  "automation-weak-only",
  classifyKind("1.2.3.4", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", {
    uaChrome: true,
    uaMobile: false,
    plugins: 0,
    languages: 0,
    chrome: true,
    chromeRuntime: false,
  }),
  "human"
);

if (process.exitCode) {
  console.error("classify-smoke FAILED");
  process.exit(1);
}
console.log("classify-smoke PASSED");
