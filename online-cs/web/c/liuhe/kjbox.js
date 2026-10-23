
(function () {
  var HOST = 'wss://wsapi.mndeob.com:2026/ws/v2';

  // 波色表（与原实现一致）
  var RED = [1, 2, 7, 8, 12, 13, 18, 19, 23, 24, 29, 30, 34, 35, 40, 45, 46];
  var BLUE = [3, 4, 9, 10, 14, 15, 20, 25, 26, 31, 36, 37, 41, 42, 47, 48];
  var GREEN = [5, 6, 11, 16, 17, 21, 22, 27, 28, 32, 33, 38, 39, 43, 44, 49];
  var C_RED = '#e71607', C_BLUE = '#2389e9', C_GREEN = '#1fb61d', C_GRAY = '#999999';

  function ballColor(n) {
    n = parseInt(n, 10);
    if (RED.indexOf(n) > -1) return C_RED;
    if (BLUE.indexOf(n) > -1) return C_BLUE;
    if (GREEN.indexOf(n) > -1) return C_GREEN;
    return C_GRAY;
  }

  var CSS = ''
    + '.kjbox{background:#fff;font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;'
    +   'color:#333;font-size:16px;box-sizing:border-box}'
    + '.kjbox *{box-sizing:border-box}'
    + '.kjbox-blk{padding:8px}'
    + '.kjbox-blk + .kjbox-blk{border-top:1px dashed #ccc}'
    /* 标题行：期号 / 倒计时 / 历史记录 */
    + '.kjbox-tit{display:flex;align-items:center;height:17px;line-height:17px;font-size:17px}'
    + '.kjbox-tit-l{flex:0 0 auto}'
    + '.kjbox-tit-m{flex:1 1 auto;text-align:center;font-weight:bold}'
    + '.kjbox-tit-r{flex:0 0 auto}'
    + '.kjbox a{text-decoration:none;color:#f00}'
    /* 号码球行 */
    + '.kjbox-con{display:flex;align-items:center;margin:8px 0}'
    + '.kjbox-ball{flex:1 1 0;min-width:0;height:61px;border-radius:4px;background:' + C_GRAY + ';'
    +   'display:flex;flex-direction:column;align-items:center;justify-content:center;margin-right:5px;overflow:hidden}'
    + '.kjbox-ball:last-child{margin-right:0}'
    + '.kjbox-ball .num{color:#fff;font:900 28px/24px Tahoma,Geneva,sans-serif}'
    + '.kjbox-ball .whsx{height:19px;line-height:19px;margin-top:6px;padding:0 5px;border-radius:2px;'
    +   'background:#fff;color:#333;font-size:20px;font-weight:bold}'
    + '.kjbox-add{flex:0 0 auto;margin-right:5px;font-size:32px;font-weight:bold}'
    /* 底部一行 */
    + '.kjbox-foot{display:flex;align-items:center;font-size:16px}'
    + '.kjbox-foot-l{flex:1 1 auto}'
    + '.kjbox-foot-r-sx{display:inline-block;width:40px;height:20px;line-height:20px;text-align:center;'
    +   'color:#fff;border-radius:4px;background:#FF9900;cursor:pointer}'
    /* 等待数据时的表现：灰球 + 提示，不是白块 */
    + '.kjbox-wait{font-size:14px;color:#888;text-align:center;padding:6px 0 2px}'
    + '.kjbox-blk.loading .kjbox-con{opacity:.55}'

    + '@media (max-width:650px){'
    +   '.kjbox{font-size:14px}'
    +   '.kjbox-tit{font-size:16px}'
    +   '.kjbox-ball{margin-right:4px}'
    +   '.kjbox-ball .num{font-size:24px}'
    +   '.kjbox-ball .whsx{margin-top:4px;padding:0 3px;font-size:20px}'
    +   '.kjbox-add{margin-right:4px;font-size:24px}'
    +   '.kjbox-foot{font-size:15px}'
    + '}'
    + '@media (max-width:400px){'
    +   '.kjbox-tit{font-size:15px}'
    +   '.kjbox-ball .num{font-size:22px}'
    +   '.kjbox-ball .whsx{font-size:18px;height:17px;line-height:17px}'
    +   '.kjbox-foot{font-size:14px}'
    + '}';

  // ── 注入样式（只一次）──
  if (!window.__kjboxCss) {
    window.__kjboxCss = 1;
    var st = document.createElement('style');
    st.setAttribute('data-kjbox', '1');
    st.appendChild(document.createTextNode(CSS));
    (document.head || document.documentElement).appendChild(st);
  }

  // ── 生成一块骨架（澳门 / 香港各一块）──
  function blkHTML(id, name) {
    var balls = '';
    for (var i = 1; i <= 6; i++) {
      balls += '<div class="kjbox-ball" id="' + id + 'w' + i + '">'
        + '<div class="num">-</div><div class="whsx">-</div></div>';
    }
    balls += '<div class="kjbox-add">+</div>';
    balls += '<div class="kjbox-ball" id="' + id + 'w7">'
      + '<div class="num">-</div><div class="whsx">-</div></div>';
    return '<div class="kjbox-blk loading" id="' + id + 'blk">'
      + '<div class="kjbox-tit">'
      +   '<div class="kjbox-tit-l">' + name + '第<b class="kjbox-q" id="' + id + 'q">--</b>期</div>'
      +   '<div class="kjbox-tit-m"><span id="' + id + 'cd">--:--:--</span></div>'
      +   '<div class="kjbox-tit-r"><a href="' + (id === 'hk'
              ? 'https://2025kj.zkclhb.com:2025/hk.html'
              : 'https://2025kj.zkclhb.com:2025/am.html')
      +     '" target="_blank">历史记录</a></div>'
      + '</div>'
      + '<div class="kjbox-con">' + balls + '</div>'
      + '<div class="kjbox-foot">'
      +   '<div class="kjbox-foot-l" id="' + id + 'ft">正在连接…</div>'
      +   '<div class="kjbox-foot-r"><span class="kjbox-foot-r-sx" id="' + id + 'rf">刷新</span></div>'
      + '</div>'
      + '</div>';
  }

  // ── 渲染：把一行 data 填进对应块 ──
  function render(host, id, data) {
    var seg = String(data).split('|');
    var nums = (seg[0] || '').split(',');
    var zods = (seg[1] || '').split(',');
    if (nums.length < 9) return;

    var q = document.getElementById(id + 'q');
    if (q) q.textContent = nums[0];

    // 7 个球：前 6 个平码 + 第 7 个特码
    for (var i = 1; i <= 7; i++) {
      var ball = document.getElementById(id + 'w' + i);
      if (!ball) continue;
      var n = (nums[i] || '').trim();
      var z = (zods[i] || '').trim();
      var numEl = ball.querySelector('.num');
      var zodEl = ball.querySelector('.whsx');
      // 号码不足两位补零（1 → 01）。原始数据给的是 "8"/"3" 这种单位数，
      // 这里只改显示，波色判定仍用 parseInt，不受影响。
      var show = /^\d+$/.test(n) && n.length < 2 ? '0' + n : n;
      if (numEl) numEl.textContent = show || '-';
      if (zodEl) zodEl.textContent = z || '-';
      if (/^\d+$/.test(n)) {
        ball.style.backgroundColor = ballColor(n);
        ball.style.color = '#fff';
      } else {
        ball.style.backgroundColor = C_GRAY;
      }
    }

    // 底部：下一期 + 开奖时间
    // 原始 WS 数据里日期形如 "2026/10/13/二/21点32分"，原 iframe 显示成
    // "10月13日 星期二 21点32分"，这里做同样的呈现（去掉年份、把 "二" 补成 "星期二"）。
    var ft = document.getElementById(id + 'ft');
    if (ft) {
      var nextQ = nums[8] || '';
      var raw = nums[9] || '';
      var when = raw;
      var dm = raw.match(/^\d{4}\/(\d{1,2})\/(\d{1,2})\/(.)?\/(.*)$/);
      if (dm) when = +dm[1] + '月' + +dm[2] + '日 ' + (dm[3] ? '星期' + dm[3] : '') + ' ' + dm[4];
      else when = raw.replace(/\//g, ' ');
      ft.textContent = host + '第' + nextQ + '期: ' + when;
    }

    // 标记已就绪（去掉 loading 的透明度）
    var box = document.getElementById(id + 'blk');
    if (box) box.className = 'kjbox-blk';

    // 记下开奖时间，供倒计时用
    if (nums[9]) {
      var m = nums[9].match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\/.*?(\d{1,2})点(\d{1,2})分/);
      if (m) {
        CD[id] = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
        if (CD[id] <= new Date()) CD[id].setDate(CD[id].getDate() + 1);   // 已过则顺延一天
      }
    }
  }

  // ── 倒计时 ──
  var CD = {};   // { am: Date, hk: Date }
  function tick() {
    var now = new Date();
    ['am', 'hk'].forEach(function (id) {
      var el = document.getElementById(id + 'cd');
      if (!el) return;
      var t = CD[id];
      if (!t) { el.textContent = '--:--:--'; return; }
      var s = Math.floor((t - now) / 1000);
      if (s < 0) s = 0;
      var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      el.textContent = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (ss < 10 ? '0' : '') + ss;
    });
  }
  setInterval(tick, 1000);
  // ── WebSocket：连不上/断开都自动重连 ──
  var ws = null, hb = null, retry = 0, alive = false;
  function setFoot(txt) {
    ['am', 'hk'].forEach(function (id) {
      var el = document.getElementById(id + 'ft');
      if (el && !alive) el.textContent = txt;
    });
  }
  function connect() {
    try { ws = new WebSocket(HOST); } catch (e) { return schedule(); }

    ws.onopen = function () {
      retry = 0; alive = true;
      ws.send(JSON.stringify({ action: 'subscribe', groups: ['am', 'hk'] }));
      clearInterval(hb);
      hb = setInterval(function () {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ action: 'heartbeat' }));
      }, 20000);
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'data' && msg.data) {
        if (msg.group === 'am') render('澳门', 'am', msg.data);
        else if (msg.group === 'hk') render('香港', 'hk', msg.data);
      }
    };
    ws.onerror = function () { };
    ws.onclose = function () { alive = false; clearInterval(hb); schedule(); };
  }
  function schedule() {
    retry++;
    var wait = Math.min(30000, 1500 * Math.pow(1.6, Math.min(retry, 8)));
    setFoot('连接中断，' + Math.round(wait / 1000) + ' 秒后重试…');
    setTimeout(connect, wait);
  }

  // ── 澳门 / 香港开奖块切换：点澳门隐藏香港，点香港隐藏澳门 ──
  function pageDefaultRegion() {
    try {
      var p = (location.pathname || '').toLowerCase();
      if (p.indexOf('hk.html') >= 0 || p.indexOf('/hk') >= 0) return 'hk';
    } catch (e) {}
    return 'am';
  }
  function showRegion(which) {
    which = which === 'hk' ? 'hk' : 'am';
    var am = document.getElementById('amblk');
    var hk = document.getElementById('hkblk');
    if (am) am.style.display = which === 'am' ? '' : 'none';
    if (hk) hk.style.display = which === 'hk' ? '' : 'none';
    try {
      var items = document.querySelectorAll('.kjt li');
      for (var i = 0; i < items.length; i++) {
        var li = items[i];
        var t = (li.textContent || '').replace(/\s+/g, '');
        var on = (which === 'am' && t.indexOf('澳门') >= 0) || (which === 'hk' && t.indexOf('香港') >= 0);
        if (on) li.classList.add('liactive');
        else li.classList.remove('liactive');
      }
    } catch (e) {}
    try { window.__kjboxRegion = which; } catch (e2) {}
  }
  function bindRegionTabs() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== document) {
        if (el.tagName === 'LI' && el.parentNode && el.parentNode.classList && el.parentNode.classList.contains('kjt')) {
          var t = (el.textContent || '').replace(/\s+/g, '');
          if (t.indexOf('澳门') >= 0) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            showRegion('am');
            return;
          }
          if (t.indexOf('香港') >= 0) {
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            showRegion('hk');
            return;
          }
        }
        if (el.tagName === 'A') {
          var at = (el.textContent || '').replace(/\s+/g, '');
          var inKjt = false;
          var p = el.parentNode;
          while (p && p !== document) {
            if (p.classList && p.classList.contains('kjt')) { inKjt = true; break; }
            p = p.parentNode;
          }
          if (inKjt) {
            if (at.indexOf('澳门') >= 0) {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              showRegion('am');
              return;
            }
            if (at.indexOf('香港') >= 0) {
              if (e.cancelable) e.preventDefault();
              e.stopPropagation();
              showRegion('hk');
              return;
            }
          }
        }
        el = el.parentNode;
      }
    }, true);
  }

  // ── 输出 ──
  // 注意：本脚本被写在 <td> 里，document.write 输出 <div> 会被 HTML 解析器
  // 从表格中"弹出"(foster parenting)。所以只 write 一个合法的 <span> 占位，
  // 真正的控件结构在 DOMContentLoaded 后由 DOM 挂进去。
  var SPAN_ID = 'kjbox-host-' + Math.random().toString(36).slice(2, 8);
  document.write('<span id="' + SPAN_ID + '"></span>');
  function mount() {
    var host = document.getElementById(SPAN_ID);
    if (!host) return;
    var wrap = document.createElement('div');
    wrap.className = 'kjbox';
    wrap.innerHTML = blkHTML('am', '澳门') + blkHTML('hk', '香港');
    host.parentNode.insertBefore(wrap, host);
    connect();
    tick();
    // 默认按页面显示对应开奖；顶部 Tab 点击切换，互斥隐藏另一侧
    showRegion(pageDefaultRegion());
    bindRegionTabs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();

  // 手动刷新
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document) {
      if (el.id === 'amrf' || el.id === 'hkrf') {
        var id = el.id.slice(0, 2);
        var f = document.getElementById(id + 'ft');
        if (f) f.textContent = '正在刷新…';
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ action: 'subscribe', groups: ['am', 'hk'] }));
        else connect();
        return;
      }
      el = el.parentNode;
    }
  }, true);
})();
