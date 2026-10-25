# Projects on 203.135.101.229

## Online CS（裸机 systemd，现网）

- 服务器路径: `/www/wwwroot/online-cs`
- 本仓库源码: `online-cs/`
- 控制台: https://cs.ojy0871.com/login/
- 访客聊天: `https://{子域}.ojy0871.com/c/{slug}/`
- API: `127.0.0.1:8088`（`online-cs-api.service`）

## fenliuqi / 线路台

- 服务器路径: `/www/wwwroot/fenliuqi`
- 本仓库: `fenliuqi/`
- 公网: https://fenliuqi.ojy0871.com
- 后台: https://fenliuqi.ojy0871.com/admin
- 服务: `fenliuqi-linegate.service` → `127.0.0.1:43127`
- 说明: 多域名线路入口（Next.js），不是在线客服

## traffic-guard 流量检测（Docker，现网主站）

- 服务器路径: `/www/wwwroot/traffic-guard`
- 本仓库源码: `traffic-guard/`
- 公网: https://llcj.mtekww.cn
- 后台: https://llcj.mtekww.cn/admin
- 检测容器: `traffic-guard` → `127.0.0.1:43128`（`server/check-front.mjs` 扛洪峰 + Next 二次监测）
- 后台容器: `traffic-guard-admin` → `127.0.0.1:43129`
- 数据卷: `/opt/server-slice/data/traffic-guard/`
- 嵌入: `<script async src="https://llcj.mtekww.cn/guard.js" data-account="账号编号"></script>`

## probe-gate 流量监测（Docker，与客服隔离）

- Path: `/www/wwwroot/probe-gate`
- Container: `probe-gate` → `127.0.0.1:18471`
- URL: https://probe.ojy0871.com
- Admin: https://probe.ojy0871.com/admin
- Embed: `<script src="https://probe.ojy0871.com/probe.js"></script>`

Source in this repo: `probe-gate/`
