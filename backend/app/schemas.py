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


def _empty_str_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class TaskBase(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    assignee: str | None = Field(default=None, max_length=60)
    start_date: date
    duration: int = Field(..., ge=1, le=3650)
    predecessors: str | None = Field(default=None, max_length=255)
    priority: TaskPriorityLiteral = "Средний"

    @field_validator("priority", mode="before")
    @classmethod
    def _normalize_priority(
        cls, value: str | int | float | None
    ) -> TaskPriorityLiteral:
        return normalize_priority(value)

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("description", "assignee", "predecessors", mode="before")
    @classmethod
    def _blank_optional(cls, value: object) -> object:
        if isinstance(value, str):
            return _empty_str_to_none(value)
        return value


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    """Partial update — all fields optional."""

    title: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=500)
    assignee: str | None = Field(default=None, max_length=60)
    start_date: date | None = None
    duration: int | None = Field(default=None, ge=1, le=3650)
    predecessors: str | None = Field(default=None, max_length=255)
    priority: TaskPriorityLiteral | None = None

    @field_validator("priority", mode="before")
    @classmethod
    def _normalize_priority(
        cls, value: str | int | float | None
    ) -> TaskPriorityLiteral | None:
        if value is None:
            return None
        return normalize_priority(value)

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, value: object) -> object:
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("description", "assignee", "predecessors", mode="before")
    @classmethod
    def _blank_optional(cls, value: object) -> object:
        if isinstance(value, str):
            return _empty_str_to_none(value)
        return value


class TaskImportRequest(BaseModel):
    tasks: list[TaskCreate] = Field(..., min_length=1, max_length=5000)


class TaskImportSkipped(BaseModel):
    title: str
    reason: str


class TaskImportResult(BaseModel):
    created: list["TaskRead"]
    skipped: list[TaskImportSkipped]


class TaskRead(TaskBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)
    history: list[ChatHistoryMessage] = Field(default_factory=list, max_length=50)


class ChatResponse(BaseModel):
    reply: str
    tools_used: list[str] = Field(default_factory=list)


# Resolve forward ref for TaskImportResult.created
TaskImportResult.model_rebuild()
