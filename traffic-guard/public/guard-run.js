(function (global) {
  if (global.__tgRun) return;
  global.__tgRun = true;
  // 与 lib/detect-flags.ts 对应。某项改 false 即停采集，服务端开关仍可单独关掉计分。
  var FLAGS = { nativeHook: true, audio: true, fonts: true, behavior: true, pow: true };
  function ownScript() {
    if (document.currentScript) return document.currentScript;
    var nodes = document.getElementsByTagName("script");
    var found = null;
    for (var i = 0; i < nodes.length; i += 1) {
      var src = nodes[i].getAttribute("src") || "";
      if (src.indexOf("guard.js") !== -1) found = nodes[i];
    }
    return found;
  }

  var script = ownScript();
  var origin = "https://llcj.mtekww.cn";
  if (script && script.src) {
    try {
      origin = new URL(script.src, global.location.href).origin;
    } catch (e) {}
  }

  function text(value) {
    return value == null ? "" : String(value);
  }

  function hintsOf() {
    var nav = global.navigator || {};
    var data = nav.userAgentData;
    if (!data || !data.getHighEntropyValues) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var timer = setTimeout(function () { resolve(null); }, 400);
      try {
        data.getHighEntropyValues(["architecture", "bitness", "model", "platform"]).then(function (value) {
          clearTimeout(timer);
          resolve(value || null);
        }).catch(function () {
          clearTimeout(timer);
          resolve(null);
        });
      } catch (e) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  function collect(hints, motion, leaving) {
    var nav = global.navigator || {};
    var screen = global.screen || {};
    var automation = [];
    try { if (global.callPhantom || global._phantom) automation.push("phantom"); } catch (e) {}
    try { if (global.__nightmare) automation.push("nightmare"); } catch (e) {}
    try {
      if (global.__selenium_evaluate || global.__webdriver_script_fn || global._selenium || global.callSelenium || global._Selenium_IDE_Recorder || global.__webdriver_evaluate || global.__driver_evaluate || global.__webdriver_unwrapped || global.__driver_unwrapped || global.__fxdriver_evaluate || global.__fxdriver_unwrapped || global.__selenium_unwrapped || (document && (document.__selenium_unwrapped || document.__webdriver_evaluate || document.__fxdriver_unwrapped))) {
        automation.push("selenium");
      }
    } catch (e) {}
    try {
      var marked = document && document.documentElement;
      if (marked && (marked.getAttribute("selenium") != null || marked.getAttribute("driver") != null)) automation.push("selenium");
    } catch (e1) {}
    try { if (global.__playwright__binding__ || global.__pwInitScripts) automation.push("playwright"); } catch (e) {}
    try { if (global.__puppeteer_evaluation_script__ || global.__puppeteer) automation.push("puppeteer"); } catch (e) {}
    try { if (global.domAutomation || global.domAutomationController || global.awesomium) automation.push("domAutomation"); } catch (e) {}
    try { if (global.Cypress) automation.push("cypress"); } catch (e) {}

    var webglVendor = "";
    var webglRenderer = "";
    try {
      var canvas = document.createElement("canvas");
      var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        var vendors = [];
        var renderers = [];
        function remember(list, value) {
          var item = text(value).trim();
          if (item && list.indexOf(item) < 0) list.push(item);
        }
        remember(vendors, gl.getParameter(gl.VENDOR));
        remember(renderers, gl.getParameter(gl.RENDERER));
        var ext = gl.getExtension("WEBGL_debug_renderer_info");
        if (ext) {
          remember(vendors, gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
          remember(renderers, gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        }
        webglVendor = vendors.join(" | ");
        webglRenderer = renderers.join(" | ");
      }
    } catch (e) {}

    var brands = [];
    try {
      var data = nav.userAgentData;
      if (data && data.brands) {
        brands = data.brands.map(function (b) { return text(b && b.brand); }).filter(Boolean);
      }
    } catch (e) {}

    var languages = [];
    try { languages = Array.prototype.slice.call(nav.languages || []); } catch (e) {}

    var hasChrome = false;
    try { hasChrome = !!(global.chrome && typeof global.chrome === "object"); } catch (e) {}
    var stealth = stealthOf(brands);
    var hook = nativeHook();
    var fontBits = fontProbe();
    var canvasHash = canvasToken();
    var zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e4) {}
    var proof = solvePow([canvasHash, zone, screen.width || 0, screen.height || 0].join("|"));

    return {
      ua: text(nav.userAgent),
      language: text(nav.language),
      languages: languages.slice(0, 8),
      platform: text(nav.platform),
      vendor: text(nav.vendor),
      webdriver: !!nav.webdriver,
      automation: automation,
      webglVendor: webglVendor.slice(0, 160),
      webglRenderer: webglRenderer.slice(0, 200),
      screen: { w: screen.width || 0, h: screen.height || 0, dpr: global.devicePixelRatio || 1 },
      maxTouchPoints: nav.maxTouchPoints || 0,
      hardwareConcurrency: nav.hardwareConcurrency || 0,
      deviceMemory: nav.deviceMemory || 0,
      timezone: zone,
      outerWidth: global.outerWidth || 0,
      outerHeight: global.outerHeight || 0,
      plugins: nav.plugins ? nav.plugins.length : 0,
      brands: brands,
      chrome: hasChrome,
      architecture: text(hints && hints.architecture),
      model: text(hints && hints.model),
      uaPlatform: text(hints && hints.platform),
      visitor: visitorId(),
      canvas: canvasHash,
      motion: motion || undefined,
      engagement: engagementOf(leaving),
      stealthCdc: stealth.cdc,
      stealthAttr: stealth.attr,
      stealthBrand: stealth.brand,
      probe: 1,
      nativeHook: hook.hit,
      hooked: hook.names,
      audio: audioState.hash,
      fonts: fontBits.hash,
      fontCount: fontBits.count,
      colorDepth: screen.colorDepth || 0,
      pow: proof,
      behavior: behaviorStats()
    };
  }

  // 原理：正常浏览器里这些函数的 toString 含 [native code]。被代理改写后通常会变成自定义脚本。
  // 误判：个别隐私扩展会包一层 fetch，所以只盯建节点、画布和 WebGL，且要两处以上才算命中。
  function nativeHook() {
    if (!FLAGS.nativeHook) return { hit: false, names: [] };
    var names = [];
    function look(label, fn) {
      if (!fn) return;
      try {
        var src = Function.prototype.toString.call(fn);
        if (src.indexOf("[native code]") === -1) names.push(label);
      } catch (e) {}
    }
    try { look("createElement", document.createElement); } catch (e1) {}
    try { look("toDataURL", HTMLCanvasElement.prototype.toDataURL); } catch (e2) {}
    try {
      var proto = global.WebGLRenderingContext && global.WebGLRenderingContext.prototype;
      look("getParameter", proto && proto.getParameter);
    } catch (e3) {}
    return { hit: names.length >= 2, names: names.slice(0, 4) };
  }

  // 原理：离线音频不需要用户手势，渲染一小段三角波再哈希，用来稳定设备指纹。
  // 不算异常分：落地页常在 iframe 里，AudioContext 被权限策略关掉会误伤真人。
  var audioState = { hash: "" };
  function startAudio() {
    if (!FLAGS.audio || audioState.started) return;
    audioState.started = true;
    try {
      var Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx(1, 4410, 44100);
      var osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 1000;
      var comp = ctx.createDynamicsCompressor();
      osc.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      ctx.startRendering().then(function (buf) {
        var data = buf.getChannelData(0);
        var sum = 0;
        for (var i = 0; i < data.length; i += 32) sum += Math.abs(data[i]);
        if (sum > 0.001) audioState.hash = Math.round(sum * 1e6).toString(16).slice(0, 12);
      }).catch(function () {});
    } catch (e) {}
  }

  // 原理：用探针宽度对比常见字体是否存在。无头镜像经常一个都没有。
  // 误判：极简 Linux 桌面也可能没有这份名单里的字体，所以服务端只给弱分，且 base 宽度为 0（未布局）时放弃。
  // navigator.plugins 已不可用：Chrome 把它标准化成固定长度，不能再靠 plugins===0 认无头。
  function fontProbe() {
    if (!FLAGS.fonts || !document.body) return { hash: "", count: -1 };
    var list = ["Arial", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Roboto", "Times New Roman", "Menlo", "DejaVu Sans", "Liberation Sans", "Noto Sans"];
    var probe = document.createElement("span");
    probe.setAttribute("style", "position:absolute;left:-9999px;top:-9999px;font-size:72px;font-family:monospace;");
    probe.textContent = "mmmmmmmmlli";
    document.body.appendChild(probe);
    var baseW = probe.offsetWidth;
    if (!baseW) {
      probe.remove();
      return { hash: "", count: -1 };
    }
    var bits = "";
    var count = 0;
    for (var i = 0; i < list.length; i += 1) {
      probe.style.fontFamily = "'" + list[i] + "',monospace";
      if (probe.offsetWidth !== baseW) {
        bits += "1";
        count += 1;
      } else bits += "0";
    }
    probe.remove();
    return { hash: bits, count: count };
  }

  function fnv32(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  // 原理：让脚本真的循环算出一个哈希，挡掉只 POST 空 JSON、并不执行页面脚本的流量。
  // 绕过：对方照着算法自己算也能过，所以只是门槛，不是验证码。种子绑了画布和屏幕，伪造字段会对不上。
  function solvePow(seed) {
    if (!FLAGS.pow) return undefined;
    for (var n = 0; n <= 20000; n += 1) {
      var digest = fnv32(seed + ":" + n);
      if ((digest & 1023) === 0) return { n: n, h: digest.toString(16) };
    }
    return { n: 0, h: "" };
  }

  var behavior = { pointer: 0, scroll: 0, keys: 0, started: Date.now() };
  var trail = [];
  var clickAt = [];
  var lastMotion = null;

  function engagementOf(leaving) {
    return {
      pointerMoves: behavior.pointer,
      scroll: behavior.scroll,
      elapsed: Date.now() - behavior.started,
      leaving: leaving === true
    };
  }

  function coeffVar(values) {
    if (!values.length) return 1;
    var mean = 0;
    for (var i = 0; i < values.length; i += 1) mean += values[i];
    mean = mean / values.length;
    if (mean <= 0) return 1;
    var variance = 0;
    for (var j = 0; j < values.length; j += 1) variance += Math.pow(values[j] - mean, 2);
    return Math.sqrt(variance / values.length) / mean;
  }

  // 原理：真人前几秒的轨迹有抖动，脚本常拉一条匀速直线。点击间隔过于均匀也像定时器。
  // 误判：桌面用户把鼠标快速拖过页面会接近直线，所以要 10 个点以上且只在二次上报时计分；手机滑动不算。
  function behaviorStats() {
    if (!FLAGS.behavior) return undefined;
    var speedCv = 1;
    var straight = false;
    if (trail.length >= 6) {
      var a = trail[0];
      var b = trail[trail.length - 1];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var maxDev = 0;
      var speeds = [];
      for (var i = 0; i < trail.length; i += 1) {
        var point = trail[i];
        var dev = Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / len;
        if (dev > maxDev) maxDev = dev;
        if (i === 0) continue;
        var dt = point.t - trail[i - 1].t;
        if (dt <= 0) continue;
        var step = Math.sqrt(Math.pow(point.x - trail[i - 1].x, 2) + Math.pow(point.y - trail[i - 1].y, 2));
        speeds.push(step / dt);
      }
      speedCv = Math.round(coeffVar(speeds) * 100) / 100;
      straight = len > 80 && maxDev < 2.5 && speedCv < 0.08;
    }
    var gaps = [];
    for (var c = 1; c < clickAt.length; c += 1) gaps.push(clickAt[c] - clickAt[c - 1]);
    var clickCv = Math.round(coeffVar(gaps) * 100) / 100;
    var human = 0.55;
    if (behavior.pointer >= 8 && !straight) human = 0.86;
    if (straight) human = 0.12;
    if (behavior.pointer < 2 && behavior.keys === 0 && !behavior.scroll) human = 0.45;
    if (clickAt.length >= 5 && clickCv < 0.08) human = Math.min(human, 0.2);
    return {
      moves: behavior.pointer,
      keys: behavior.keys,
      clicks: clickAt.length,
      straight: straight,
      speedCv: speedCv,
      clickCv: clickCv,
      human: human
    };
  }

  function watchBehavior() {
    if (!FLAGS.behavior) return;
    behavior.started = Date.now();
    var lastTrail = 0;
    function bump(event) {
      behavior.pointer += 1;
      if (trail.length >= 24) return;
      var now = Date.now();
      if (now - lastTrail < 40) return;
      lastTrail = now;
      trail.push({ x: event && event.clientX || 0, y: event && event.clientY || 0, t: now });
    }
    document.addEventListener("pointermove", bump, true);
    document.addEventListener("touchmove", bump, true);
    document.addEventListener("keydown", function () {
      if (behavior.keys < 40) behavior.keys += 1;
    }, true);
    document.addEventListener("click", function () {
      if (clickAt.length < 12) clickAt.push(Date.now());
    }, true);
    window.addEventListener("scroll", function () {
      var y = 0;
      try { y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0; } catch (e) {}
      if (y > behavior.scroll) behavior.scroll = y;
    }, true);
  }

  function canvasToken() {
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 220;
      canvas.height = 36;
      var g = canvas.getContext("2d");
      if (!g) return "";
      g.textBaseline = "top";
      g.font = "16px Arial";
      g.fillStyle = "#f60";
      g.fillRect(0, 0, 80, 18);
      g.fillStyle = "#069";
      g.fillText("tg", 2, 2);
      var data = canvas.toDataURL();
      var hash = 0;
      for (var i = 0; i < data.length; i += 1) hash = (hash * 33 + data.charCodeAt(i)) >>> 0;
      return hash.toString(16);
    } catch (e) {
      return "";
    }
  }

  function stealthOf(brands) {
    var cdc = false;
    var attr = false;
    var brand = false;
    try {
      var keys = Object.getOwnPropertyNames(global);
      for (var i = 0; i < keys.length; i += 1) {
        var key = keys[i] || "";
        if (key.indexOf("cdc_") === 0 || key.indexOf("$cdc_") === 0) {
          cdc = true;
          break;
        }
      }
    } catch (e) {}
    try { attr = !!(document.documentElement && document.documentElement.getAttribute("webdriver") != null); } catch (e2) {}
    try {
      var ua = (global.navigator && global.navigator.userAgent) || "";
      if (/Chrome\//.test(ua) && brands && brands.length) {
        var matched = false;
        for (var j = 0; j < brands.length; j += 1) {
          if (/chrom/i.test(brands[j] || "")) matched = true;
        }
        if (!matched) brand = true;
      }
    } catch (e3) {}
    return { cdc: cdc, attr: attr, brand: brand };
  }

  function sampleMotion(ms) {
    return new Promise(function (resolve) {
      var mags = [];
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        try { global.removeEventListener("devicemotion", onMove); } catch (e) {}
        if (!mags.length) {
          resolve({ samples: 0, accelMag: 0, accelVar: 0 });
          return;
        }
        var max = 0;
        var sum = 0;
        for (var i = 0; i < mags.length; i += 1) {
          if (mags[i] > max) max = mags[i];
          sum += mags[i];
        }
        var mean = sum / mags.length;
        var varSum = 0;
        for (var j = 0; j < mags.length; j += 1) varSum += (mags[j] - mean) * (mags[j] - mean);
        resolve({ samples: mags.length, accelMag: Math.round(max * 100) / 100, accelVar: Math.round((varSum / mags.length) * 100) / 100 });
      }
      function onMove(event) {
        var acc = event.accelerationIncludingGravity || event.acceleration;
        if (!acc) return;
        var x = acc.x || 0;
        var y = acc.y || 0;
        var z = acc.z || 0;
        mags.push(Math.sqrt(x * x + y * y + z * z));
        if (mags.length >= 24) finish();
      }
      try { global.addEventListener("devicemotion", onMove); } catch (e) {}
      global.setTimeout(finish, ms);
    });
  }

  function readCookie(key) {
    try {
      var parts = ("; " + document.cookie).split("; " + key + "=");
      if (parts.length < 2) return "";
      return decodeURIComponent(parts.pop().split(";").shift() || "");
    } catch (e) {
      return "";
    }
  }

  function visitorId() {
    var key = "tg_vid";
    var id = "";
    try { id = global.localStorage.getItem(key) || ""; } catch (e) {}
    if (!id || id.length < 8) id = readCookie(key);
    if (!id || id.length < 8) id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { global.localStorage.setItem(key, id); } catch (e) {}
    try {
      document.cookie = key + "=" + encodeURIComponent(id) + "; path=/; max-age=31536000; SameSite=Lax";
    } catch (e2) {}
    return id.slice(0, 40);
  }

  function param(name) {
    try {
      return new URLSearchParams(global.location.search || "").get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function sourceOf() {
    var loc = global.location || {};
    var referrer = "";
    try { referrer = document.referrer || ""; } catch (e) {}
    return {
      page: text(loc.href).slice(0, 500),
      referrer: text(referrer).slice(0, 500),
      host: text(loc.hostname).slice(0, 200),
      utmSource: param("utm_source") || param("source") || param("from"),
      utmMedium: param("utm_medium"),
      utmCampaign: param("utm_campaign")
    };
  }

  function localHost() {
    try {
      var host = global.location.hostname;
      return host === "localhost" || host === "127.0.0.1" || host === "::1";
    } catch (e) {
      return false;
    }
  }

  function ping(base, account, id, kind, trace) {
    if (!id || id === "preview" || !account) return Promise.resolve({ ok: true, preview: true });
    var siteKey = "";
    try { siteKey = String((global.location && global.location.hostname) || "").toLowerCase(); } catch (e) { siteKey = ""; }
    var body = JSON.stringify({ account: account, siteKey: siteKey || undefined, id: id, kind: kind, trace: trace || undefined });
    var url = base + "/api/v1/popup";
    if (kind === "show" || kind === "close") {
      try {
        if (global.navigator && global.navigator.sendBeacon && global.navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
          return Promise.resolve({ ok: true });
        }
      } catch (e) {}
    }
    return postJson(url, body).then(function (res) {
      if (!res.ok) return { ok: false };
      return res.json();
    }).catch(function () { return { ok: false }; });
  }

  function nowMs() {
    return global.performance && global.performance.now ? global.performance.now() : Date.now();
  }

  function judgeTrace(trace) {
    var samples = trace.samples || [];
    if (trace.track < 40 || trace.travel < trace.track - 8) return "incomplete";
    if (samples.length < 2) return "perfect";
    var yMin = Infinity;
    var yMax = -Infinity;
    var xMin = Infinity;
    var xMax = -Infinity;
    var pMin = Infinity;
    var pMax = -Infinity;
    var wMin = Infinity;
    var wMax = -Infinity;
    var hMin = Infinity;
    var hMax = -Infinity;
    var maxStep = 0;
    var speeds = [];
    var gaps = [];
    for (var i = 0; i < samples.length; i += 1) {
      var sample = samples[i];
      if (sample.y < yMin) yMin = sample.y;
      if (sample.y > yMax) yMax = sample.y;
      if (sample.x < xMin) xMin = sample.x;
      if (sample.x > xMax) xMax = sample.x;
      if (sample.p < pMin) pMin = sample.p;
      if (sample.p > pMax) pMax = sample.p;
      if (sample.w < wMin) wMin = sample.w;
      if (sample.w > wMax) wMax = sample.w;
      if (sample.h < hMin) hMin = sample.h;
      if (sample.h > hMax) hMax = sample.h;
      if (i === 0) continue;
      var dt = sample.dt - samples[i - 1].dt;
      var dx = sample.x - samples[i - 1].x;
      if (Math.abs(dx) > maxStep) maxStep = Math.abs(dx);
      if (dt <= 0) continue;
      gaps.push(dt);
      var dy = sample.y - samples[i - 1].y;
      speeds.push(Math.sqrt(dx * dx + dy * dy) / dt);
    }
    var yRange = yMax - yMin;
    var mean = 0;
    for (var s = 0; s < speeds.length; s += 1) mean += speeds[s];
    mean = mean / (speeds.length || 1);
    var variance = 0;
    for (var v = 0; v < speeds.length; v += 1) variance += Math.pow(speeds[v] - mean, 2);
    variance = variance / (speeds.length || 1);
    var speedCv = mean > 0.02 ? Math.sqrt(variance) / mean : 0;
    var gapMean = 0;
    for (var g = 0; g < gaps.length; g += 1) gapMean += gaps[g];
    gapMean = gapMean / (gaps.length || 1);
    var gapVar = 0;
    for (var q = 0; q < gaps.length; q += 1) gapVar += Math.pow(gaps[q] - gapMean, 2);
    gapVar = gapVar / (gaps.length || 1);
    var gapCv = gapMean > 0 ? Math.sqrt(gapVar) / gapMean : 0;
    var touchVary = trace.pointer === "touch" && (pMax - pMin >= 0.04 || wMax - wMin >= 1 || hMax - hMin >= 1);
    var travelX = xMax - xMin;
    if (trace.duration > 0 && trace.duration < 160) return "perfect";
    if (trace.reaction < 100 && trace.duration < 450) return "perfect";
    if (samples.length <= 3 && travelX > 0 && maxStep > travelX * 0.85 && trace.duration < 400) return "perfect";
    if (yRange < 0.8 && speedCv < 0.06 && gapCv < 0.15 && gaps.length >= 4 && trace.movesBefore < 2 && !trace.paused && !touchVary && trace.reaction < 180 && trace.duration < 420) return "perfect";
    return "human";
  }

  var tucked = [];

  function tuckFrames() {
    // 只禁点击，不隐藏：隐藏 iframe 会让 iOS Safari 底栏透出白底，不像系统地址栏毛玻璃。
    var frames = document.getElementsByTagName("iframe");
    for (var i = 0; i < frames.length; i += 1) {
      var frame = frames[i];
      if (frame.getAttribute("data-tg-tucked") === "1") continue;
      frame.setAttribute("data-tg-tucked", "1");
      tucked.push({
        el: frame,
        pointerEvents: frame.style.pointerEvents
      });
      frame.style.pointerEvents = "none";
    }
  }

  function restoreFrames() {
    for (var i = 0; i < tucked.length; i += 1) {
      var row = tucked[i];
      row.el.style.pointerEvents = row.pointerEvents;
      try { row.el.removeAttribute("data-tg-tucked"); } catch (e) {}
    }
    tucked = [];
  }

  function gate(result, base, siteKey, account) {
    if (global.__tgGate) return;
    if (!result || result.action !== "flag") return;
    global.__tgGate = true;
    global.__tgOpen = true;
    var root = document.documentElement;
    try { root.setAttribute("data-tg-gate", "1"); } catch (e) {}
    // 不锁 html/body overflow、不拦 touch：否则页面拉不动，Safari 底栏也透不出滚动内容。

    var style = document.createElement("style");
    style.id = "tg-gate-style";
    // 尺寸交给 JS（visualViewport）；外壳透明；只有中间面板接收点击。
    var appleGlass = false;
    try {
      var ua0 = String((global.navigator && global.navigator.userAgent) || "");
      appleGlass = /iPhone|iPad|iPod/i.test(ua0) || (global.navigator.platform === "MacIntel" && (global.navigator.maxTouchPoints || 0) > 1);
    } catch (eApple0) {}

    style.textContent = [
      "html[data-tg-gate='1'] iframe{pointer-events:none !important;}",
      /* 绝不写 inset/100svh：全屏 fixed（含透明）会让 Safari 底栏失去毛玻璃 */
      "#tg-gate{position:fixed;z-index:2147483647;display:block;box-sizing:border-box;margin:0;padding:0;border:0;background:transparent !important;pointer-events:none;}",
      "#tg-gate-dim{position:absolute;inset:0;background:rgba(15,23,32,.45);pointer-events:none;}",
      "#tg-gate-panel{position:relative;z-index:1;pointer-events:auto;margin:0 auto;}",
      /* Safari：不要用 flex 拉高遮罩；无全屏变暗；底部留给系统毛玻璃 */
      "html[data-tg-apple='1'] #tg-gate-dim{display:none !important;}",
      "html[data-tg-apple='1'] #tg-gate-panel{width:min(360px,calc(100% - 32px));}"
    ].join("");
    if (appleGlass) {
      try { root.setAttribute("data-tg-apple", "1"); } catch (eAppleAttr) {}
    }

    var overlay = document.createElement("div");
    overlay.id = "tg-gate";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "访问确认");

    var dim = document.createElement("div");
    dim.id = "tg-gate-dim";
    dim.setAttribute("aria-hidden", "true");

    var panel = document.createElement("div");
    panel.id = "tg-gate-panel";
    panel.setAttribute("style", "width:min(360px,calc(100% - 32px));max-height:min(70svh,520px);overflow:auto;background:#fff;border-radius:8px;padding:28px 24px 22px;box-shadow:0 12px 40px rgba(0,0,0,.28);text-align:center;font-family:PingFang SC,Microsoft YaHei,sans-serif;flex-shrink:0;");

    var title = document.createElement("div");
    title.textContent = "访问确认";
    title.setAttribute("style", "font-size:18px;line-height:1.4;font-weight:600;color:#222;");

    var desc = document.createElement("p");
    desc.textContent = "向右滑到头才能继续（无法关闭）";
    desc.setAttribute("style", "margin:12px 0 20px;font-size:14px;line-height:1.7;color:#666;");

    var track = document.createElement("div");
    track.setAttribute("style", "position:relative;height:44px;border-radius:22px;background:#f2f4f7;overflow:hidden;user-select:none;touch-action:none;");
    var fill = document.createElement("div");
    fill.setAttribute("style", "position:absolute;left:0;top:0;bottom:0;width:44px;background:#e8f7ef;");
    var label = document.createElement("div");
    label.textContent = "";
    label.setAttribute("style", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;color:#888;pointer-events:none;");
    var handle = document.createElement("div");
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", "向右滑到头才能继续");
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");
    handle.setAttribute("aria-valuenow", "0");
    handle.textContent = "›";
    handle.setAttribute("style", "position:absolute;left:0;top:0;width:44px;height:44px;border-radius:22px;background:#18a058;color:#fff;display:flex;align-items:center;justify-content:center;cursor:grab;font-size:22px;line-height:1;");
    track.appendChild(fill);
    track.appendChild(label);
    track.appendChild(handle);

    panel.appendChild(title);
    panel.appendChild(desc);
    panel.appendChild(track);
    overlay.appendChild(dim);
    overlay.appendChild(panel);

    function setImp(el, name, value) {
      try { el.style.setProperty(name, value, "important"); } catch (eSet) { el.style[name] = value; }
    }

    function fitViewport() {
      // Safari：上下拉/回弹/刷新后 visualViewport 会变；遮罩必须始终只等于弹窗盒，底边低于「底栏保留带」。
      var vv = global.visualViewport;
      var h = Math.max(1, Math.round((vv && vv.height) || global.innerHeight || 0));
      var w = Math.max(1, Math.round((vv && vv.width) || global.innerWidth || 0));
      var apple = appleGlass;
      setImp(overlay, "background", "transparent");
      setImp(overlay, "pointer-events", "none");
      setImp(overlay, "transform", "none");
      setImp(overlay, "-webkit-transform", "none");
      setImp(overlay, "padding", "0");
      setImp(overlay, "margin", "0");
      setImp(overlay, "border", "0");
      if (apple) {
        setImp(dim, "display", "none");
        // 底部保留带：地址栏 + 回弹时多留一些，防止拉到顶/底后仍盖住毛玻璃
        var reserve = Math.max(156, Math.round(h * 0.24));
        try {
          var gap = Math.round((global.innerHeight || 0) - h);
          if (gap > 0) reserve = Math.max(reserve, Math.min(220, gap + 48));
        } catch (eGap) {}
        var side = 16;
        var boxW = Math.min(360, Math.max(200, w - side * 2));
        setImp(panel, "width", boxW + "px");
        setImp(panel, "max-width", boxW + "px");
        setImp(panel, "max-height", Math.max(160, h - reserve - 24) + "px");
        setImp(panel, "margin", "0");
        // 先按内容测高，再夹紧 top，保证 overlay 底边 <= h - reserve
        setImp(overlay, "position", "fixed");
        setImp(overlay, "left", Math.round((w - boxW) / 2) + "px");
        setImp(overlay, "right", "auto");
        setImp(overlay, "width", boxW + "px");
        setImp(overlay, "bottom", "auto");
        setImp(overlay, "height", "auto");
        setImp(overlay, "max-height", "none");
        setImp(overlay, "top", "0");
        var ph = Math.max(panel.offsetHeight || 0, 200);
        if (ph > h - reserve - 16) ph = Math.max(160, h - reserve - 16);
        var topPad = Math.round((h - reserve - ph) / 2);
        if (topPad < 12) topPad = 12;
        if (topPad + ph > h - reserve) topPad = Math.max(8, h - reserve - ph);
        setImp(overlay, "top", topPad + "px");
        setImp(overlay, "height", ph + "px");
        setImp(overlay, "max-height", ph + "px");
      } else {
        setImp(overlay, "position", "fixed");
        setImp(overlay, "top", "0");
        setImp(overlay, "left", "0");
        setImp(overlay, "right", "0");
        setImp(overlay, "bottom", "0");
        setImp(overlay, "width", "auto");
        setImp(overlay, "height", "auto");
        setImp(overlay, "max-height", "none");
        setImp(overlay, "display", "flex");
        setImp(overlay, "align-items", "center");
        setImp(overlay, "justify-content", "center");
        setImp(dim, "display", "block");
        setImp(dim, "top", "0");
        setImp(dim, "left", "0");
        setImp(dim, "right", "0");
        setImp(dim, "bottom", "0");
        setImp(dim, "height", "auto");
      }
      setImp(panel, "pointer-events", "auto");
    }

    var fitScheduled = 0;
    function onViewportChange() {
      if (!global.__tgOpen) return;
      // 回弹过程中 vv 抖动：合并到一帧再量，避免拉到顶/底时短暂盖住底栏
      if (fitScheduled) return;
      fitScheduled = global.requestAnimationFrame ? global.requestAnimationFrame(function () {
        fitScheduled = 0;
        if (global.__tgOpen) fitViewport();
      }) : (global.setTimeout(function () {
        fitScheduled = 0;
        if (global.__tgOpen) fitViewport();
      }, 16), 1);
    }

    function mount() {
      if (!global.__tgOpen) return;
      // 挂 body：Safari 对 html 根上的 fixed 层更容易盖进底栏。
      var parent = document.body || root;
      if (!style.isConnected) (document.head || root).appendChild(style);
      if (!overlay.isConnected || overlay.parentNode !== parent) parent.appendChild(overlay);
      if (parent.lastElementChild !== overlay) parent.appendChild(overlay);
      fitViewport();
      // 布局后再夹一次（字体/滑块轨宽度变化）
      onViewportChange();
      if (!shownAt) shownAt = nowMs();
      tuckFrames();
    }

    function release() {
      // 无关闭键：只有滑动成功（passed）才能撤掉遮罩。
      if (!global.__tgOpen || !passed) return;
      global.__tgOpen = false;
      try { global.__tgGate = false; } catch (eGate) {}
      try { observer.disconnect(); } catch (e) {}
      try {
        if (global.visualViewport) {
          global.visualViewport.removeEventListener("resize", onViewportChange);
          global.visualViewport.removeEventListener("scroll", onViewportChange);
        }
        global.removeEventListener("resize", onViewportChange);
        global.removeEventListener("orientationchange", onViewportChange);
      } catch (e2) {}
      try {
        for (var hi = 0; hi < holdNames.length; hi += 1) {
          document.removeEventListener(holdNames[hi], hold, true);
        }
      } catch (eHold) {}
      try {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      } catch (eRm) {}
      try {
        var leftover = document.getElementById("tg-gate");
        if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
      } catch (eLeft) {}
      try {
        if (style.parentNode) style.parentNode.removeChild(style);
        var st = document.getElementById("tg-gate-style");
        if (st && st.parentNode) st.parentNode.removeChild(st);
      } catch (eSt) {}
      restoreFrames();
      try {
        root.style.removeProperty("overflow");
        if (document.body) document.body.style.removeProperty("overflow");
      } catch (eOv) {}
      try { root.removeAttribute("data-tg-gate"); } catch (e) {}
      try { root.removeAttribute("data-tg-apple"); } catch (eAppleRm) {}
    }

    var mountScheduled = 0;
    var observer = new MutationObserver(function () {
      if (!global.__tgOpen || mountScheduled) return;
      mountScheduled = global.setTimeout(function () {
        mountScheduled = 0;
        mount();
      }, 50);
    });

    var passed = false;
    var dragging = false;
    var originX = 0;
    var left = 0;
    var shownAt = 0;
    var downAt = 0;
    var movesBefore = 0;
    var lastApproach = 0;
    var approachPaused = false;
    var pointerType = "mouse";
    var samples = [];

    function stamp(event) {
      return {
        dt: Math.round(nowMs() - downAt),
        x: Math.round(event.clientX * 10) / 10,
        y: Math.round(event.clientY * 10) / 10,
        p: typeof event.pressure === "number" ? Math.round(event.pressure * 1000) / 1000 : 0,
        w: typeof event.width === "number" ? Math.round(event.width * 10) / 10 : 0,
        h: typeof event.height === "number" ? Math.round(event.height * 10) / 10 : 0
      };
    }

    function remember(event) {
      if (samples.length >= 60) return;
      var point = stamp(event);
      var prev = samples[samples.length - 1];
      if (prev && point.dt - prev.dt < 12 && Math.abs(point.x - prev.x) < 0.4 && Math.abs(point.y - prev.y) < 0.4) return;
      samples.push(point);
    }

    function maxLeft() {
      return Math.max(0, track.clientWidth - handle.offsetWidth);
    }

    function setLeft(value) {
      var max = maxLeft();
      left = Math.max(0, Math.min(max, value));
      handle.style.left = left + "px";
      fill.style.width = (left + handle.offsetWidth) + "px";
      var percent = max ? Math.round(left / max * 100) : 0;
      handle.setAttribute("aria-valuenow", String(percent));
    }

    function traceOf() {
      var last = samples[samples.length - 1];
      return {
        reaction: Math.round(downAt - shownAt),
        duration: last ? last.dt : Math.round(nowMs() - downAt),
        movesBefore: movesBefore,
        paused: approachPaused,
        pointer: pointerType,
        track: maxLeft(),
        travel: left,
        samples: samples
      };
    }

    function rejectSlide() {
      dragging = false;
      samples = [];
      setLeft(0);
      label.textContent = "请自然地再滑一次";
      label.style.color = "#c45c26";
      handle.textContent = "›";
    }

    function succeed() {
      if (passed || !global.__tgOpen) return;
      dragging = false;
      var trace = traceOf();
      if (trace.track < 8 || trace.travel < trace.track - 8) {
        rejectSlide();
        return;
      }
      // 本地先拦脚本轨迹；服务端还会再判一次。滑过仍是真量。
      if (judgeTrace(trace) === "perfect") {
        ping(base, account, result.id, "pass", trace).then(function () {});
        rejectSlide();
        return;
      }
      passed = true;
      stay.pause();
      label.textContent = "验证通过";
      label.style.color = "#18a058";
      handle.textContent = "✓";
      ping(base, account, result.id, "pass", trace).then(function (body) {
        if (body && (body.preview || (body.ok && body.human !== false))) {
          stay.stop();
          release();
        } else {
          passed = false;
          stay.resume();
          rejectSlide();
        }
      });
    }

    overlay.addEventListener("pointermove", function (event) {
      if (dragging || passed || !shownAt) return;
      var at = nowMs();
      if (lastApproach && at - lastApproach > 40) approachPaused = true;
      lastApproach = at;
      if (movesBefore < 40) movesBefore += 1;
    });

    handle.addEventListener("pointerdown", function (event) {
      if (passed) return;
      dragging = true;
      downAt = nowMs();
      pointerType = event.pointerType || "mouse";
      samples = [];
      originX = event.clientX - left;
      remember(event);
      try { handle.setPointerCapture(event.pointerId); } catch (e) {}
      event.preventDefault();
      event.stopPropagation();
    });
    handle.addEventListener("pointermove", function (event) {
      if (!dragging || passed) return;
      setLeft(event.clientX - originX);
      remember(event);
      event.preventDefault();
      event.stopPropagation();
    });
    function endDrag(event) {
      if (!dragging || passed) return;
      remember(event);
      dragging = false;
      var max = maxLeft();
      if (max > 0 && left >= max - 6) succeed();
      else setLeft(0);
      event.preventDefault();
      event.stopPropagation();
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", function () {
      dragging = false;
      if (!passed) setLeft(0);
    });

    if (typeof global.PointerEvent !== "function") {
      handle.addEventListener("touchstart", function (event) {
        if (passed || !event.touches || !event.touches[0]) return;
        var t = event.touches[0];
        dragging = true;
        downAt = nowMs();
        pointerType = "touch";
        samples = [];
        originX = t.clientX - left;
        remember(t);
        event.preventDefault();
        event.stopPropagation();
      }, false);
      handle.addEventListener("touchmove", function (event) {
        if (!dragging || passed || !event.touches || !event.touches[0]) return;
        var t = event.touches[0];
        setLeft(t.clientX - originX);
        remember(t);
        event.preventDefault();
        event.stopPropagation();
      }, false);
      handle.addEventListener("touchend", function (event) {
        if (!dragging || passed) return;
        var t = (event.changedTouches && event.changedTouches[0]) || null;
        if (t) remember(t);
        dragging = false;
        var max = maxLeft();
        if (max > 0 && left >= max - 6) succeed();
        else setLeft(0);
        event.preventDefault();
        event.stopPropagation();
      }, false);
      handle.addEventListener("touchcancel", function () {
        dragging = false;
        if (!passed) setLeft(0);
      }, false);
    }

    function hold(event) {
      if (!global.__tgOpen) return;
      if (event.type === "keydown" || event.type === "keyup") {
        // 无关闭键：Esc / 回车等都不能关掉弹窗。
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      var target = event.target;
      if (target && (target === panel || panel.contains(target))) return;
      // 只拦 click：绝不能对 pointerdown/touch 调 preventDefault，否则 iOS 滚不动，Safari 底栏透不出内容。
      event.preventDefault();
      event.stopPropagation();
    }

    var holdNames = ["click", "auxclick", "contextmenu", "keydown", "keyup"];
    holdNames.forEach(function (name) {
      document.addEventListener(name, hold, true);
    });

    try {
      if (global.visualViewport) {
        global.visualViewport.addEventListener("resize", onViewportChange);
        global.visualViewport.addEventListener("scroll", onViewportChange);
      }
      global.addEventListener("resize", onViewportChange);
      global.addEventListener("orientationchange", onViewportChange);
    } catch (eVv) {}
    mount();
    try { observer.observe(root, { childList: true, subtree: true }); } catch (e) {}
    ping(base, account, result.id, "show");
  }

  function pageHost() {
    try { return String(global.location.hostname || "").toLowerCase(); } catch (e) { return ""; }
  }

  function accountOf(options) {
    return (options && options.account) || (script && script.getAttribute && script.getAttribute("data-account")) || "";
  }

  var followed = false;
  // 跨域嵌入必须用 text/plain：application/json 会触发预检，
  // sendBeacon(application/json) 在浏览器里还常被静默丢弃。
  function postJson(url, body) {
    if (typeof global.fetch === "function") {
      return fetch(url, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: body,
        keepalive: true
      });
    }
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "text/plain;charset=UTF-8");
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            json: function () {
              return Promise.resolve(JSON.parse(xhr.responseText || "{}"));
            }
          });
        };
        xhr.onerror = function () { reject(new Error("check failed")); };
        xhr.send(body);
      } catch (e) {
        reject(e);
      }
    });
  }

  function beaconPlain(url, body) {
    try {
      if (global.navigator && global.navigator.sendBeacon && global.navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
        return true;
      }
    } catch (e) {}
    try {
      fetch(url, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: body,
        keepalive: true
      }).catch(function () {});
      return true;
    } catch (e2) {}
    return false;
  }

  // 卸载补报：只记 __tgLeaveSent，绝不写 __tgSent，避免挡住首次/二次检测。
  // 不用 visibilitychange：切标签、短暂熄屏会误触发。
  function lightLeave(event) {
    if (event && event.persisted) return;
    // 完整检测已发出或正在发：交给 check 自己的 pagehide，避免无 source 的离开包再记一笔真实。
    if (global.__tgSent || global.__tgChecking || global.__tgLeaveSent) return;
    var account = accountOf(null);
    if (!account) return;
    var body = JSON.stringify({
      account: account,
      siteKey: pageHost(),
      followUp: true,
      signals: { engagement: { leaving: true, elapsed: 0, pointerMoves: 0, scroll: 0 } },
      source: sourceOf()
    });
    if (beaconPlain(origin + "/api/v1/check", body)) global.__tgLeaveSent = true;
  }

  global.addEventListener("pagehide", lightLeave);

  function check(opts) {
    var options = opts || {};
    var account = accountOf(options);
    var siteKey = options.siteKey || pageHost();
    var base = options.endpoint || origin;
    var followUp = options.followUp === true;
    var leaving = options.leaving === true;
    if (!account) return Promise.resolve({ action: "allow", tracked: false });
    if (!followUp && global.__tgSent) return Promise.resolve({ action: "allow", tracked: true });
    global.__tgChecking = true;
    var sent = false;
    function bodyOf(hints, motion, isLeaving) {
      return JSON.stringify({
        account: account,
        siteKey: siteKey,
        followUp: followUp || !!isLeaving,
        signals: collect(hints, motion, isLeaving),
        source: sourceOf()
      });
    }
    function beacon(body) {
      return beaconPlain(base + "/api/v1/check", body);
    }
    if (!followUp) {
      global.addEventListener("pagehide", function (event) {
        if (event && event.persisted) return;
        if (sent || global.__tgSent) return;
        sent = true;
        // 仅标记本次 check 已发出离开包；完整检测脚本仍可在 bfcache 恢复后继续。
        global.__tgLeaveSent = true;
        beacon(bodyOf(null, lastMotion, true));
      });
    }
    var ready = followUp ? Promise.resolve([null, lastMotion]) : Promise.all([
      Promise.race([hintsOf(), new Promise(function (resolve) { global.setTimeout(function () { resolve(null); }, 150); })]),
      sampleMotion(120)
    ]);
    return ready.then(function (pair) {
      if (sent) return { ok: true, action: "allow", tracked: true };
      sent = true;
      if (!followUp) global.__tgSent = true;
      if (!followUp) lastMotion = pair[1];
      var body = bodyOf(pair[0], pair[1], leaving);
      return postJson(base + "/api/v1/check", body).catch(function () {
        beacon(body);
        return { ok: false };
      });
    }).then(function (res) {
      if (!res || res.tracked === true && res.action === "allow" && !res.id) return res;
      if (res.ok === false) return { action: "allow", tracked: true };
      if (!res.ok) throw new Error("check failed");
      return res.json();
    }).then(function (result) {
      if (!result || !result.id) return result;
      if (result && result.action === "flag") {
        // 只在二次检测确认假量后盖页；首次打开必须先让站点出来。
        if (!leaving && result.challenge) {
          gate(result, base, result.siteKey || siteKey, result.accountId || account);
          watchStay(base, result.accountId || account, result.id);
        }
      }
      // 首次检测无论是否可疑都安排二次监测，避免「先进站」被跳过。
      if (!followUp) scheduleFollowUp();
      return result;
    });
  }

  function scheduleFollowUp() {
    if (followed) return;
    function send(leaving) {
      if (followed) return;
      followed = true;
      check({ followUp: true, leaving: leaving === true }).catch(function () {});
    }
    // 与服务端有效浏览阈值一致：约 4 秒后再二次检测/记 IP。
    global.setTimeout(function () { send(false); }, 4000);
    global.addEventListener("pagehide", function () { send(true); });
  }

  function reportDwell(base, account, id, dwell, commit) {
    var siteKey = "";
    try { siteKey = String((global.location && global.location.hostname) || "").toLowerCase(); } catch (e0) { siteKey = ""; }
    var body = JSON.stringify({ account: account, siteKey: siteKey || undefined, id: id, kind: "dwell", dwell: dwell, commit: commit === true });
    beaconPlain(base + "/api/v1/popup", body);
  }

  var stay = {
    pause: function () {},
    resume: function () {},
    stop: function () {}
  };

  function watchStay(base, account, id) {
    if (!id || id === "preview" || !account) return;
    var started = Date.now();
    var last = -1;
    var timer = 0;
    var stopped = false;
    var paused = false;
    stay.pause = function () { paused = true; };
    stay.resume = function () { paused = false; };
    stay.stop = function () {
      stopped = true;
      if (timer) global.clearInterval(timer);
      timer = 0;
    };
    var countAfter = 60 * 1000;
    function send(commit) {
      if (stopped || paused) return;
      var dwell = Date.now() - started;
      if (dwell < 0) return;
      if (dwell > 24 * 60 * 60 * 1000) dwell = 24 * 60 * 60 * 1000;
      if (dwell >= countAfter) commit = true;
      if (!commit && (dwell < 1000 || dwell - last < 1000)) return;
      last = dwell;
      reportDwell(base, account, id, dwell, commit);
      if (dwell >= 24 * 60 * 60 * 1000) stay.stop();
    }
    // visibilitychange 只暂停/恢复停留计时，绝不提交、不写 __tgSent。
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") paused = true;
      else if (!stopped) paused = false;
    });
    global.addEventListener("pagehide", function (event) {
      if (event && event.persisted) return;
      send(true);
    });
    global.setTimeout(function () { send(false); }, 15000);
    global.setTimeout(function () { send(true); }, countAfter);
    timer = global.setInterval(function () { send(false); }, 30000);
  }

  var api = { check: check };
  global.TrafficGuard = api;

  // guard.js 已在进站 2 秒后拉起本脚本；到此立即采集并检测。
  // 首次检测服务端也不弹窗；只有二次确认假量才盖页。
  try {
    watchBehavior();
  } catch (e0) {}
  try {
    startAudio();
    if (script && script.getAttribute && script.getAttribute("data-preview") === "gate" && localHost()) {
      api.ready = Promise.resolve().then(function () {
        gate({ action: "flag", id: "preview", siteKey: "preview" }, origin, "preview", "");
        return { action: "flag", id: "preview" };
      });
    } else if (!accountOf(null)) {
      api.ready = Promise.resolve(null);
    } else {
      api.ready = check({}).then(function (result) {
        try {
          global.dispatchEvent(new CustomEvent("trafficguard", { detail: result }));
        } catch (e) {}
        return result;
      }).catch(function () {
        return null;
      });
    }
  } catch (e) {
    api.ready = Promise.resolve(null);
  }
})(window);
