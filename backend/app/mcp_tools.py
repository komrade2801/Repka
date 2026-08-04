"""MCP tools that mutate Gantt tasks in the database."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import date

from mcp.server.mcpserver import MCPServer
from sqlalchemy.orm import Session

from app.models import Task

mcp = MCPServer("Repka")

_db_session: ContextVar[Session | None] = ContextVar("repka_db_session", default=None)


def set_tool_db(db: Session):
    """Bind the current FastAPI DB session for in-process MCP tool calls."""
    return _db_session.set(db)


def reset_tool_db(token) -> None:
    _db_session.reset(token)


def _db() -> Session:
    db = _db_session.get()
    if db is None:
        raise RuntimeError("Database session is not bound for MCP tools")
    return db


def _get_task(task_id: int) -> Task:
    task = _db().get(Task, task_id)
    if task is None:
        raise ValueError(f"Task with id={task_id} not found")
    return task


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"Invalid date '{value}'. Use ISO format YYYY-MM-DD."
        ) from exc


def _parse_predecessors(raw: str | None) -> list[int]:
    if not raw or not raw.strip():
        return []
    ids: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        ids.append(int(part))
    return ids


def _format_predecessors(ids: list[int]) -> str | None:
    return ",".join(str(i) for i in ids) if ids else None


@mcp.tool()
def move_task(task_id: int, new_start_date: str) -> str:
    """Move a task to a new start date. Date must be ISO YYYY-MM-DD."""
    task = _get_task(task_id)
    parsed = _parse_date(new_start_date)
    old = task.start_date.isoformat()
    task.start_date = parsed
    _db().commit()
    _db().refresh(task)
    return (
        f"Moved task #{task.id} «{task.title}» "
        f"from {old} to {task.start_date.isoformat()}."
    )


@mcp.tool()
def assign_task(task_id: int, assignee: str) -> str:
    """Assign (or reassign) a task to a person by name."""
    task = _get_task(task_id)
    previous = task.assignee or "unassigned"
    task.assignee = assignee.strip() or None
    _db().commit()
    _db().refresh(task)
    return (
        f"Assigned task #{task.id} «{task.title}» "
        f"from «{previous}» to «{task.assignee}»."
    )


@mcp.tool()
def add_dependency(task_id: int, predecessor_id: int) -> str:
    """Add a finish-to-start predecessor dependency to a task."""
    if task_id == predecessor_id:
        raise ValueError("A task cannot depend on itself")

    task = _get_task(task_id)
    predecessor = _get_task(predecessor_id)

    deps = _parse_predecessors(task.predecessors)
    if predecessor_id in deps:
        return (
            f"Task #{task.id} «{task.title}» already depends on "
            f"#{predecessor.id} «{predecessor.title}»."
        )

    deps.append(predecessor_id)
    task.predecessors = _format_predecessors(deps)
    _db().commit()
    _db().refresh(task)
    return (
        f"Added dependency: task #{task.id} «{task.title}» now waits for "
        f"#{predecessor.id} «{predecessor.title}»."
    )


def format_tasks_for_prompt(tasks: list[Task]) -> str:
    if not tasks:
        return "The project currently has no tasks."

    lines = [
        "Current project tasks (use these IDs when calling tools):",
        "| id | title | assignee | priority | start_date | duration | predecessors |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for task in tasks:
        lines.append(
            f"| {task.id} | {task.title} | {task.assignee or '-'} | "
            f"{getattr(task, 'priority', None) or 'Средний'} | "
            f"{task.start_date.isoformat()} | {task.duration} | "
            f"{task.predecessors or '-'} |"
        )
    return "\n".join(lines)


def tool_result_text(result) -> str:
    """Extract a plain string from an MCP CallToolResult."""
    if getattr(result, "is_error", False):
        parts = []
        for block in result.content or []:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return parts[0] if parts else "Tool execution failed"

    structured = getattr(result, "structured_content", None)
    if isinstance(structured, dict) and "result" in structured:
        return str(structured["result"])

    parts = []
    for block in result.content or []:
        text = getattr(block, "text", None)
        if text:
            parts.append(text)
    return "\n".join(parts) if parts else "OK"
