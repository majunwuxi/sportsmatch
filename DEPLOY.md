# 独立部署到 amstd（不影响现有 Napoli 任务）

Match Monitor 已独立部署在 `sportsmatch-web.service`，并与旧服务隔离。所有后续更新只操作新服务；绝不停止、覆盖或重启 `napoli-monitor.service`。

## 安全要求

- 仓库当前可能是公开的。严禁上传 `.env`、API Key、Telegram Bot Token 和真实投注记录。
- 管理站点只允许通过 HTTPS + 强密码访问。先仅绑定服务器本地 `127.0.0.1:8765`，可使用 SSH 隧道测试，暂时不要开放公网。
- 首版将 API 轮询与 Web 进程放在一起，必须只运行 **一个** Uvicorn worker，且只能部署一套启用了 `ENABLE_POLLER=true` 的实例。
- 启用后台轮询前先核算 API-Football 的免费额度；原来的单场脚本也使用同一个 Key 时，两套请求都计入免费额度。
- 首版后台仍是 MVP，请自行在隔离环境测试再投入常态使用。

## 安装

```bash
sudo apt-get update
sudo apt-get install -y python3-venv git
sudo mkdir -p /opt/sportsmatch
sudo git clone https://github.com/majunwuxi/sportsmatch.git /opt/sportsmatch
cd /opt/sportsmatch
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
nano .env
```

设置新的强密码、API-Football Key、Telegram Token/Chat ID；如需 NBA 监测，再设置 BallDontLie API Key。初期将 `ENABLE_POLLER=false`，仅验证页面。不要把密钥放入 Git。

## systemd（仅新建 sportsmatch-web，不覆盖原服务）

```ini
[Unit]
Description=SportsMatch dashboard
After=network-online.target
Wants=network-online.target

[Service]
User=root
WorkingDirectory=/opt/sportsmatch
EnvironmentFile=/opt/sportsmatch/.env
ExecStart=/opt/sportsmatch/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8765 --workers 1
Restart=on-failure
RestartSec=15
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

将上述内容保存为 `/etc/systemd/system/sportsmatch-web.service` 后：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now sportsmatch-web
sudo systemctl status sportsmatch-web --no-pager
```

在自己电脑使用 SSH 隧道（把服务器地址替换为真实值）：

```bash
ssh -L 8765:127.0.0.1:8765 root@YOUR_SERVER
```

随后在本机打开 http://127.0.0.1:8765，输入 .env 里的登录账号及密码。通过测试后再决定是否配置 Nginx/TLS 或 ChatGPT Sites 前端。

## 数据与限制

- SQLite 默认路径 `/opt/sportsmatch/data/matches.sqlite3`。
- NBA 搜索与比分监测使用 `BALLDONTLIE_API_KEY`；密钥只配置在后端 `/opt/sportsmatch/.env`。篮球任务目前仅采集比分和比赛状态，不支持竞彩足球投注结算或过关票。
- `BALLDONTLIE_MIN_INTERVAL_SECONDS` 默认是 `12.5` 秒，按官方免费档每分钟最多 5 次请求设置。多个监测任务会共用此限速，实际更新间隔可能长于单个任务设置的频率。
- 创建任务时将查询一次比赛进行校验；搜索同样消耗 API 配额。
- 查询频率不保证API实时刷新频率，比分是第三方数据，无法保障彩票奖金结算。
- 单场监测支持胜平负、让球胜平负、比分（31项）、总进球和半全场结果。过关票使用独立组合记录，可添加2–8场比赛腿，支持已实现的竞彩过关方式，按系统组合逐注结算。
- 过关票优先复用同一 fixture_id 的现有任务，不论其单场监测玩法；若无任务，仅创建一个不带投注的比分监测任务。共享比赛不会额外生成重复轮询。
- 取消、中止、判定赛果和弃权等无效状态必须人工核对官方票据后确认；确认后按剩余有效比赛腿重新计算，平台不会自动兑奖或判定退款。
- 终场状态后任务自动停止；取消和腰斩也会终止轮询并提醒。
- 当前新平台与原脚本是**两套完全独立的服务**。未来迁移需经测试确认，不能并行对同一比赛重复轮询。

## Sites proxy and current repair release

Use the new independent backend only; do not alter the legacy service. For direct use of the self-hosted UI, set `PUBLIC_ORIGIN=https://sportsmatch.sendmymail.top` in `/opt/sportsmatch/.env` (scheme and host only, no trailing slash). This must exactly match the browser address bar origin; otherwise state-changing requests such as creating a task return `Cross-origin write denied` (HTTP 403). Sites server proxy calls omit the browser Origin header and use Basic authentication over HTTPS, so this setting does not affect those requests. Keep the backend behind TLS and restrict network access where possible. Disable public debug logging and use strong ASCII service credentials.

Set Sites `BACKEND_URL`, `BACKEND_USER`, `BACKEND_PASSWORD` as runtime secrets, then deploy the saved Site version again. Never enter these into frontend code. Python dependencies for verification: `pip install pytest httpx`; run `python -m pytest -q` and `node --test site/worker/test.mjs`.

### 更新现有的独立后台

Match Monitor 的 Python 后台在 `/opt/sportsmatch`，与 Napoli 旧服务隔离。拉取新代码前先检查工作区；保留 `.env`、SQLite 数据库和其他本地改动。只重启新服务 `sportsmatch-web.service`：

```bash
cd /opt/sportsmatch
sudo git status --short
sudo git pull --ff-only origin main
sudo nano /opt/sportsmatch/.env
sudo systemctl restart sportsmatch-web.service
sudo systemctl is-active sportsmatch-web.service
curl --fail-with-body -sS --user matchmonitor https://sportsmatch.sendmymail.top/ocr-parser.js -o /dev/null -w 'OCR parser HTTP %{http_code}\n'
curl --fail-with-body -sS --user matchmonitor https://sportsmatch.sendmymail.top/ocr-ui.js -o /dev/null -w 'OCR UI HTTP %{http_code}\n'
curl --fail-with-body -sS --user matchmonitor https://sportsmatch.sendmymail.top/api/health
```

`curl` 会提示输入服务密码；不要把密码贴到聊天中。若需要启用篮球监测，在 `.env` 中填入真实 `BALLDONTLIE_API_KEY`（保留 `BALLDONTLIE_MIN_INTERVAL_SECONDS=12.5`），然后重启本服务；不要把密钥发到浏览器或提交到 Git。`/api/health` 返回 `basketball_monitoring: true` 后，页面才会启用 NBA 搜索。此次数据库迁移会增加 `sport`、`provider_game_id` 字段并为旧足球任务回填供应商 ID；不会删除任务或投注数据。NBA 赛程按北京时间筛选，任务轮询并通知比分、节次和终场；取消或中止的比赛标记为待人工确认，不自动结算。篮球任务不支持竞彩投注或过关票。任何情况下都不要停止、重启、覆盖或修改 `napoli-monitor.service`。

截图仅在浏览器本地处理，不会提交给 Sites Worker、FastAPI 或 API-Football。浏览器首次识别需联网下载固定版本的 Tesseract.js OCR 引擎和中文模型；CDN 不可用时可手动填写。用户需要逐项核对 OCR 给出的玩法、选项、SP，以及用于“其他”判定的完整精确比分 SP 清单。服务端自动迁移新增 SQLite 字段；完成拉取后只重启 `sportsmatch-web.service`。不要改动 `napoli-monitor.service`。

The backend was configured and the user confirmed the previous release is active with the poller enabled. Pull this release and restart only `sportsmatch-web.service` to serve the OCR assets and apply the task retention/order behavior. See TEST_REPORT.md for verification and remaining live checks.
