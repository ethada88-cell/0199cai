/* 出站链接点击埋点。
 * 和刷量检测的 guard.js 分开。已有站点不用改原来的脚本。
 * 本文件里的多级后缀表要和 lib/registrable.ts 保持一致。
 */
(function (global) {
  if (global.__tgTrack) return;
  global.__tgTrack = true;

  var script = document.currentScript;
  var endpoint = "https://llcj.mtekww.cn/collect";
  var account = "";
  if (script && script.src) {
    try { endpoint = new URL(script.src, global.location.href).origin + "/collect"; } catch (e) {}
  }
  if (script && script.getAttribute) account = script.getAttribute("data-account") || "";

  // 脚本一下载就听点击。不写页面、不改链接、不取消跳转，所以不用等图片 load。
  arm();

  function arm() {
    // 这些后缀要保留三段：example.com.cn、example.co.uk。其余保留两段。
    var MULTI = {
      "com.cn": 1, "net.cn": 1, "org.cn": 1, "gov.cn": 1, "edu.cn": 1, "ac.cn": 1,
      "bj.cn": 1, "sh.cn": 1, "tj.cn": 1, "cq.cn": 1, "he.cn": 1, "sx.cn": 1, "nm.cn": 1, "ln.cn": 1, "jl.cn": 1, "hl.cn": 1,
      "js.cn": 1, "zj.cn": 1, "ah.cn": 1, "fj.cn": 1, "jx.cn": 1, "sd.cn": 1, "ha.cn": 1, "hb.cn": 1, "hn.cn": 1, "gd.cn": 1,
      "gx.cn": 1, "hi.cn": 1, "sc.cn": 1, "gz.cn": 1, "yn.cn": 1, "xz.cn": 1, "sn.cn": 1, "gs.cn": 1, "qh.cn": 1, "nx.cn": 1,
      "xj.cn": 1, "tw.cn": 1, "hk.cn": 1, "mo.cn": 1,
      "co.uk": 1, "org.uk": 1, "ac.uk": 1, "gov.uk": 1, "me.uk": 1, "ltd.uk": 1, "plc.uk": 1, "net.uk": 1,
      "com.au": 1, "net.au": 1, "org.au": 1, "edu.au": 1, "gov.au": 1, "asn.au": 1, "id.au": 1,
      "co.jp": 1, "or.jp": 1, "ne.jp": 1, "ac.jp": 1, "go.jp": 1, "ad.jp": 1, "ed.jp": 1,
      "com.hk": 1, "edu.hk": 1, "gov.hk": 1, "idv.hk": 1, "net.hk": 1, "org.hk": 1,
      "com.tw": 1, "edu.tw": 1, "gov.tw": 1, "idv.tw": 1, "net.tw": 1, "org.tw": 1,
      "com.sg": 1, "edu.sg": 1, "gov.sg": 1, "net.sg": 1, "org.sg": 1, "per.sg": 1,
      "co.kr": 1, "ne.kr": 1, "or.kr": 1, "re.kr": 1, "pe.kr": 1, "go.kr": 1, "ac.kr": 1,
      "co.nz": 1, "net.nz": 1, "org.nz": 1, "ac.nz": 1, "govt.nz": 1,
      "com.br": 1, "net.br": 1, "org.br": 1, "gov.br": 1,
      "com.mx": 1, "org.mx": 1, "gob.mx": 1,
      "co.za": 1, "org.za": 1, "web.za": 1, "net.za": 1,
      "com.tr": 1, "org.tr": 1, "net.tr": 1, "gov.tr": 1,
      "co.in": 1, "net.in": 1, "org.in": 1, "gen.in": 1, "firm.in": 1, "ind.in": 1,
      "com.ar": 1, "com.my": 1, "com.ph": 1, "co.id": 1, "co.th": 1, "com.vn": 1, "com.co": 1
    };

    function registrable(hostname) {
      var host = String(hostname || "").toLowerCase().replace(/\.$/, "");
      var parts = host.split(".");
      if (parts.length < 2) return host;
      var last2 = parts.slice(-2).join(".");
      if (parts.length >= 3 && MULTI[last2]) return parts.slice(-3).join(".");
      return last2;
    }

    var own = [];
    function addOwn(hostname) {
      var root = registrable(hostname);
      if (root && own.indexOf(root) < 0) own.push(root);
    }
    try { addOwn(global.location.hostname); } catch (e) {}
    var extra = script && script.getAttribute ? String(script.getAttribute("data-own") || "") : "";
    extra.split(/[\s,]+/).forEach(function (item) {
      if (!item) return;
      try { addOwn(new URL(item.indexOf("://") >= 0 ? item : "https://" + item).hostname); } catch (e) {}
    });

    function owned(hostname) {
      var host = String(hostname || "").toLowerCase();
      var root = registrable(host);
      for (var i = 0; i < own.length; i++) {
        if (root === own[i] || host === own[i] || host.slice(-(own[i].length + 1)) === "." + own[i]) return true;
      }
      return false;
    }

    function cleanUrl(raw, base) {
      try {
        var url = new URL(String(raw || ""), base || global.location.href);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        url.hash = "";
        if (!url.search && url.href.slice(-1) === "?") url = new URL(url.href.slice(0, -1));
        return url;
      } catch (e) {
        return null;
      }
    }

    function clip(value, max) {
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    }

    function field(el, name) {
      if (!el) return "";
      var node = el.closest ? el.closest("[" + name + "]") : null;
      var from = el.getAttribute && el.getAttribute(name);
      if (!from && node && node.getAttribute) from = node.getAttribute(name);
      return clip(from, 64);
    }

    var SKIP = {
      content: 1, main: 1, app: 1, wrapper: 1, container: 1, box: 1, page: 1, wrap: 1,
      bd: 1, con: 1, clear: 1, clearfix: 1, row: 1, col: 1, left: 1, right: 1, center: 1, fl: 1, fr: 1
    };

    function usefulToken(value) {
      var token = clip(value, 32);
      if (!token || SKIP[token.toLowerCase()]) return "";
      if (/^[0-9a-f]{12,}$/i.test(token) || /^\d+$/.test(token)) return "";
      return token;
    }

    function classPlace(node) {
      var raw = node && node.getAttribute ? node.getAttribute("class") : "";
      if (!raw) return "";
      var parts = String(raw).split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        if (!/(ad|ads|adv|banner|gg|slot|guang)/i.test(parts[i])) continue;
        if (/^(ad|ads|adv|gg|banner)$/i.test(parts[i])) continue;
        var named = usefulToken(parts[i]);
        if (named) return named;
      }
      return "";
    }

    // 链接里常嵌着 <script>document.write(...)</script>。textContent 会把这段代码当成广告名。
    function stripJs(value) {
      var text = String(value || "");
      var lower = text.toLowerCase();
      var out = "";
      var i = 0;
      while (i < text.length) {
        var at = lower.indexOf("document.write", i);
        if (at < 0) {
          out += text.slice(i);
          break;
        }
        out += text.slice(i, at);
        var j = at;
        while (j < text.length && text.charAt(j) !== "(" && text.charAt(j) !== " " && text.charAt(j) !== "\n") j++;
        if (text.charAt(j) !== "(") {
          out += text.slice(at, at + "document.write".length);
          i = at + "document.write".length;
          continue;
        }
        var depth = 0;
        var quote = "";
        for (; j < text.length; j++) {
          var ch = text.charAt(j);
          if (quote) {
            if (ch === "\\") { j++; continue; }
            if (ch === quote) quote = "";
            continue;
          }
          if (ch === "\"" || ch === "'") { quote = ch; continue; }
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) { j++; break; }
          }
        }
        if (text.charAt(j) === ";") j++;
        i = j;
      }
      return out;
    }

    function visible(node, max) {
      if (!node) return "";
      var out = "";
      var cap = max + 1;
      function walk(n) {
        if (!n || out.length >= cap) return;
        if (n.nodeType === 3) {
          out += n.nodeValue || "";
          return;
        }
        if (n.nodeType !== 1) return;
        var tag = String(n.tagName || "").toLowerCase();
        if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template" || tag === "textarea") return;
        for (var child = n.firstChild; child; child = child.nextSibling) {
          walk(child);
          if (out.length >= cap) return;
        }
      }
      walk(node);
      return clip(stripJs(out), max);
    }

    function shortText(node) {
      var raw = visible(node, 48);
      if (!raw || raw.length > 40) return "";
      return raw;
    }

    // 只读附近的短标题。不改页面，也不读布局。
    function nearbyTitle(el) {
      var node = el;
      var levels = 0;
      while (node && node !== document.body && levels < 5) {
        var sib = node.previousElementSibling;
        var seen = 0;
        while (sib && seen < 8) {
          var tag = String(sib.tagName || "").toLowerCase();
          if (tag !== "a" && tag !== "img" && tag !== "script" && tag !== "style") {
            var text = shortText(sib);
            var nested = sib.querySelector ? sib.querySelector("a[href]") : null;
            if (text && !nested) return text;
          }
          sib = sib.previousElementSibling;
          seen++;
        }
        node = node.parentElement;
        levels++;
      }
      return "";
    }

    function placeOf(el) {
      var node = el.parentElement;
      var depth = 0;
      while (node && node !== document.body && node !== document.documentElement && depth < 6) {
        var id = usefulToken(node.getAttribute && node.getAttribute("id"));
        if (id) return id;
        var named = classPlace(node);
        if (named) return named;
        var tag = String(node.tagName || "").toLowerCase();
        if (tag === "header") return "页顶";
        if (tag === "footer") return "页尾";
        if (tag === "nav") return "导航";
        if (tag === "aside") return "侧栏";
        node = node.parentElement;
        depth++;
      }
      return nearbyTitle(el);
    }

    function linkName(el) {
      var img = el.querySelector ? el.querySelector("img") : null;
      var alt = img && img.getAttribute ? clip(img.getAttribute("alt"), 40) : "";
      if (alt) return alt;
      var title = el.getAttribute ? clip(el.getAttribute("title"), 40) : "";
      if (title) return title;
      var text = visible(el, 40);
      if (text) return text;
      var src = img && img.getAttribute ? String(img.getAttribute("src") || "") : "";
      var file = src.split(/[?#]/)[0].split("/").pop();
      if (!file || file.indexOf(".") < 1) return "";
      try { file = decodeURIComponent(file); } catch (e) {}
      return clip(file, 40);
    }

    function slotOf(el, parsed) {
      var marked = field(el, "data-ad-slot") || field(el, "data-ev");
      if (marked) return marked;
      if (!el) return clip(parsed.hostname, 64);
      var name = linkName(el);
      var place = placeOf(el);
      if (place && name && place !== name) return clip(place + " · " + name, 64);
      return clip(name || place || parsed.hostname, 64);
    }

    var lastKey = "";
    var lastAt = 0;

    function send(url, el, base) {
      var parsed = cleanUrl(url, base);
      if (!parsed || owned(parsed.hostname)) return false;
      var key = parsed.href;
      var now = Date.now();
      if (key === lastKey && now - lastAt < 400) return true;
      lastKey = key;
      lastAt = now;
      var page = "";
      try { page = String(base || global.location.href || "").split("#")[0].slice(0, 500); } catch (e) {}
      var payload = {
        target: parsed.href.slice(0, 800),
        slot: slotOf(el, parsed),
        ad: field(el, "data-ad-id"),
        text: visible(el, 80),
        page: page,
        account: account
      };
      var body = "";
      try { body = JSON.stringify(payload); } catch (e0) { return false; }
      try {
        if (global.navigator && typeof global.navigator.sendBeacon === "function") {
          var blob = new Blob([body], { type: "text/plain" });
          if (global.navigator.sendBeacon(endpoint, blob)) return true;
        }
      } catch (e) {}
      // sendBeacon 失败时仍用 POST，让请求带上 Origin。图片请求经常没有来源，服务器会丢掉。
      try {
        if (typeof global.fetch === "function") {
          global.fetch(endpoint, {
            method: "POST",
            body: body,
            headers: { "Content-Type": "text/plain;charset=UTF-8" },
            mode: "cors",
            keepalive: true,
            credentials: "omit"
          }).catch(function () {});
          return true;
        }
      } catch (e2) {}
      try {
        var img = new Image();
        img.src = endpoint
          + "?target=" + encodeURIComponent(payload.target)
          + "&slot=" + encodeURIComponent(payload.slot)
          + "&ad=" + encodeURIComponent(payload.ad)
          + "&text=" + encodeURIComponent(payload.text)
          + "&page=" + encodeURIComponent(payload.page)
          + "&account=" + encodeURIComponent(payload.account);
      } catch (e3) {}
      return true;
    }

    function hintedUrl(el, base, loose) {
      if (!el || !el.getAttribute) return "";
      var names = loose
        ? ["data-href", "data-url", "data-link", "data-jump"]
        : ["data-href", "data-url", "data-link", "data-target", "data-jump"];
      for (var i = 0; i < names.length; i++) {
        var raw = el.getAttribute(names[i]);
        var parsed = cleanUrl(raw, base);
        if (parsed && !owned(parsed.hostname)) return parsed.href;
      }
      return "";
    }

    function shouldRemember(el) {
      if (!el) return false;
      if (field(el, "data-ev") || field(el, "data-ad-slot")) return true;
      if (el.getAttribute && el.getAttribute("onclick")) return true;
      var href = el.getAttribute ? String(el.getAttribute("href") || "") : "";
      var low = href.replace(/\s+/g, "").toLowerCase();
      if (!low || low.charAt(0) === "#" || low.indexOf("javascript:") === 0) return true;
      return false;
    }

    var pendingEl = null;
    var pendingAt = 0;

    function eventBase(event) {
      try {
        var node = event.target;
        if (node && node.nodeType === 3) node = node.parentElement;
        var doc = node && (node.ownerDocument || node);
        var win = doc && (doc.defaultView || null);
        if (win && win.location) return String(win.location.href || "");
      } catch (e) {}
      try { return String(global.location.href || ""); } catch (e2) { return ""; }
    }

    function pathOf(event) {
      if (event.composedPath) {
        try {
          var found = event.composedPath();
          if (found && found.length) return found;
        } catch (e) {}
      }
      var list = [];
      var node = event.target;
      if (node && node.nodeType === 3) node = node.parentElement;
      while (node && list.length < 30) {
        list.push(node);
        node = node.parentElement || null;
      }
      return list;
    }

    function elementUrl(el, base) {
      if (!el) return "";
      var href = el.href;
      if (href && typeof href !== "string") href = href.baseVal || "";
      var parsed = cleanUrl(href, base);
      if (parsed) return parsed.href;
      if (!el.getAttribute) return "";
      parsed = cleanUrl(el.getAttribute("href") || el.getAttribute("xlink:href") || "", base);
      return parsed ? parsed.href : "";
    }

    function remember(el) {
      if (!el) return;
      pendingEl = el;
      pendingAt = Date.now();
    }

    function takenEl() {
      return pendingEl && Date.now() - pendingAt < 1000 ? pendingEl : null;
    }

    function codeUrl(el, base) {
      if (!el || !el.getAttribute) return "";
      var code = String(el.getAttribute("onclick") || "");
      var match = code.match(/https?:\/\/[^\s'"\\<>]+/i);
      if (!match) return "";
      var parsed = cleanUrl(match[0], base);
      return parsed && !owned(parsed.hostname) ? parsed.href : "";
    }

    function onClick(event) {
      try {
        var base = eventBase(event);
        var path = pathOf(event);
        var anchor = null;
        var i;
        for (i = 0; i < path.length; i++) {
          var tag = path[i] && path[i].tagName ? String(path[i].tagName).toLowerCase() : "";
          if (tag === "a" || tag === "area" || tag === "button") { anchor = path[i]; break; }
        }
        if (anchor) {
          var abs = elementUrl(anchor, base);
          var parsed = cleanUrl(abs, base);
          if (parsed && !owned(parsed.hostname)) {
            send(abs, anchor, base);
            return;
          }
          var hint = hintedUrl(anchor, base, false);
          if (hint && send(hint, anchor, base)) return;
          // javascript:void(0) 或按钮。随后的 location / window.open 用这个元素当广告位。
          if (shouldRemember(anchor)) {
            remember(anchor);
            var coded = codeUrl(anchor, base);
            if (coded) send(coded, anchor, base);
          }
          return;
        }
        for (i = 0; i < path.length; i++) {
          var loose = hintedUrl(path[i], base, true);
          if (loose && send(loose, path[i], base)) return;
        }
        for (i = 0; i < path.length; i++) {
          if (path[i] && path[i].getAttribute && path[i].getAttribute("onclick")) {
            remember(path[i]);
            var fromCode = codeUrl(path[i], base);
            if (fromCode) send(fromCode, path[i], base);
            return;
          }
        }
      } catch (e) {}
    }

    function navAvailable(win) {
      try { return !!(win && win.navigation && typeof win.navigation.addEventListener === "function"); } catch (e) { return false; }
    }

    function onSubmit(event) {
      try {
        var form = event.target;
        if (!form || String(form.tagName || "").toLowerCase() !== "form" || !form.action) return;
        var win = null;
        try { win = form.ownerDocument.defaultView; } catch (e) {}
        // 有 Navigation API 时，接下来的 navigate 会带上带参数的真实地址，这里再记会算成两次。
        if (navAvailable(win)) return;
        send(form.action, takenEl() || form, eventBase(event));
      } catch (e2) {}
    }

    function reportFrom(win, url) {
      var base = "";
      try { base = String(win.location.href || ""); } catch (e) {}
      if (!cleanUrl(url, base)) return;
      send(url, takenEl(), base);
      pendingEl = null;
    }

    function hookNavigate(win) {
      var nav;
      try { nav = win.navigation; } catch (e) { return; }
      if (!nav || nav.__tgListen || typeof nav.addEventListener !== "function") return;
      try {
        nav.__tgListen = true;
        nav.addEventListener("navigate", function (event) {
          try {
            var dest = event.destination && event.destination.url;
            if (dest) reportFrom(win, dest);
          } catch (err) {}
        });
      } catch (e2) {}
    }

    function hookLocation(win) {
      var proto;
      try { proto = win.Location.prototype; } catch (e) { return; }
      if (!proto || proto.__tgLoc) return;
      try { proto.__tgLoc = true; } catch (e) { return; }
      function wrapCall(name) {
        try {
          var native = proto[name];
          if (typeof native !== "function" || native.__tgNav) return;
          var wrapped = function (url) {
            try { reportFrom(win, url); } catch (err) {}
            return native.apply(this, arguments);
          };
          wrapped.__tgNav = true;
          proto[name] = wrapped;
        } catch (e) {}
      }
      wrapCall("assign");
      wrapCall("replace");
      try {
        var desc = Object.getOwnPropertyDescriptor(proto, "href");
        if (desc && typeof desc.set === "function" && typeof desc.get === "function") {
          Object.defineProperty(proto, "href", {
            configurable: true,
            enumerable: desc.enumerable,
            get: function () { return desc.get.call(this); },
            set: function (url) {
              try { reportFrom(win, url); } catch (err) {}
              return desc.set.call(this, url);
            }
          });
        }
      } catch (e2) {}
      try {
        var nav = win.navigation;
        if (nav && typeof nav.navigate === "function" && !nav.navigate.__tgNav) {
          var navigate = nav.navigate;
          var wrappedNav = function (url) {
            try { reportFrom(win, typeof url === "string" ? url : (url && url.url) || ""); } catch (err) {}
            return navigate.apply(this, arguments);
          };
          wrappedNav.__tgNav = true;
          nav.navigate = wrappedNav;
        }
      } catch (e3) {}
    }

    function hookForms(win) {
      var proto;
      try { proto = win.HTMLFormElement.prototype; } catch (e) { return; }
      if (!proto || proto.__tgSubmit || typeof proto.submit !== "function") return;
      proto.__tgSubmit = true;
      var native = proto.submit;
      proto.submit = function () {
        try {
          var win = this.ownerDocument.defaultView;
          if (!navAvailable(win)) {
            var base = "";
            try { base = String(win.location.href || ""); } catch (err) {}
            send(this.action, takenEl() || this, base);
          }
        } catch (e2) {}
        return native.apply(this, arguments);
      };
    }

    function installOpen(win) {
      var current;
      try { current = win.open; } catch (e) { return; }
      if (typeof current !== "function" || current.__tgOpen) return;
      var nativeOpen = current;
      var wrapped = function (url) {
        var opened = null;
        try {
          opened = nativeOpen.apply(this, arguments);
        } finally {
          try {
            reportFrom(win, url);
            if (opened) armWindow(opened);
          } catch (err) {}
        }
        return opened;
      };
      wrapped.__tgOpen = true;
      try { wrapped.toString = function () { return Function.prototype.toString.call(nativeOpen); }; } catch (e2) {}
      try { win.open = wrapped; } catch (e3) {}
    }

    // passive：不能取消点击，进站跳转和出站跳转都按页面原来的方式走。
    var listen = { capture: true, passive: true };
    var worlds = [];

    function armWindow(win) {
      if (!win) return;
      var doc = null;
      try { doc = win.document; } catch (e) { return; }
      var seen = false;
      for (var i = 0; i < worlds.length; i++) if (worlds[i] === win) seen = true;
      if (!seen) worlds.push(win);
      installOpen(win);
      hookLocation(win);
      hookNavigate(win);
      hookForms(win);
      if (doc && !doc.__tgTrackDoc) {
        doc.__tgTrackDoc = true;
        try {
          doc.addEventListener("click", onClick, listen);
          doc.addEventListener("auxclick", onClick, listen);
          doc.addEventListener("submit", onSubmit, listen);
        } catch (e2) {}
      }
    }

    function scanFrames(doc) {
      var nodes;
      try { nodes = doc.querySelectorAll("iframe,frame"); } catch (e) { return; }
      for (var i = 0; i < nodes.length; i++) {
        try {
          var child = nodes[i].contentWindow;
          if (!child || !child.document) continue;
          armWindow(child);
          scanFrames(child.document);
        } catch (e2) {}
      }
    }

    armWindow(global);
    try {
      global.addEventListener("load", function () {
        for (var i = 0; i < worlds.length; i++) installOpen(worlds[i]);
        scanFrames(document);
      });
    } catch (e3) {}
    try {
      document.addEventListener("load", function (event) {
        var node = event.target;
        var tag = node && node.tagName ? String(node.tagName).toLowerCase() : "";
        if (tag !== "iframe" && tag !== "frame") return;
        try {
          if (node.contentWindow && node.contentDocument) {
            armWindow(node.contentWindow);
            scanFrames(node.contentDocument);
          }
        } catch (err) {}
      }, true);
    } catch (e4) {}
    var scanQueued = false;
    function queueScan() {
      if (scanQueued) return;
      scanQueued = true;
      setTimeout(function () {
        scanQueued = false;
        try { scanFrames(document); } catch (e) {}
      }, 50);
    }
    try {
      var observer = new MutationObserver(queueScan);
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e5) {}
    // 页面若在加载后再盖掉 window.open，下一秒重新包上。
    setInterval(function () {
      for (var i = 0; i < worlds.length; i++) {
        try { installOpen(worlds[i]); } catch (e) {}
      }
    }, 1000);
  }
})(window);
