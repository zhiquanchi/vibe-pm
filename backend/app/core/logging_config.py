"""Loguru-based JSON file logging for the Vibe PM backend.

All application business code and application events use::

    from loguru import logger
    logger.info(...)
    logger.warning(...)
    logger.error(...)
    logger.exception(...)

``setup_logging()`` installs a single loguru sink that writes one flat JSON
object per line to ``source/backend.log`` (under ``VIBE_PM_LOG_DIR``), plus a
stderr sink for local development. The JSON line shape intentionally mirrors
the other services on this host (``bff/``, ``archive-service/``) so the local
Vector agent (``/etc/vector/vector.yaml``) can ``parse_json`` the same fields:

    {"time": "ISO-8601", "level": "INFO", "correlation_id": "",
     "message": "...", "module": "...", "function": "...", "line": 1,
     "thread_id": 123}

``correlation_id`` is emitted as an empty string by default to stay compatible
with the existing Vector parser (which expects the key to exist). A business
module that wants to attach a correlation id should bind it via
``logger.bind(correlation_id=...)``; the format function reads it back from the
record's ``extra``.

Note on loguru's ``format`` callable: in this loguru build a ``format``
function is treated as a *dynamic template* — its return value is passed
through ``str.format_map``. We therefore return a template whose literal JSON
braces are doubled (``{{`` / ``}}``) while the interpolated fields use single
``{...}`` tokens. Computed values (UTC ISO time, JSON-escaped message,
correlation id) are stashed on ``record["extra"]`` so they are substituted
verbatim and remain safe even when a message itself contains braces or quotes.

Uvicorn's own (stdlib ``logging``) records are bridged into loguru via
``LoguruHandler`` (see ``logging_config.json``), so the framework's access/error
logs are also emitted once, through loguru, into both the file and stderr —
there is no second writer on ``source/backend.log``.
"""

from __future__ import annotations

import inspect
import json
import logging
import os
import sys
import traceback
from datetime import datetime, timezone

from loguru import logger

_CONFIGURED = False


def default_log_dir() -> str:
    """Directory under which ``source/backend.log`` is written."""
    return os.getenv("VIBE_PM_LOG_DIR", "/var/log/vibe-pm")


def _log_path(log_dir: str) -> str:
    return os.path.join(log_dir, "source", "backend.log")


def _iso_utc(record_time: datetime) -> str:
    if record_time.tzinfo is not None:
        record_time = record_time.astimezone(timezone.utc)
    else:
        record_time = record_time.replace(tzinfo=timezone.utc)
    return record_time.isoformat()


def _json_format(record: dict) -> str:
    """Build a loguru dynamic-format template for one flat JSON line.

    The returned string is passed through ``str.format_map`` by loguru, so all
    literal JSON braces are doubled. Computed values are stashed on
    ``record["extra"]`` and substituted verbatim (braces/quotes-safe).
    """
    extra = record["extra"]

    # Default correlation id is an empty string for Vector compatibility.
    correlation_id = extra.get("correlation_id", "")

    # UTC ISO-8601 timestamp.
    extra["_loguru_time"] = _iso_utc(record["time"])

    # JSON-escaped message; append the traceback when one is attached.
    message = record["message"]
    if record["exception"]:
        message = message + "\n" + "".join(traceback.format_exception(*record["exception"]))
    extra["_loguru_msg"] = json.dumps(message, ensure_ascii=False)

    extra["_loguru_cid"] = correlation_id

    return (
        '{{"time": "{extra[_loguru_time]}", '
        '"level": "{level}", '
        '"correlation_id": "{extra[_loguru_cid]}", '
        '"message": {extra[_loguru_msg]}, '
        '"module": "{module}", '
        '"function": "{function}", '
        '"line": {line}, '
        '"thread_id": {thread.id}}}\n'
    )


class LoguruHandler(logging.Handler):
    """Bridge stdlib ``logging`` records (e.g. uvicorn) into loguru.

    Used by ``logging_config.json`` so that uvicorn's access/error logs are
    routed through loguru's sinks (file + stderr) instead of writing the file
    directly — avoiding a second writer on ``source/backend.log``.

    The emitted JSON keeps the *original* caller's ``module``/``function``/
    ``line`` (e.g. ``uvicorn.server``) rather than this bridge's location, by
    skipping loguru/logging/this-module frames when resolving the record site.
    """

    def emit(self, record: logging.LogRecord) -> None:
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        depth = 0
        frame = inspect.currentframe()
        try:
            while frame is not None:
                name = frame.f_globals.get("__name__", "")
                filename = frame.f_code.co_filename
                if (
                    name.startswith("loguru")
                    or name == "logging"
                    or name.startswith("logging.")
                    or filename.endswith("logging_config.py")
                ):
                    depth += 1
                    frame = frame.f_back
                else:
                    break
        finally:
            del frame
        # +1 accounts for logger.opt()'s own frame.
        logger.opt(depth=depth + 1, exception=record.exc_info).log(
            level, record.getMessage()
        )


def setup_logging(log_dir: str | None = None) -> None:
    """Configure loguru: one JSON file sink + one stderr sink.

    Idempotent so it is safe under ``uvicorn --reload`` and repeated imports.
    Uvicorn's stdlib loggers are bridged into loguru via ``LoguruHandler``
    (installed by ``logging_config.json`` when uvicorn is launched with
    ``--log-config logging_config.json``), so framework logs also flow through
    these sinks and are written exactly once.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    log_dir = log_dir or default_log_dir()
    os.makedirs(os.path.join(log_dir, "source"), exist_ok=True)
    log_file = _log_path(log_dir)

    # Drop loguru's default stderr handler; we install our own explicit sinks.
    logger.remove()

    # File sink: flat JSON one object per line, INFO+, size-based rotation.
    logger.add(
        log_file,
        format=_json_format,
        level="INFO",
        rotation="10 MB",
        retention=5,
        encoding="utf-8",
        enqueue=True,
    )

    # Console sink: human-readable, stderr, INFO+ (handy for local dev).
    logger.add(
        sys.stderr,
        level="INFO",
        format=(
            "<level>{level: <8}</level> "
            "{time:YYYY-MM-DD HH:mm:ss.SSS} "
            "{module}:{function}:{line} {message}{exception}"
        ),
    )

    _CONFIGURED = True
