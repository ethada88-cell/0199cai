/**
 * 流量无感检测（嵌入任意网站）
 *
 * 用法：<script src="https://你的域名/probe.js"></script>
 *
 * 默认：判定为假量（爬虫 / 无头 / 机房 IP）才弹「访问核验」；真实用户不弹。
 * 无感（只统计不弹窗）：<script src=".../probe.js" data-mode="silent"></script>
 *
 * 流程：
 * 1. 页面加载后 POST /api/probe（UA、来路、webdriver 等）
 * 2. 服务器判定爬虫 / 无头 / 自动化伪装 / 模拟器云手机 / 机房 IP，写入后台统计
 * 3. 仅 fake/trap=true 时弹窗；真人与 silent 模式都不弹
 */
(function () {
  var KEY = "probe-trap-ok";
  var script = document.currentScript;
  var BASE = "";
  try {
    BASE = new URL(".", script && script.src ? script.src : location.href).href.replace(/\/$/, "");
  } catch (e) {
    BASE = "";
  }
  if (script && script.getAttribute("data-api")) BASE = String(script.getAttribute("data-api")).replace(/\/$/, "");
  var SITE = (script && script.getAttribute("data-site")) || location.host || "web";
  var MODE = ((script && script.getAttribute("data-mode")) || "popup").toLowerCase(); // popup | silent
  var skip = ((script && script.getAttribute("data-skip")) || "admin").split(",").map(function (s) {
    return s.trim();
  });

  function pagePath() {
    var h = String(location.hash || "");
    if (h.indexOf("#/") === 0) return h.slice(1).split("?")[0] || "/";
    return location.pathname || "/";
  }

  function shouldSkip() {
    var p = (pagePath() + " " + location.pathname).toLowerCase();
    for (var i = 0; i < skip.length; i++) {
      if (skip[i] && p.indexOf(skip[i].toLowerCase()) >= 0) return true;
    }
    return false;
  }

  function vid() {
    try {
      var v = localStorage.getItem("probe-vid") || "";
      if (!v) {
        v = "v" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        localStorage.setItem("probe-vid", v);
      }
      return v;
    } catch (e) {
      return "anon";
    }
  }

  function utm() {
    try {
      var q = new URLSearchParams(location.hash.split("?")[1] || location.search);
      return (q.get("utm_source") || q.get("from") || q.get("source") || "").slice(0, 60);
    } catch (e) {
      return "";
    }
  }

  function signals() {
    var empty = { webdriver: false, headless: false };
    try {
      var ua = navigator.userAgent || "";
      var s = {
        webdriver: Boolean(navigator.webdriver),
        headless: /HeadlessChrome|Headless/i.test(ua),
        plugins: (navigator.plugins && navigator.plugins.length) || 0,
        languages: (navigator.languages && navigator.languages.length) || 0,
        lang: navigator.language || "",
        hw: navigator.hardwareConcurrency || 0,
        mem: navigator.deviceMemory || 0,
        touch: navigator.maxTouchPoints || 0,
        chrome: typeof window.chrome !== "undefined",
        chromeRuntime: !!(window.chrome && window.chrome.runtime),
        uaChrome: /Chrome\//.test(ua) && !/Edg\//.test(ua),
        uaMobile: /Mobile|Android|iPhone|iPad/i.test(ua),
        outer: (typeof outerWidth !== "undefined" ? outerWidth : -1) + "x" + (typeof outerHeight !== "undefined" ? outerHeight : -1),
        screen: (screen && screen.width ? screen.width : 0) + "x" + (screen && screen.height ? screen.height : 0),
        webgl: "",
        webglVendor: "",
        platform: navigator.platform || "",
        vendor: navigator.vendor || "",
        dpr: (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1,
        hasOrientation: typeof DeviceOrientationEvent !== "undefined",
        hasMotion: typeof DeviceMotionEvent !== "undefined",
        netType: "",
        emulatorBridge: false,
        cloudPhoneHook: false,
        cdc: false,
        selenium: false,
        phantom: false,
        nightmare: false,
        puppeteer: false,
        playwright: false,
        domWebdriver: false,
      };
      try {
        s.domWebdriver = document.documentElement.getAttribute("webdriver") === "true";
      } catch (e1) {}
      try {
        s.phantom = !!(window.callPhantom || window._phantom);
        s.nightmare = !!window.__nightmare;
        s.puppeteer = !!(window.__puppeteer_evaluation_script__);
        s.playwright = !!(window.__playwright || window._playwright);
        s.selenium = !!(document.$cdc_asdjflasutopfhvcZLmcfl_ || window._Selenium_IDE_Recorder);
      } catch (e2) {}
      try {
        for (var k in document) {
          if (/^\$cdc_|\$chrome_asyncScriptInfo|__selenium_|__webdriver_/.test(k)) {
            s.cdc = true;
            break;
          }
        }
      } catch (e3) {}
      try {
        for (var w in window) {
          if (/^cdc_|__selenium|__webdriver|__driver_evaluate|__fxdriver/i.test(w)) {
            s.cdc = true;
            break;
          }
        }
      } catch (e4) {}
      try {
        var c = document.createElement("canvas");
        var gl = c.getContext("webgl") || c.getContext("experimental-webgl");
        if (gl) {
          var dbg = gl.getExtension("WEBGL_debug_renderer_info");
          if (dbg) {
            s.webgl = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "").slice(0, 80);
            s.webglVendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "").slice(0, 60);
          }
        }
      } catch (e5) {}
      try {
        var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) s.netType = String(conn.type || conn.effectiveType || "").slice(0, 20);
      } catch (e6) {}
      try {
        // 部分模拟器 / 云手机会注入桥对象
        if (window.Android || window.android || window.__android || window.BlueStacks || window.nemo || window.NemoAgent) s.emulatorBridge = true;
        if (window.CloudPhone || window.cloud手机 || window.__CLOUD_PHONE__ || window.RedFinger || window.VMOS) s.cloudPhoneHook = true;
        var href = String(location.href || "");
        if (/emulator|cloudphone|cloud-phone|yunshouji/i.test(href)) s.cloudPhoneHook = true;
      } catch (e7) {}
      return s;
    } catch (e) {
      return empty;
    }
  }

  function post(path, body) {
    var url = BASE + path;
    var raw = JSON.stringify(body);
    try {
      if (path === "/api/track" && navigator.sendBeacon) {
        var blob = new Blob([raw], { type: "application/json" });
        if (navigator.sendBeacon(url, blob)) return Promise.resolve();
      }
    } catch (e) {}
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
      keepalive: true,
    }).then(function (r) {
      return r.json().catch(function () {
        return {};
      });
    });
  }

  function injectCss() {
    if (document.getElementById("probe-gate-css")) return;
    var css = document.createElement("style");
    css.id = "probe-gate-css";
    css.textContent =
      ".bot-gate{position:fixed;inset:0;z-index:2147483000;background:rgba(12,16,28,.72);display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}" +
      ".bot-gate-card{width:min(420px,100%);background:#fff;border-radius:12px;padding:22px 20px 18px;box-shadow:0 16px 40px rgba(0,0,0,.28);color:#303133}" +
      ".bot-gate-card h2{margin:0 0 8px;font-size:18px;color:#191a23}" +
      ".bot-gate-lead{margin:0 0 14px;font-size:13px;color:#606266;line-height:1.55}" +
      ".bot-gate-meta{margin:0 0 16px;display:grid;gap:10px}" +
      ".bot-gate-meta div{background:#f5f7fa;border-radius:8px;padding:10px 12px}" +
      ".bot-gate-meta dt{font-size:12px;color:#909399}" +
      ".bot-gate-meta dd{margin:4px 0 0;font-size:14px;color:#303133;word-break:break-all;line-height:1.45}" +
      ".bot-gate-close{width:100%;height:42px;border:0;border-radius:8px;background:#3e73fe;color:#fff;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit}" +
      "html.bot-gate-on,html.bot-gate-on body{overflow:hidden}";
    document.head.appendChild(css);
  }

  function show(gate) {
    injectCss();
    document.documentElement.classList.add("bot-gate-on");
    var wrap = document.createElement("div");
    wrap.className = "bot-gate";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML =
      '<div class="bot-gate-card">' +
      "<h2>访问核验</h2>" +
      '<p class="bot-gate-lead">检测到机房或爬虫访问，关闭后可继续浏览。</p>' +
      '<dl class="bot-gate-meta">' +
      "<div><dt>来源</dt><dd></dd></div>" +
      "<div><dt>来路流量</dt><dd></dd></div>" +
      "<div><dt>判定</dt><dd></dd></div>" +
      "</dl>" +
      '<button type="button" class="bot-gate-close">关闭</button>' +
      "</div>";
    var dds = wrap.querySelectorAll("dd");
    dds[0].textContent = gate.source || "直接访问";
    dds[1].textContent = gate.ref || gate.refHost || "直接访问";
    dds[2].textContent = gate.kindName || "机房IP";
    wrap.querySelector(".bot-gate-close").onclick = function () {
      try {
        sessionStorage.setItem(KEY, "1");
      } catch (e) {}
      post("/api/track", {
        events: [
          {
            type: "trap-close",
            page: pagePath(),
            pageTitle: document.title,
            site: SITE,
            vid: vid(),
            ref: document.referrer || "",
            utm: utm(),
            signals: signals(),
            label: "关闭弹窗",
          },
        ],
      });
      document.documentElement.classList.remove("bot-gate-on");
      wrap.remove();
    };
    document.body.appendChild(wrap);
  }

  function run() {
    if (shouldSkip()) return;
    if (MODE === "popup") {
      try {
        if (sessionStorage.getItem(KEY) === "1") return;
      } catch (e) {}
    }
    post("/api/probe", {
      page: pagePath() + location.search,
      pageTitle: document.title,
      site: SITE,
      vid: vid(),
      signals: signals(),
      ref: document.referrer || "",
      utm: utm(),
      mode: MODE,
    })
      .then(function (j) {
        var data = j && (j.data || j);
        // 无感：只统计，不弹窗
        if (MODE !== "popup") return;
        if (data && data.trap) show(data);
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
