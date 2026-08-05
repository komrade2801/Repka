from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import get_settings

settings = get_settings()

_is_sqlite = settings.database_url.startswith("sqlite")

# NullPool: no held connections across uvicorn --reload worker swaps (Windows).
# timeout: fail busy SQLite locks instead of hanging forever when two workers overlap.
_connect_args: dict = {}
if _is_sqlite:
    _connect_args = {
        "check_same_thread": False,
        "timeout": 15,
    }

_engine_kwargs: dict = {
    "connect_args": _connect_args,
}
if _is_sqlite:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True

engine = create_engine(settings.database_url, **_engine_kwargs)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_on_connect(dbapi_connection, _connection_record) -> None:  # noqa: ANN001
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=15000")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and apply lightweight SQLite migrations."""
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_columns()


def dispose_engine() -> None:
    """Release all pooled / checked-out connections (safe with NullPool too)."""
    engine.dispose()


def ensure_sqlite_columns() -> None:
    """Add columns introduced after initial MVP create_all (SQLite only)."""
    if not _is_sqlite:
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
