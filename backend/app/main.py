import atexit
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 — register models with metadata
from app.config import get_settings
from app.database import dispose_engine, init_db
from app.rate_limit import RateLimitMiddleware
from app.request_log import RequestLoggingMiddleware
from app.routers import chat, tasks

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    force=True,
)
logger = logging.getLogger("repka")

settings = get_settings()


def _force_dispose() -> None:
    """Belt-and-suspenders cleanup if the process is killed mid-lifespan."""
    try:
        dispose_engine()
    except Exception:  # noqa: BLE001 — best-effort on atexit/signal
        logger.exception("Failed to dispose DB engine during process exit")


atexit.register(_force_dispose)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Startup/shutdown: schema init and clean DB teardown for --reload."""
    init_db()
    logger.info(
        "Repka API ready pid=%s cors=%s db=%s",
        os.getpid(),
        settings.cors_origins,
        settings.database_url,
    )
    try:
        yield
    finally:
        logger.info("Repka API shutting down pid=%s — disposing DB engine", os.getpid())
        dispose_engine()
        logger.info("Repka API shutdown complete pid=%s", os.getpid())


app = FastAPI(title="Repka API", version="0.1.0", lifespan=lifespan)

# Last added = outermost. Order: log → CORS → rate-limit → routes.
app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestLoggingMiddleware)

app.include_router(tasks.router)
app.include_router(chat.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
