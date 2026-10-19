# probe-gate 部署说明（与在线客服隔离）

| | 在线客服 | 流量监测 probe-gate |
|--|---------|---------------------|
| 路径 | `/www/wwwroot/online-cs` | `/www/wwwroot/probe-gate` |
| 运行方式 | 裸机 systemd | Docker 容器 `probe-gate` |
| 端口 | API `127.0.0.1:8088` | `127.0.0.1:18471` |
| 域名 | `cs.ojy0871.com` | `probe.ojy0871.com` |
| 数据 | Postgres/Redis 宿主机 | Docker volume `probe-gate_probe_data` |

后台: https://probe.ojy0871.com/admin
嵌入: `<script src="https://probe.ojy0871.com/probe.js"></script>`

```bash
cd /www/wwwroot/probe-gate
docker compose ps
docker compose logs -f --tail=100
docker compose restart
```
