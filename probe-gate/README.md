# 隐藏弹窗（刷量检测）

源码都在本目录，每个文件顶部和关键函数都有中文注释。

独立服务。**只有爬虫、无头浏览器、机房 IP 会看到「访问核验」弹窗**，真实用户看不到。后台可以看来源 / 来路 / 弹窗曝光。

不依赖开奖网，可单独放到别的服务器，用一行脚本挂到任意网站。

## 别的服务器部署

需要 Node 22+，或 Docker。

```bash
# 解压后
cd probe-gate
docker compose up -d --build
```

或不用 Docker：

```bash
cd probe-gate
OWNER_USER=shuji888 OWNER_PASS='admin123@' PORT=18471 node server/index.mjs
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `18471` | 监听端口 |
| `OWNER_USER` | `shuji888` | 最高账号（首次启动写入，之后可在后台改自己的号） |
| `OWNER_PASS` | `admin123@` | 最高账号密码 |
| `ADMIN_USER_KEEP` | `admin` | 管理员账号（保留，与最高账号并存） |
| `ADMIN_PASS_KEEP` | `admin123@` | 管理员密码 |
| `ALLOW_ORIGINS` | `*` | 允许跨域的站点，多个用逗号。嵌入到其他域名时通常保持 `*` |
| `DATA_DIR` | `./data` 或 `/data` | 日志目录 |
| `TZ` | 建议 `Asia/Hong_Kong` | 按香港日期切日志 |

前面用 Nginx 反代时请带上真实 IP：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
```

## 挂到目标网站

把下面这一行放到目标站 HTML 的 `</body>` 前（把域名换成你的弹窗服务器）：

```html
<script src="https://你的弹窗域名/probe.js"></script>
```

可选属性：

```html
<script
  src="https://你的弹窗域名/probe.js"
  data-api="https://你的弹窗域名"
  data-site="站点名"
  data-skip="admin"
></script>
```

- `data-api`：接口根地址，一般不用填，会按脚本自己的地址请求 `/api/probe`
- `data-site`：写入后台的站点名
- `data-skip`：路径里包含这些字则不弹，默认 `admin`

同域部署（Nginx 把本服务和网站放在一起）也可以写成：

```html
<script src="/probe.js"></script>
```

## 后台

打开 `https://你的弹窗域名/admin` 。两个账号均可登录：

- 最高账号：`shuji888` / `admin123@`
- 管理员：`admin` / `admin123@`（保持不变）

登录后可在「账号设置」修改**当前账号**的用户名/密码（持久化到 `DATA_DIR/admin-account.json`）。

## 判定规则（与开奖网前台一致）

1. UA 像爬虫 / 扫描器 → 爬虫  
2. `navigator.webdriver` 或 HeadlessChrome → 无头浏览器  
3. IP 落在常见云厂商网段 → 机房 IP  
4. 以上都不是 → 真实用户，**不弹窗**

弹窗文案、来源、来路与开奖网「访问核验」相同。关掉一次后，当前标签页不再弹（`sessionStorage`）。

## 目录

```
probe-gate/
  server/classify.mjs   爬虫 / 机房 IP 判定
  server/track.mjs      记日志、统计
  server/index.mjs      HTTP 接口
  public/probe.js       给目标站嵌入的脚本（含弹窗）
  public/admin.html     刷量检测后台
  docker-compose.yml
```

接口：

- `POST /api/probe` 判定是否弹窗  
- `POST /api/track` 关闭弹窗 / 点击等事件  
- `POST /api/admin/login`（账号+密码）  
- `POST /api/admin/account`（改账号/密码）  
- `GET /api/admin/me`  
- `GET /api/admin/track`

## 自学习（越用越准）

系统会把假量的 IP / UA / 设备指纹记入记忆；同一指纹或 IP 多次假量后自动拉黑。

后台明细每行可点 **假量** / **真人** 纠错：
- 标假量：立即拉黑，下次同类直接判定「智能学习」
- 标真人：豁免，避免误伤（不覆盖爬虫等硬规则）

记忆保存在 Docker 卷 `/data/learn/memory.json`。
