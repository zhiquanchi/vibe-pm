# socketpair → os.pipe 测试 shim（完整代码）

放在 `tests/conftest.py`（在任意测试模块 import `fastapi.testclient` / `starlette` 之前生效）。

```python
"""Shared test bootstrap.

This container blocks ``socket.send`` on AF_UNIX socketpairs (seccomp
``EPERM``), which silently breaks asyncio's cross-thread wakeup
(``loop.call_soon_threadsafe`` -> self-pipe).  Starlette's ``TestClient``
relies on that wakeup (anyio blocking portal), so every request would
otherwise hang.  Backing the self-pipe with ``os.pipe`` instead of a
socketpair keeps the wakeup working; ``concurrent.futures.Future`` and the
selector layer are unaffected.
"""

from __future__ import annotations

import fcntl
import os
import socket


class _PipeSocket:
    """Minimal socket-like wrapper over an ``os.pipe`` file descriptor.

    asyncio's ``_UnixSelectorEventLoop`` only needs ``fileno``,
    ``setblocking``, ``send``, ``recv`` and ``close`` from its self-pipe.
    """

    def __init__(self, fd: int) -> None:
        self._fd = fd

    def fileno(self) -> int:
        return self._fd

    def setblocking(self, flag: bool) -> None:
        flags = fcntl.fcntl(self._fd, fcntl.F_GETFL)
        if flag:
            flags &= ~os.O_NONBLOCK
        else:
            flags |= os.O_NONBLOCK
        fcntl.fcntl(self._fd, fcntl.F_SETFL, flags)

    def send(self, data: bytes) -> int:
        return os.write(self._fd, data)

    def recv(self, size: int) -> bytes:
        return os.read(self._fd, size)

    def close(self) -> None:
        try:
            os.close(self._fd)
        except OSError:
            pass

    def __enter__(self) -> "_PipeSocket":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def _pipe_socketpair() -> tuple[_PipeSocket, _PipeSocket]:
    read_fd, write_fd = os.pipe()
    return _PipeSocket(read_fd), _PipeSocket(write_fd)


# Apply before any test module imports fastapi.testclient / starlette.
socket.socketpair = _pipe_socketpair  # type: ignore[assignment]
```

## 为什么有效

- asyncio 的 `_UnixSelectorEventLoop` 自管道只调用 `fileno / setblocking / send / recv / close`，用 `os.pipe` 的 fd 实现这几个接口即可。
- pipe 的写入走普通 fd 写路径，不经过被 seccomp 拦截的 AF_UNIX `send`。
- `os.write` / `os.read` 在非阻塞 fd 上语义与 socket 的 `send` / `recv` 足够接近，selector 层（epoll/select）照常工作。
- `concurrent.futures.Future`、anyio portal 不直接依赖 socket 语义，因此不受影响。

## 验证

替换后跑最小复现：

```bash
timeout 30 python -c "
import anyio.from_thread
with anyio.from_thread.start_blocking_portal() as p:
    print('portal ok', p.call(lambda: 42))
"
```

再跑真实套件确认完整结束（给出通过/失败统计），例如：

```bash
cd backend && .venv/bin/pytest -q
```
