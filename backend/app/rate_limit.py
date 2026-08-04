"""Simple in-memory rate limiting for mutate endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window limiter by client IP.

    Stricter limits for write/chat routes; GET /tasks and /health are exempt.
    """

    def __init__(
        self,
        app,
        *,
        mutate_limit: int = 60,
        mutate_window_s: float = 60.0,
        chat_limit: int = 20,
        chat_window_s: float = 60.0,
    ) -> None:
        super().__init__(app)
        self.mutate_limit = mutate_limit
        self.mutate_window_s = mutate_window_s
        self.chat_limit = chat_limit
        self.chat_window_s = chat_window_s
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def _client_key(self, request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        if request.client:
            return request.client.host
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

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        path = request.url.path
        method = request.method.upper()

        if method == "GET" or path in {"/health", "/docs", "/openapi.json", "/redoc"}:
            return await call_next(request)

        client = self._client_key(request)
        if path == "/chat" and method == "POST":
            if not self._allow(f"chat:{client}", self.chat_limit, self.chat_window_s):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many chat requests. Try again later."},
                )
        elif path.startswith("/tasks") and method in {"POST", "PATCH", "DELETE", "PUT"}:
            if not self._allow(
                f"mutate:{client}", self.mutate_limit, self.mutate_window_s
            ):
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Too many write requests. Try again later."},
                )

        return await call_next(request)
