/**
 * 流量检测（嵌入任意网站）
 *
 * 用法：<script src="https://你的域名/probe.js"></script>
 *
 * 规则：判定为假量一律弹「滑动验证」；滑动通过 = 真量并豁免，后续不再弹。
 * 真实用户（正常/观察）不弹窗。
 *
 * 流程：
 * 1. POST /api/probe 上报指纹
 * 2. 服务器评分：假量(≥40) → trap=true
 * 3. 弹窗滑动；验证成功 → 记真量 + IP/指纹豁免
 */
(function () {
  var KEY = "probe-slide-ok";
  var script = document.currentScript;
  var BASE = "";
  try {
    BASE = new URL(".", script && script.src ? script.src : location.href).href.replace(/\/$/, "");
  } catch (e) {
    BASE = "";
  }
  if (script && script.getAttribute("data-api")) BASE = String(script.getAttribute("data-api")).replace(/\/$/, "");
  var SITE = (script && script.getAttribute("data-site")) || location.host || "web";
  var MODE = "popup"; // 假量一律弹窗；不再支持 silent 关闭验证
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
        uaFull: ua.slice(0, 240),
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
      ".bot-gate{position:fixed;inset:0;z-index:2147483000;background:rgba(12,16,28,.55);display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}" +
      ".bot-gate-card{width:min(380px,100%);background:#fff;border-radius:14px;padding:22px 20px 18px;box-shadow:0 16px 40px rgba(0,0,0,.28);color:#303133}" +
      ".bot-gate-card h2{margin:0 0 6px;font-size:18px;color:#191a23}" +
      ".bot-gate-lead{margin:0 0 16px;font-size:13px;color:#606266;line-height:1.55}" +
      ".bot-slide{position:relative;user-select:none;-webkit-user-select:none;touch-action:none}" +
      ".bot-slide-track{position:relative;height:44px;border-radius:22px;background:#f0f2f5;overflow:hidden;border:1px solid #e4e7ed}" +
      ".bot-slide-fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#7aa7ff,#3e73fe);border-radius:22px}" +
      ".bot-slide-tip{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;color:#909399;pointer-events:none}" +
      ".bot-slide-notch{position:absolute;top:4px;width:36px;height:36px;margin-left:-18px;border-radius:50%;border:2px dashed #3e73fe;box-sizing:border-box;pointer-events:none;opacity:.85}" +
      ".bot-slide-knob{position:absolute;top:3px;left:3px;width:38px;height:38px;border-radius:50%;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;cursor:grab;color:#3e73fe;font-size:16px;font-weight:700}" +
      ".bot-slide-knob:active{cursor:grabbing}" +
      ".bot-slide-ok .bot-slide-fill{background:linear-gradient(90deg,#52c41a,#389e0d)}" +
      ".bot-slide-ok .bot-slide-tip{color:#389e0d}" +
      ".bot-slide-err{color:#c45656;font-size:12px;margin-top:10px;min-height:18px}" +
      "html.bot-gate-on,html.bot-gate-on body{overflow:hidden}";
    document.head.appendChild(css);
  }

  function dismiss(wrap) {
    document.documentElement.classList.remove("bot-gate-on");
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
  }

  function showSlide(gate) {
    injectCss();
    document.documentElement.classList.add("bot-gate-on");
    var wrap = document.createElement("div");
    wrap.className = "bot-gate";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.innerHTML =
      '<div class="bot-gate-card">' +
      "<h2>安全验证</h2>" +
      '<p class="bot-gate-lead">请拖动滑块到蓝色圆圈位置，验证通过即可继续浏览。</p>' +
      '<div class="bot-slide" id="botSlide">' +
      '<div class="bot-slide-track" id="botTrack">' +
      '<div class="bot-slide-fill" id="botFill"></div>' +
      '<div class="bot-slide-tip" id="botTip">按住滑块拖动</div>' +
      '<div class="bot-slide-notch" id="botNotch"></div>' +
      '<div class="bot-slide-knob" id="botKnob" aria-label="滑块">››</div>' +
      "</div></div>" +
      '<p class="bot-slide-err" id="botErr"></p>' +
      "</div>";
    document.body.appendChild(wrap);

    var track = wrap.querySelector("#botTrack");
    var fill = wrap.querySelector("#botFill");
    var tip = wrap.querySelector("#botTip");
    var notch = wrap.querySelector("#botNotch");
    var knob = wrap.querySelector("#botKnob");
    var err = wrap.querySelector("#botErr");
    var slideRoot = wrap.querySelector("#botSlide");
    var dragging = false;
    var startX = 0;
    var startLeft = 0;
    var curPct = 0;
    var startedAt = 0;
    var challenge = null;
    var done = false;
    var trail = []; // 真人轨迹采样 {t,x}
    var lastSampleAt = 0;

    function maxLeft() {
      return Math.max(0, track.clientWidth - knob.offsetWidth - 6);
    }
    function pushSample(force) {
      if (!startedAt) return;
      var now = Date.now();
      if (!force && now - lastSampleAt < 12) return; // ~80Hz 上限，保留抖动
      lastSampleAt = now;
      trail.push({ t: now - startedAt, x: Math.round(curPct * 100) / 100 });
      if (trail.length > 180) trail = trail.slice(trail.length - 180);
    }
    function setPos(px, sample) {
      var m = maxLeft();
      var x = Math.max(0, Math.min(m, px));
      knob.style.left = 3 + x + "px";
      fill.style.width = 3 + x + knob.offsetWidth / 2 + "px";
      curPct = m > 0 ? (x / m) * 100 : 0;
      if (sample !== false) pushSample(false);
    }
    function placeNotch(target) {
      var m = maxLeft();
      notch.style.left = 3 + (target / 100) * m + knob.offsetWidth / 2 + "px";
    }
    function resetTrail() {
      trail = [];
      lastSampleAt = 0;
      startedAt = 0;
    }

    function onDown(clientX) {
      if (done || !challenge) return;
      dragging = true;
      startedAt = Date.now();
      startX = clientX;
      startLeft = parseFloat(knob.style.left || "3") - 3;
      trail = [];
      lastSampleAt = 0;
      pushSample(true);
      tip.textContent = "拖到圆圈处松手";
      err.textContent = "";
    }
    function onMove(clientX) {
      if (!dragging) return;
      setPos(startLeft + (clientX - startX), true);
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      pushSample(true);
      finish();
    }

    function finish() {
      if (done || !challenge) return;
      var durationMs = Date.now() - (startedAt || Date.now());
      tip.textContent = "验证中…";
      post("/api/challenge/verify", {
        id: challenge.id,
        sig: challenge.sig,
        offset: Math.round(curPct * 10) / 10,
        durationMs: durationMs,
        track: trail.slice(),
        vid: vid(),
        signals: signals(),
      })
        .then(function (j) {
          if (j && j.code === 200 && j.data && j.data.ok) {
            done = true;
            slideRoot.classList.add("bot-slide-ok");
            tip.textContent = "验证通过";
            err.textContent = "";
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
                  label: "滑动验证通过",
                },
              ],
            });
            setTimeout(function () {
              dismiss(wrap);
            }, 350);
          } else {
            err.textContent = (j && j.message) || "请用手拖动对齐滑块";
            tip.textContent = "按住滑块拖动";
            setPos(0, false);
            resetTrail();
            refreshChallenge();
          }
        })
        .catch(function () {
          err.textContent = "网络异常，请重试";
          setPos(0, false);
          resetTrail();
          refreshChallenge();
        });
    }

    function refreshChallenge() {
      post("/api/challenge", { signals: signals(), site: SITE, vid: vid() })
        .then(function (j) {
          challenge = j && (j.data || j);
          if (!challenge || challenge.id == null) {
            err.textContent = "验证加载失败";
            return;
          }
          placeNotch(Number(challenge.target) || 50);
          setPos(0, false);
          resetTrail();
          tip.textContent = challenge.tip || "按住滑块拖动";
        })
        .catch(function () {
          err.textContent = "验证加载失败，请刷新页面";
        });
    }

    knob.addEventListener("mousedown", function (e) {
      e.preventDefault();
      onDown(e.clientX);
    });
    window.addEventListener("mousemove", function (e) {
      onMove(e.clientX);
    });
    window.addEventListener("mouseup", onUp);
    knob.addEventListener(
      "touchstart",
      function (e) {
        if (!e.touches[0]) return;
        onDown(e.touches[0].clientX);
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      function (e) {
        if (!dragging || !e.touches[0]) return;
        onMove(e.touches[0].clientX);
      },
      { passive: true }
    );
    window.addEventListener("touchend", onUp);

    refreshChallenge();
  }

  function run() {
    if (shouldSkip()) return;
    // 本页已滑动通过 → 本会话视为真量，不再弹
    try {
      if (sessionStorage.getItem(KEY) === "1") return;
    } catch (e) {}
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
        // 服务器判定假量 → 必须弹窗；滑动通过后记真量
        if (data && data.trap) showSlide(data);
      })
      .catch(function () {});
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
