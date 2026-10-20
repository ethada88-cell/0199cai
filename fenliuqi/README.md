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
- 后台口令 `linegate-admin`

部署前把口令和会话密钥写进环境变量，可参考 `.env.example`：

```bash
ADMIN_PASSWORD=你的口令
SESSION_SECRET=一段足够长的随机字符串
```

## 怎么用

1. 打开 `/admin`，用口令登录。
2. 创建站点，记下站点代号和令牌。
3. 单条添加域名，或粘贴多行，或上传 txt。一行一个网址，名称可以写在竖线后面：

   ```text
   https://a.example | 主线路
   https://b.example | 备用线路
   ```

4. 复制自动跳转链接发给访问者。地址形如 `/go?siteCode=demo&token=demo-token`。
5. 要让访问者自己选线路，使用带 `optional=1` 的链接。

探测从运行这个程序的机器发出。目标站如果拒绝这台机器的访问，会被标成不可用，即使手机浏览器可以打开。只接受 `http` 和 `https`，内网地址和本机地址不能写入。

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

启动前编辑 `.env`，至少改掉这两项：

```bash
ADMIN_PASSWORD=你的口令
SESSION_SECRET=一段足够长的随机字符串
```

程序默认监听 3000 端口。要换端口：

```bash
PORT=8080 npm start
```

用 Nginx 或其他反向代理把你的域名转到这个端口。域名数据写在服务器上的 `data/store.json`，升级代码时保留这个文件。
