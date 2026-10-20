# 独立部署到 amstd（不影响现有 Napoli 任务）

目前代码已经提交 GitHub，但**尚未部署**。请勿在本场比赛完成前停止、覆盖或重启现有 `napoli-monitor.service`。

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

设置新的强密码、API Key、Telegram Token/Chat ID；初期将 `ENABLE_POLLER=false`，仅验证页面。不要把密钥放入 Git。

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
- 创建任务时将查询一次比赛进行校验；搜索同样消耗 API 配额。
- 查询频率不保证API实时刷新频率，比分是第三方数据，无法保障彩票奖金结算。
- 当前支持竞彩足球单场**比分**玩法选项集合；不处理串关、让球胜平负及退款。
- 当前支持一场比赛关联一组投注记录；同场多组投注需在后续增加组合层。
- 终场状态后任务自动停止；取消和腰斩也会终止轮询并提醒。
- 当前新平台与原脚本是**两套完全独立的服务**。未来迁移需经测试确认，不能并行对同一比赛重复轮询。

## Sites proxy and current repair release

Use the new independent backend only; do not alter the legacy service. Configure `PUBLIC_ORIGIN` to the self-hosted UI origin if using the backend UI directly. Sites server proxy calls have no browser Origin header and use Basic authentication over HTTPS. Keep the backend behind TLS and restrict network access where possible. Disable public debug logging and use strong ASCII service credentials.

Set Sites `BACKEND_URL`, `BACKEND_USER`, `BACKEND_PASSWORD` as runtime secrets, then deploy the saved Site version again. Never enter these into frontend code. Python dependencies for verification: `pip install pytest httpx`; run `python -m pytest -q` and `node --test site/worker/test.mjs`.

Production acceptance is pending until a new backend is independently installed and real provider/Telegram tests pass. See TEST_REPORT.md.
