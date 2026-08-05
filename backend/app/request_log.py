"""ASGI request logging — start/finish lines help diagnose hung handlers."""

from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger("repka.request")


class RequestLoggingMiddleware:
    """Logs every HTTP request enter/exit with duration and status.

    Pure ASGI (not BaseHTTPMiddleware) to avoid known Starlette hang issues.
    If you see ``→ GET /tasks`` without a matching ``←``, the handler is stuck.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "?")
        path = scope.get("path", "?")
        client = scope.get("client")
        client_host = client[0] if client else "-"
        start = time.perf_counter()
        status_code = 0

        logger.info("→ %s %s from %s", method, path, client_host)

        async def send_wrapper(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = int(message.get("status", 0))
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.exception(
                "← %s %s ERROR after %.1fms", method, path, elapsed_ms
            )
            raise
        else:
            elapsed_ms = (time.perf_counter() - start) * 1000
            logger.info(
                "← %s %s -> %s (%.1fms)",
                method,
                path,
                status_code or "?",
                elapsed_ms,
            )


