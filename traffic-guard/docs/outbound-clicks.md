# 出站链接点击

刷量检测原来的 `guard.js` 没有改。出站点击是旁边新加的一段 `track.js`，仍然报到这台中央服务器。来源站点只看浏览器带来的 `Origin` / `Referer`，不看页面自己填的站名。

`track.js` 不调用进站检测接口，不写进站记录。脚本一下载就开始监听，不等图片加载完，这样页还在加载时的点击也能记到。点击监听是 passive 的，不能取消跳转，也不改链接地址，不挡住原站打开。`window.open` 先走页面原来的函数，弹窗打开之后才上报；页面如果之后又包了一层 `window.open`，`load` 时会再包一次。直接 `window.open` 一个外站地址也会记，不要求刚才点过带标记的链接。

## 目录

- `public/track.js`：各站引入的脚本。捕获阶段监听点击，并用 `navigator.sendBeacon` 上报。
- `app/collect/route.ts`：`/collect`。POST 记一条并返回 204，GET 是 1x1 像素兜底。
- `lib/registrable.ts`：根域名判断。`example.com.cn`、`example.co.uk` 不会被切错。
- `lib/clicks.ts`：白名单、写入、按链接和广告位汇总。
- `data/clicks/YYYY-MM-DD.jsonl`：一天一个文件。
- `data/click-allow.txt`：额外放行的根域名。
- `app/admin/clicks/page.tsx`：后台「出站点击」。
- `app/api/v1/admin/clicks/route.ts`：登录后才能看的统计接口。
- `scripts/click-stats.mjs`：命令行汇总。

收集服务做在现有的 Next.js 里，没有再起一个 Express。各站本来就只连这一台服务器，数据也和账号、站点放在一起。

## 记下来的字段

每行一条 JSON：

| 字段 | 含义 |
| --- | --- |
| at | 服务器收到的时间，毫秒 |
| source | 来源站点主机名，来自 Origin，没有 Origin 时用来源页面的 Referer |
| target | 点出去的链接，去掉锚点和账号密码 |
| host | 目标链接的域名 |
| page | 发生点击的页面地址 |
| slot | 广告位。页面写了 `data-ad-slot` 或 `data-ev` 就用那个；没写时由脚本按附近短标题、图片说明或链接文字自动生成。`<script>`、`<style>` 里的代码不拿来当名字，`document.write(...)` 会从名称里去掉 |
| ad | 链接上的 `data-ad-id` |
| text | 链接文字，最多 80 字 |
| ip | 访客 IP |
| ua | 浏览器 UA |
| account | 这台服务器根据来源站点归到的账号 |

页面里传来的 IP、UA、来源站名一律不用。

## 什么算本站

`www.example.com`、`blog.example.com` 和 `example.com` 互相跳转，根域名都是 `example.com`，不记。

`example.com.cn` 的根域名是 `example.com.cn`，不会被当成 `com.cn`。`example.co.uk` 同样保留三段。一个品牌如果还有第二个根域名，在脚本上加 `data-own="brand.cn"`。

## 统计

后台打开「出站点击」，先看出站站点。同一根域名下的子域名（如 `kjcc-99951.99951bb.app`）会汇总成一行根域名（`99951bb.app`），方便按站点对照。目标链接和广告位要先选出站站点再看，表格按页翻。可以按今天、昨天、近 7 天、本月看。出站 IP 按不同 IP 计；点击量按每一次点击计。这一页只读出站记录，不改刷量脚本，也不影响进站。

登录后的接口：

```text
GET /api/v1/admin/clicks?from=2026-10-01&to=2026-10-15
GET /api/v1/admin/clicks?from=2026-10-01&to=2026-10-15&source=example.com
```

返回 `total`（点击次数）、`ips`（不同出站 IP）、`sites`（每个出站域名的点击量和 IP 数）、`urls`（按出站域名加目标链接分开的点击量和 IP 数）、`slots`（按出站域名加广告位分开）。普通账号只能看到自己和子账号的记录。

命令行在项目目录执行：

```bash
node scripts/click-stats.mjs
node scripts/click-stats.mjs --from 2026-10-01 --to 2026-10-15
node scripts/click-stats.mjs --by slot
node scripts/click-stats.mjs --by site --source example.com
```

## 接入

账号页有「出站点击代码」。和原来的刷量代码一起放进公共模板，每个页面只放一次。不要放进 Vue、React 组件，也不要用 `innerHTML` 插进去。

```html
<script async src="https://lljc.ki8uh.com/guard.js" data-account="账号id"></script>
<script async src="https://lljc.ki8uh.com/track.js" data-account="账号id"></script>
```

不用改广告链接。脚本听的是整页点击，位置随机、顺序变化、后来才插入页面，都能记到。广告位按这个顺序自动取：

1. 链接或外层写了 `data-ad-slot`，用这个名字。已经有 `data-ev` 的也拿来当广告位。
2. 外层有明确的 id、广告位 class，或是页顶、页尾、导航、侧栏，用那个位置。
3. 再用链接上方不远的短标题，配上图片 `alt`、链接上看得见的文字或图片文件名。链接里的 `<script>`、`<style>` 不算文字。
4. 这些都没有，就用对方域名。

同一个标题下、文字也一样的广告会算在一起。想把某一条单独分开时，再在那一条或它的外层加上 `data-ad-slot="首页右侧"`。`data-ad-id` 可以不写。

`mailto:`、`tel:`、`javascript:` 和本站链接本身不会上报。点到链接里面的图片或文字也能抓到。`javascript:` 链接、按钮，或带 `data-href`、`data-url`、`data-link`、`data-jump` 的区块，接着用 `location.href`、`location.assign`、`location.replace` 或 `window.open` 打开外站时会记。表单提交到外站也会记。同一个根域名下的 iframe 会跟着听。广告如果用 `window.open` 打开，记的是打开的那个地址；刚点过的元素能对上时，带上它的广告位。浏览器把弹窗拦住也记。右键菜单里选「新窗口打开」，以及跨域 iframe 里的点击，仍然记不到。

## 你需要改的地方

1. 各站模板加上面的 `track.js`。原来的 `guard.js` 那一行保持原样。
2. 不用给每条广告加 `data-ad-slot`。只在想给某一个广告位单独起名时才加。
3. 新站如果刷量检测里还没有出现过，把根域名写进服务器的 `data/click-allow.txt`，或写进环境变量 `CLICK_ORIGINS=example.com,example.cn`。已经在刷量检测里出现过的站点和它的子域名会自动放行。99951、67845 的正文开在内层的 `99951bb.app`、`67845bb.app`，这两个域名已经放行，否则点击到了服务器也不会记。
4. `docker-compose.yml` 挂了 `./data/clicks` 和 `./data/cache`。重新创建容器前先在宿主机建好这两个目录，否则点击记录和总览缓存会留在容器里，重建后消失。
5. 要自动删旧文件时，设置 `CLICK_KEEP_DAYS=90`。不设置就一直留着，由你自己按天删 `data/clicks/*.jsonl`。

## 部署

- 页面和 `/collect` 都要走 HTTPS。脚本地址已经是 `https://lljc.ki8uh.com/track.js`。
- `track.js` 缓存 5 分钟，前面的 CDN 不要缓存更久。`/collect` 不能缓存。
- 浏览器会带上 Origin。服务器不在白名单里的来源只收到 204 或一张空图，不会写入。
- 同一个 IP 10 秒内最多记 40 次，多出来的直接丢掉，仍然马上返回，不拖页面。
- 一天一个 JSONL 文件，相当于按天切割。统计会读完这一天的全部记录。一次查询最多横跨 400 天。
- IP 和页面地址算访客数据。不需要时删掉对应日期的文件。广告链接里不要放手机号、身份证或登录令牌，链接文字最多只留 80 字。

## 换成数据库

现在每次点击是往当天的 JSONL 追加一行。要换成 SQLite 或 MySQL 时，只改 `lib/clicks.ts` 里的 `acceptClick` 和 `summarizeClicks`，`/collect` 和 `track.js` 不用动。

```sql
CREATE TABLE outbound_clicks (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  host TEXT NOT NULL,
  page TEXT NOT NULL,
  slot TEXT NOT NULL,
  ad TEXT NOT NULL,
  text TEXT NOT NULL,
  ip TEXT NOT NULL,
  ua TEXT NOT NULL,
  account TEXT NOT NULL
);
CREATE INDEX outbound_clicks_at ON outbound_clicks (at);
CREATE INDEX outbound_clicks_target ON outbound_clicks (target);
CREATE INDEX outbound_clicks_slot ON outbound_clicks (slot);
```

写入用一条 `INSERT`，统计用 `COUNT(*) GROUP BY target` 和 `GROUP BY slot`。接口仍然先返回 204，插入放到返回之后做。

## iframe

外层页面的 `track.js` 能听到同一个根域名下 iframe 里的点击和跳转。广告如果在跨域 iframe 里，外层脚本进不去，需要把 `track.js` 放进那个 iframe 自己的页面；对方不让放脚本时，这一块统计不到。
