/**
 * 流量无感检测（嵌入任意网站）
 *
 * 用法：<script src="https://你的域名/probe.js"></script>
 *
 * 默认「无感」：只上报判定结果到后台，页面不弹任何窗。
 * 若要恢复弹窗：<script src=".../probe.js" data-mode="popup"></script>
 *
 * 流程：
 * 1. 页面加载后 POST /api/probe（UA、来路、webdriver 等）
 * 2. 服务器判定爬虫 / 无头 / 机房 IP，写入后台统计
 * 3. 无感模式不渲染遮罩；popup 模式且 trap=true 才显示「访问核验」
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
  var MODE = ((script && script.getAttribute("data-mode")) || "silent").toLowerCase(); // silent | popup
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
    try {
      return {
        webdriver: Boolean(navigator.webdriver),
        headless: /HeadlessChrome|Headless/i.test(navigator.userAgent || ""),
      };
    } catch (e) {
      return { webdriver: false, headless: false };
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
