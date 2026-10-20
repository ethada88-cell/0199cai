# 线路台（fenliuqi）

一个带后台的多域名入口。后台负责添加、上传和删除域名；访问页按站点代号和令牌取出线路，探测后跳到当前可用的地址。

域名存在本机的 `data/store.json`，不需要单独的数据库。

- 公网：https://fenliuqi.ojy0871.com
- 后台：https://fenliuqi.ojy0871.com/admin
- 服务器目录：`/www/wwwroot/fenliuqi`
- systemd：`fenliuqi-linegate.service`（端口 `43127`）

本目录不是在线客服系统。

## 本地运行

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:43127](http://127.0.0.1:43127)（或默认 3000）。

首次启动会写入一个演示站点：

- 站点代号 `demo`
- 令牌 `demo-token`
- 后台账号 `admin`
- 后台密码 `admin123@`

部署前把账号、密码和会话密钥写进环境变量，可参考 `.env.example`：

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=admin123@
SESSION_SECRET=一段足够长的随机字符串
```

## 怎么用

1. 打开 `/admin`，用账号密码登录。
2. 创建站点，记下站点代号和令牌。
3. 单条添加域名，或粘贴多行，或上传 txt。一行一个网址，名称可以写在竖线后面：

   ```text
   https://a.example | 主线路
   https://b.example | 备用线路
   ```

4. 后台点「复制跳转链接」发给访问者。地址形如 `/jump?siteCode=demo&token=demo-token`（与常见 Vue 跳转页相同）。
5. 浏览器会拉取 `/dc/{siteCode}-{token}.txt`（AES-128-CBC 密文），解密后对各域名 `POST /melody/api/v1/base/heartbeat`，`Promise.any` 跳到第一个可用节点。选线页加 `optional=1`。
6. 通配根域写成 `*.0199x.app`（存成 `https://*.0199x.app/`）。每次打开会生成新的随机子域（如 `a1b2c3d4e5.0199x.app`），**不会**使用主域或 `www`。需先在 DNS 做好 `*.根域` 解析。

域名密文密钥见 `JUMP_AES_KEY` / `JUMP_AES_IV`（及同名 `NEXT_PUBLIC_`）。只接受 `http`/`https`，内网地址不能写入。

## 下载源码

页面上的「下载源码」会拿到 `linegate-source.zip`。压缩包里是完整源码，不含 `node_modules`。

## 上传到服务器后安装

服务器需要 Node.js 20 或更新版本。把压缩包上传到服务器后执行：

```bash
unzip linegate-source.zip -d linegate
cd linegate
cp .env.example .env
npm install
npm run build
npm start
```

启动前编辑 `.env`：

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=admin123@
SESSION_SECRET=一段足够长的随机字符串
CONFIG_SECRET=另一段足够长的随机字符串
```

程序默认监听 3000 端口。要换端口：

```bash
PORT=8080 npm start
```

用 Nginx 或其他反向代理把你的域名转到这个端口。域名数据写在服务器上的 `data/store.json`，升级代码时保留这个文件。
