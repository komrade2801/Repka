from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401 — register models with metadata
from app.config import get_settings
from app.database import Base, engine, ensure_sqlite_columns
from app.routers import chat, tasks

settings = get_settings()

Base.metadata.create_all(bind=engine)
ensure_sqlite_columns()

app = FastAPI(title="Repka API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasks.router)
app.include_router(chat.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
