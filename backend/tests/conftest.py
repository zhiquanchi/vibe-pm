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
