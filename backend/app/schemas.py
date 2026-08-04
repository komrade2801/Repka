from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

TaskPriorityLiteral = Literal[
    "Критический",
    "Высокий",
    "Средний",
    "Низкий",
    "Опционально",
]

_CANONICAL_PRIORITIES: dict[str, TaskPriorityLiteral] = {
    "Критический": "Критический",
    "Высокий": "Высокий",
    "Средний": "Средний",
    "Низкий": "Низкий",
    "Опционально": "Опционально",
}

_PRIORITY_ALIASES: dict[str, TaskPriorityLiteral] = {
    "критический": "Критический",
    "крит": "Критический",
    "critical": "Критический",
    "blocker": "Критический",
    "urgent": "Критический",
    "высокий": "Высокий",
    "high": "Высокий",
    "средний": "Средний",
    "medium": "Средний",
    "normal": "Средний",
    "низкий": "Низкий",
    "low": "Низкий",
    "опционально": "Опционально",
    "optional": "Опционально",
}


def normalize_priority(value: str | int | float | None) -> TaskPriorityLiteral:
    if value is None:
        return "Средний"
    raw = str(value).strip()
    if not raw:
        return "Средний"
    return (
        _CANONICAL_PRIORITIES.get(raw)
        or _PRIORITY_ALIASES.get(raw.lower())
        or "Средний"
    )


class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    assignee: str | None = None
    start_date: date
    duration: int = Field(..., ge=1)
    predecessors: str | None = None
    priority: TaskPriorityLiteral = "Средний"

    @field_validator("priority", mode="before")
    @classmethod
    def _normalize_priority(
        cls, value: str | int | float | None
    ) -> TaskPriorityLiteral:
        return normalize_priority(value)


class TaskCreate(TaskBase):
    pass


class TaskBulkCreate(BaseModel):
    tasks: list[TaskCreate] = Field(..., min_length=1)


class TaskRead(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    history: list[ChatHistoryMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    tools_used: list[str] = Field(default_factory=list)
