# ChatGPT Sites 部署评估

官方说明：https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites

ChatGPT Sites 支持创建、托管、发布交互式网站，需在支持的 ChatGPT Work/Codex 环境中创建和发布。

## 推荐分工

- ChatGPT Sites：以用户授权和访问设置为前提，承载响应式中文管理界面。
- amstd：独立 FastAPI 管理 API、SQLite 存储、定时监测进程、Telegram 通知。
- GitHub：源代码真相来源；Secrets 永不入库。

注意：**不能从拥有 GitHub 代码直接推出 Sites 已部署**。需在 ChatGPT Work 中实际创建、配置和发布，拿到正式 URL 后才算上线。

## 正式迁移前验证

1. Sites 是否能安全连接到现有受保护的后台接口，避免暴露 API Key；
2. 跨域、认证和会话机制；目前 MVP 使用 Basic Auth，仅适合受保护的自托管管理台；
3. 访问控制、Webhook 或轮询费用、服务端 Secrets、日志审计；
4. 后台定时任务是否具备可验证的长期持续执行能力。未确认前依旧交给 amstd。

本仓库并未发布任何 ChatGPT Site。
