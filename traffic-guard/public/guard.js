(function (global) {
  if (global.__tgBoot) return;
  global.__tgBoot = true;
  try {
    var current = document.currentScript;
    var origin = "https://llcj.mtekww.cn";
    if (current && current.src) {
      try { origin = new URL(current.src, global.location.href).origin; } catch (e) {}
    }
    var account = current && current.getAttribute ? current.getAttribute("data-account") : "";
    var preview = current && current.getAttribute ? current.getAttribute("data-preview") : "";
    var site = current && current.getAttribute ? current.getAttribute("data-site") : "";
    var started = false;
    var enteredAt = Date.now();
    var DELAY_MS = 2000;

    function start() {
      if (started || global.__tgRun) return;
      started = true;
      var node = document.createElement("script");
      node.async = true;
      node.defer = true;
      // 版本参数避免站点/CDN 继续用旧的不透明遮罩脚本
      node.src = origin + "/guard-run.js?v=20261027j";
      try { node.setAttribute("fetchpriority", "low"); } catch (e) {}
      if (account) node.setAttribute("data-account", account);
      if (preview) node.setAttribute("data-preview", preview);
      if (site) node.setAttribute("data-site", site);
      (document.head || document.documentElement).appendChild(node);
    }

    // 前 2 秒只拉起检测脚本，不在 leave 时上报：
    // 旧逻辑 leaveBeacon 无 source、一律记「直达真实」，秒退也会把真实 IP/PV 冲高。
    global.addEventListener("pageshow", function (event) {
      if (event && event.persisted && !started && !global.__tgRun) {
        var wait = Math.max(0, DELAY_MS - (Date.now() - enteredAt));
        global.setTimeout(start, wait);
      }
    });

    var wait = Math.max(0, DELAY_MS - (Date.now() - enteredAt));
    global.setTimeout(start, wait);
  } catch (e) {}
})(window);
