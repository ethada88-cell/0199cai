# 流量检测 · 新服务器部署说明

本包用于在**另一台服务器**全新部署。当前已在跑的机器**不要动**；两边数据、账号互不相通，除非你主动拷贝 `data/accounts`。

## 环境要求

- Linux（推荐 Debian/Ubuntu）
- Docker + Docker Compose 插件
- 开放：本机 `43128`（仅 127.0.0.1）+ 对外 80/443（Nginx）
- 内存建议 ≥ 2GB（站点很多时建议 4GB+）

## 1. 上传并解压

把发布包传到新机器，例如：

```bash
mkdir -p /www/wwwroot/traffic-guard
tar xzf traffic-guard-deploy-*.tar.gz -C /www/wwwroot/traffic-guard
cd /www/wwwroot/traffic-guard
```

## 2. 配置环境变量

```bash
cp deploy/.env.example .env
nano .env   # 改 ADMIN_USER / ADMIN_PASSWORD / ADMIN_SESSION_SECRET
```

## 3. 准备数据目录

```bash
mkdir -p data/accounts data/sites data/clicks data/cache
# IP 库已打进镜像构建上下文（data/ip-ranges.json 等），一般不用再拷业务数据
```

**不要**从旧服务器复制 `.env` 到公网仓库。若只要「空系统」，不必拷 `data/accounts`。  
若要把旧站账号/统计迁过来，再单独打包旧机的 `data/accounts`、`data/clicks`、`data/cache`（体积可能很大）。

## 4. 构建并启动

```bash
docker compose build
docker compose up -d
docker compose ps
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:43128/login
# 期望 200
```

容器内端口 `43127`，主机映射见 `docker-compose.yml`：`127.0.0.1:43128:43127`。

## 5. 反代与 HTTPS

1. 把 `deploy/nginx.example.conf` 改成你的域名与证书路径  
2. 重载 Nginx  
3. 浏览器打开：`https://你的域名/admin`（或 `/login`）

## 6. 客户埋点

登录后台 → 账号页复制脚本，域名换成**新服务器域名**：

```html
<script async src="https://你的域名/guard.js" data-account="账号编号"></script>
```

旧服务器上的站点若仍指向旧域名，**继续走旧系统**，互不影响。

## 7. 常用运维

```bash
cd /www/wwwroot/traffic-guard
docker compose logs -f --tail=200
docker compose restart
docker compose pull   # 若改用镜像仓库时
# 更新代码后：
# tar 覆盖解压或 git pull 后
docker compose build && docker compose up -d
```

数据在宿主机 `./data/`，升级容器不会丢（已 volume 挂载）。

## 8. 与现网隔离说明

| 项目 | 现网服务器 | 新服务器 |
|------|------------|----------|
| 是否需停机 | **否，保持不变** | 独立部署 |
| 账号数据 | 各自 `data/accounts` | 默认空，自行开通 |
| 客户脚本域名 | 旧域名 | 新域名 |
| 端口 | 现有映射 | 可用同一套 compose |

## 故障排查

- `login` 非 200：看 `docker compose logs`，检查 `.env` 是否齐全  
- 构建慢：Dockerfile 已用 npmmirror / 阿里云 apt  
- 归属地空白：依赖 `ip2region-ts` 自带库或 `data/ip2region.xdb`（打包脚本会尽量带上）  
- 权限：确保 `data/*` 可被容器用户写入  
