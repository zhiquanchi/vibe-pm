---
name: sandbox-asyncio-test-hang
description: 修复受限容器/沙箱中 Python pytest 或 FastAPI TestClient 无输出挂起（asyncio 跨线程唤醒因 AF_UNIX socketpair send 被 seccomp 拦截而死锁），以及配套的只读缓存/日志目录问题。适用于 pytest 卡在第一个 TestClient 请求、anyio blocking portal 死锁、asyncio 跨线程 call_soon_threadsafe 不生效的场景。
---

# Sandbox Asyncio Test Hang

受限容器（seccomp 沙箱）里 Python 测试最常见的“假挂起”是环境问题，不是测试逻辑问题。先诊断再动手，不要把时间浪费在“测试写得慢”上。

## 症状

- `pytest` 收集完用例后卡在第一个 `TestClient` 请求，无任何输出，最终被外部 timeout 杀掉（`exit 130` / `exit -1`）。
- 最小复现也挂：`with TestClient(app) as c: c.get("/health")`，甚至裸 FastAPI app 都挂。
- `anyio.from_thread.start_blocking_portal()` 单独调用即挂起。

## 根因

seccomp 拦截了 AF_UNIX socketpair 的 `send`（EPERM）。asyncio 的跨线程唤醒（`loop.call_soon_threadsafe` → 自管道 socketpair 写入）因此静默失效：事件循环线程永远空转在 `select()`，主线程等待的 future 永不完成。Starlette `TestClient` 依赖 anyio blocking portal（线程 + 事件循环 + 跨线程唤醒），所以每个请求都死锁。

次要因素：Starlette 1.6+ 的 `TestClient` 优先使用 `httpx2`，只有 `httpx` 时会打 deprecation warning（不是挂起根因，但应补装）。

## 诊断（按顺序，快）

1. 确认是 portal 挂起：
   `timeout 20 python -c "import anyio.from_thread; with anyio.from_thread.start_blocking_portal() as p: p.call(lambda: 1)"`
2. 抓线程栈定位：`faulthandler.dump_traceback_later(8, exit=True)`。典型形态：主线程等在 `concurrent.futures.Future.result()`，portal 线程空转在 `selectors.select()` / `run_until_complete`。
3. 确认 socketpair send 被拦：
   `python -c "import socket; a,b=socket.socketpair(); b.send(b'x')"` → `PermissionError: [Errno 1] Operation not permitted`。
4. 对照：同线程 asyncio 计时器正常（`asyncio.run(asyncio.sleep(0.1))`），只有跨线程唤醒失效——这是判断“seccomp 自管道问题”而非其他死锁的关键。
5. 注意：严格沙箱里 `loop.add_reader`/`selectors.EpollSelector.register` 也可能 EPERM（`epoll_ctl` 被拦）；此时同一套 shim 仍可让 pipe 版本工作（pipe 的 fd 不走被拦的 socket 路径），若仍不行则用非沙箱方式跑测试交叉验证。

## 修复

1. **测试专用 shim**（首选，能让沙箱内测试直接跑通）：在 `tests/conftest.py` 里把 `socket.socketpair` 替换为 `os.pipe()` 封装的最小 socket 兼容对象（`fileno/setblocking/send/recv/close`）。完整可复制代码见 [references/socketpair-shim.md](references/socketpair-shim.md)。
2. **补装 httpx2**：Starlette 1.6+ 环境 `uv add --dev httpx2`（或用 `UV_CACHE_DIR=/tmp/uv-cache uv add --dev httpx2`，见下）。
3. **交叉验证**：如果 shim 后仍挂（更严格的沙箱），用非沙箱/提权方式运行 pytest 确认是环境限制，而不是测试逻辑问题。

## 配套环境问题

- `/root/.cache/uv` 只读 → `uv add`/`uv sync` 报 “Could not acquire lock / Read-only file system (os error 30)”，用 `UV_CACHE_DIR=/tmp/uv-cache` 绕过。
- 应用默认写 `/var/log/<app>/...` 只读 → pytest 收集阶段就 `OSError: [Errno 30] Read-only file system`（loguru FileSink 在建 sink 时打开文件），通过环境变量把日志目录指到 `/tmp`（如 `VIBE_PM_LOG_DIR=/tmp/vibe-pm-logs`）。各应用的环境变量名不同，先 `grep` 日志路径配置。

详见 [references/environment-quirks.md](references/environment-quirks.md)。

## 边界

- socketpair shim 只允许出现在测试代码（conftest）里，绝不进应用代码或生产路径。
- 不要盲目套 shim：先确认 AF_UNIX socketpair `send` 的 EPERM 是根因；若挂起另有原因（测试里真的调了外部服务、缺依赖、数据库锁等），按实际原因修。
- 沙箱内“测试挂起”优先怀疑环境，但修完必须跑一次真实用例确认恢复（例如套件能完整跑完并给出通过/失败统计）。
