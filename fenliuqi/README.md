# fenliuqi — 隔离版在线客服

与现网 `online-cs`（`cs.ojy0871.com`）完全隔离的一套客服实例，子域名：

**https://fenliuqi.ojy0871.com**

## 隔离边界

| | 现网 online-cs | fenliuqi |
|--|--|--|
| 路径 | `/www/wwwroot/online-cs` | `/www/wwwroot/fenliuqi` |
| API | `127.0.0.1:8088` / `online-cs-api` | `127.0.0.1:19088` / `fenliuqi-api` |
| Postgres | DB `online_cs` | DB `fenliuqi_cs` |
| Redis | DB index `0` | DB index `2` |
| 上传目录 | `online-cs/data/uploads` | `fenliuqi/data/uploads` |
| 公网 | https://cs.ojy0871.com | https://fenliuqi.ojy0871.com |
| Python 依赖 | 自有 `.venv` | 符号链接到 online-cs `.venv`（仅依赖，不共享数据） |

互不影响：改 fenliuqi 不会动现网库、现网 Redis key、现网上传文件。

## 入口

- 控制台登录：https://fenliuqi.ojy0871.com/login/
- 访客聊天：`https://fenliuqi.ojy0871.com/c/{slug}/?a={agent}`
- Nginx：`deploy/fenliuqi.conf` → 服务器 `/www/server/panel/vhost/nginx/fenliuqi.conf`
- systemd：`deploy/fenliuqi-api.service`

首次启动会写入演示账号（与源码 seed 一致），例如：

- 集团管理员：`platform@ocs.local` / `Aa889988`
- 公司管理员：`admin@ocs.local` / `admin123`

登录页有滑动验证，请在浏览器打开。

## 运维

```bash
systemctl status fenliuqi-api
systemctl restart fenliuqi-api
journalctl -u fenliuqi-api -n 100 --no-pager
curl -fsS http://127.0.0.1:19088/v1/health
# 现网应仍为 online-cs
curl -fsS http://127.0.0.1:8088/v1/health
```

从现网同步代码（不覆盖 `.env` / `data`）：

```bash
rsync -a --exclude '.env' --exclude 'data/' --exclude '.venv/' \
  /www/wwwroot/online-cs/ /www/wwwroot/fenliuqi/
systemctl restart fenliuqi-api
```

## DNS / SSL

`fenliuqi.ojy0871.com` 走已有通配符 `*.ojy0871.com` → `203.135.101.229`，证书复用 `cs.ojy0871.com` 通配符证书。
