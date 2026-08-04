from datetime import date
from enum import Enum

from sqlalchemy import Date, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class TaskPriority(str, Enum):
    CRITICAL = "Критический"
    HIGH = "Высокий"
    MEDIUM = "Средний"
    LOW = "Низкий"
    OPTIONAL = "Опционально"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    assignee: Mapped[str | None] = mapped_column(String(255), nullable=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)
    # Comma-separated predecessor task IDs, e.g. "1,2,3"
    predecessors: Mapped[str | None] = mapped_column(String(255), nullable=True)
    priority: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=TaskPriority.MEDIUM.value,
        server_default=TaskPriority.MEDIUM.value,
    )
