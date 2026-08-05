"""Simple in-memory rate limiting for mutate endpoints (pure ASGI)."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Any

from fastapi.responses import JSONResponse


class RateLimitMiddleware:
    """Sliding-window limiter by client IP.

    Stricter limits for write/chat routes; GET /tasks and /health are exempt.
    Implemented as pure ASGI middleware (not BaseHTTPMiddleware) to avoid
    Starlette request-hang deadlocks under concurrent load.
    """

    def __init__(
        self,
        app: Any,
        *,
        mutate_limit: int = 60,
        mutate_window_s: float = 60.0,
        chat_limit: int = 20,
        chat_window_s: float = 60.0,
    ) -> None:
        self.app = app
        self.mutate_limit = mutate_limit
        self.mutate_window_s = mutate_window_s
        self.chat_limit = chat_limit
        self.chat_window_s = chat_window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, scope: dict[str, Any]) -> str:
        headers = {
            k.decode("latin-1"): v.decode("latin-1")
            for k, v in scope.get("headers", [])
        }
        forwarded = headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        client = scope.get("client")
        if client:
            return str(client[0])
        return "unknown"

    def _allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        bucket = self._hits[key]
        while bucket and now - bucket[0] > window_s:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = str(scope.get("method", "")).upper()

        if method == "GET" or path in {"/health", "/docs", "/openapi.json", "/redoc"}:
            await self.app(scope, receive, send)
            return

        client = self._client_key(scope)
        blocked: JSONResponse | None = None

        if path == "/chat" and method == "POST":
            if not self._allow(f"chat:{client}", self.chat_limit, self.chat_window_s):
                blocked = JSONResponse(
                    status_code=429,
                    content={"detail": "Too many chat requests. Try again later."},
                )
        elif path.startswith("/tasks") and method in {"POST", "PATCH", "DELETE", "PUT"}:
            if not self._allow(
                f"mutate:{client}", self.mutate_limit, self.mutate_window_s
            ):
                blocked = JSONResponse(
                    status_code=429,
                    content={"detail": "Too many write requests. Try again later."},
                )

        if blocked is not None:
            await blocked(scope, receive, send)
            return

        await self.app(scope, receive, send)
