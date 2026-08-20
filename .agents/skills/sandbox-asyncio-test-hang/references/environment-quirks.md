# 受限环境的只读路径与依赖问题

## uv 缓存目录只读

症状：

```text
error: Could not acquire lock
  Caused by: Could not create temporary file
  Caused by: Read-only file system (os error 30) at path "/root/.cache/uv/.tmp..."
```

或 `uv add` 报 DNS/网络错误但实际是缓存/锁问题（排查顺序：先看 cache 目录，再看网络）。

修复：把缓存指到可写目录，例如：

```bash
export UV_CACHE_DIR=/tmp/uv-cache
uv add --dev httpx2
```

## 应用日志目录只读导致 pytest 收集失败

症状：pytest 收集阶段直接报错，任何用例都没跑：

```text
E   OSError: [Errno 30] Read-only file system: '/var/log/<app>/source/backend.log'
app/core/logging_config.py:171: in setup_logging
    logger.add(...
```

原因：应用模块 import 时就执行 `setup_logging()`，loguru `FileSink` 立刻打开日志文件。

修复：找到日志目录的环境变量（`grep -n "LOG_DIR\|/var/log" app/core/logging_config.py`），指向 `/tmp`：

```bash
export VIBE_PM_LOG_DIR=/tmp/vibe-pm-logs
pytest -q
```

## 沙箱内网络/依赖安装

- 部分沙箱 DNS 被禁：`uv add` 报 `dns error` / `Temporary failure in name resolution`。确认缓存与锁问题排除后，若仍需要联网安装，用非沙箱（提权）方式执行。
- 安装后建议确认版本符合预期（例如 Starlette 1.6 需要 `httpx2`；`httpx` 0.28 只触发 deprecation warning，不是挂起根因）。

## 沙箱判定清单（一次跑完）

```bash
# 1) 跨线程 asyncio 唤醒是否生效（挂起 = 环境问题）
timeout 20 python -c "import anyio.from_thread; with anyio.from_thread.start_blocking_portal() as p: p.call(lambda: 1); print('portal ok')"
# 2) AF_UNIX socketpair send 是否被 seccomp 拦截（EPERM = 需要 shim）
python -c "import socket; a,b=socket.socketpair(); b.send(b'x'); print('socketpair ok')"
# 3) uv 缓存是否只读
ls -ld /root/.cache/uv
# 4) 应用日志目录是否只读
grep -rn "/var/log" app/core/ 2>/dev/null | head
```
