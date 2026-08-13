---
name: vibe-pm-start
description: Start/run the vibe-pm project locally (backend FastAPI + frontend Vite dev servers). Use when the user wants to launch the local dev environment, says "启动 vibe-pm", "run the dev servers", "启动前后端", or "本地运行 vibe-pm". Handles the process-detachment, Node-path, and port-conflict pitfalls that otherwise leave services dead or failing to bind.
---

# 本地启动 vibe-pm 前后端服务

在 `/root/vibe-pm` 本地拉起后端（FastAPI + uvicorn）与前端（Vite + React）开发服务。
本 skill 的核心价值是**踩坑要点**——忽略它们会导致服务"起来了又被杀"或端口冲突起不来。

## 项目结构

- **后端** `/root/vibe-pm/backend`：Python + uv 管理（FastAPI + uvicorn + SQLAlchemy + SQLite）。
  - 主入口 `app/main.py`，应用对象 `app.main:app`。
  - 日志用 loguru 写到 `/var/log/vibe-pm/source/backend.log`（受环境变量 `VIBE_PM_LOG_DIR` 控制）。
- **前端** `/root/vibe-pm/frontend`：Vite + React + TypeScript，默认端口 5173。

## 启动前检查

先确认端口占用情况，避免监管进程抢占端口导致自己的实例起不来：

```bash
ss -ltnp | grep -E ':8000|:5173'
```

- 如果 5173 已被一个**仅绑 localhost** 的 vite 进程占着（通常是进程监管 / Relay 自动以 `npm run dev` 拉起的 localhost 实例），**必须先结束那条监管链**，否则自己 `--host 0.0.0.0` 的实例会因端口冲突失败。结束后再重启自己的 setsid 实例。
- 8000 若被旧 uvicorn 占着，先 `pkill -f uvicorn` 清理。

## 启动命令（务必用 setsid + bash -c）

### 后端

```bash
cd /root/vibe-pm/backend && setsid bash -c 'uv run uvicorn app.main:app --log-config logging_config.json --reload --host 0.0.0.0 --port 8000 > /var/log/vibe-pm/backend.stdout.log 2>&1 &'
```

### 前端

```bash
setsid bash -c 'export PATH=/root/.local/share/fnm/node-versions/v24.18.0/installation/bin:$PATH; cd /root/vibe-pm/frontend && npm run dev -- --host 0.0.0.0 > /var/log/vibe-pm/frontend.stdout.log 2>&1 &'
```

## 关键踩坑（务必遵守，否则服务会被杀或不起来）

1. **必须用 `setsid` 让进程脱离 agent 进程树**：直接后台子进程启动后，服务会随 agent 退出被信号杀掉（"起来了又被杀"）。启动命令统一用 `setsid bash -c '... &'` 形式，并把 stdout/stderr 重定向到日志（建议 `/var/log/vibe-pm/backend.stdout.log`、`/var/log/vibe-pm/frontend.stdout.log`）。

2. **真实 Node 路径陷阱**：本机 `/usr/local/bin/node` 是指向 `bun` 的符号链接，真实 Node 在 fnm 的 `v24.18.0`，路径形如 `/root/.local/share/fnm/node-versions/v24.18.0/installation/bin`。前端命令需把该路径前置到 `PATH`：`export PATH=/root/.local/share/fnm/node-versions/v24.18.0/installation/bin:$PATH`。

3. **fish 的 fnm 钩子会破坏 PATH**：用 `bash -c` 包裹前端启动命令以隔离 shell 环境（不要直接用当前 fish shell 执行 `npm run dev`）。

4. **监管进程占用端口**：存在一个进程监管（Relay）会自动以 localhost 模式重启 `npm run dev`，仅绑 localhost 且占用 5173，导致自己的 `--host 0.0.0.0` 实例因端口冲突起不来。启动前按上文 `ss -ltnp | grep -E ':8000|:5173'` 检查，若 5173 被 localhost 的 vite 占着，先结束那条监管链再启动自己的 setsid 实例。

## 验证步骤

```bash
# 1. 确认两端口处于 LISTEN
ss -ltnp | grep -E ':8000|:5173'

# 2. 后端 Swagger 可达
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/docs   # 期望 200

# 3. 前端可达
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/        # 期望 200
```

访问地址：
- 前端：http://localhost:5173/
- 后端 Swagger：http://localhost:8000/docs

## 停止方法

```bash
pkill -f uvicorn   # 停止后端
pkill -f vite      # 停止前端
```

（也可按启动命令记录的 PID 直接 `kill <pid>`。）

## 排错

| 现象 | 原因 | 处理 |
|------|------|------|
| 服务启动后立即消失 | 未用 `setsid`，进程挂在 agent 树被信号杀 | 改用 `setsid bash -c '... &'` |
| 前端报 `node` / `npm` 异常或跑了 bun | `/usr/local/bin/node` 是 bun 符号链接，PATH 指向了错误 node | 前端命令前置 fnm node 路径：`export PATH=/root/.local/share/fnm/node-versions/v24.18.0/installation/bin:$PATH` |
| 前端 5173 起不来 | 监管进程已以 localhost 占着 5173 | `ss` 找到监管链并结束，再启动自己的 setsid 实例 |
| 前端用了 bun 的 npm 行为异常 | fish 的 fnm 钩子污染 PATH | 用 `bash -c` 包裹隔离环境 |
