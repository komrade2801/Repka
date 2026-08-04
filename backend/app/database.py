from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_sqlite_columns() -> None:
    """Add columns introduced after initial MVP create_all (SQLite only)."""
    if not settings.database_url.startswith("sqlite"):
        return

    with engine.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(tasks)")).fetchall()
        if not rows:
            return
        existing = {row[1] for row in rows}
        if "priority" not in existing:
            conn.execute(
                text(
                    "ALTER TABLE tasks ADD COLUMN priority VARCHAR(32) "
                    "NOT NULL DEFAULT 'Средний'"
                )
            )

        # Migrate legacy English priority labels → Russian canonical values.
        for old, new in (
            ("Low", "Низкий"),
            ("Medium", "Средний"),
            ("High", "Высокий"),
            ("Critical", "Критический"),
            ("Optional", "Опционально"),
        ):
            conn.execute(
                text("UPDATE tasks SET priority = :new WHERE priority = :old"),
                {"old": old, "new": new},
            )
