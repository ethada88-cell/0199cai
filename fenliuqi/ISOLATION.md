# fenliuqi — isolated Online CS (native)

| | Native online-cs | fenliuqi |
|--|--|--|
| Path | `/www/wwwroot/online-cs` | `/www/wwwroot/fenliuqi` |
| API | `127.0.0.1:8088` `online-cs-api` | `127.0.0.1:19088` `fenliuqi-api` |
| Postgres | DB `online_cs` | DB `fenliuqi_cs` |
| Redis | DB index `0` | DB index `2` |
| Uploads | `/www/wwwroot/online-cs/data/uploads` | `/www/wwwroot/fenliuqi/data/uploads` |
| Public | `https://cs.ojy0871.com` | `https://fenliuqi.ojy0871.com` |
| Python venv | own | symlink to online-cs `.venv` (deps only) |

Do not point fenliuqi traffic at the online-cs API port, and do not reuse `.env`.
