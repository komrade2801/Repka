"""MCP tools for Gantt tasks: analytics, search, and mutations."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import date, datetime, timedelta

from mcp.server.mcpserver import MCPServer
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from app.models import Task, TaskPriority
from app.schemas import normalize_priority
from app.task_graph import (
    format_predecessor_ids,
    parse_predecessor_ids,
    strip_predecessor_references,
    validate_predecessors,
)

mcp = MCPServer("Repka")

_db_session: ContextVar[Session | None] = ContextVar("repka_db_session", default=None)

_TITLE_MAX = 80
_DESCRIPTION_MAX = 500
_ASSIGNEE_MAX = 60


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


def format_date_ddmmyy(value: date) -> str:
    """Display dates for the assistant as dd.mm.yy."""
    return value.strftime("%d.%m.%y")


def _parse_date(value: str) -> date:
    text = value.strip()
    for fmt in ("%d.%m.%y", "%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(
        f"Invalid date '{value}'. Use format dd.mm.yy (e.g. 05.08.26)."
    )


def _clip(value: str | None, max_len: int, field: str) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    if len(text) > max_len:
        raise ValueError(f"{field} must be at most {max_len} characters")
    return text


def _optional_str(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _optional_date(value: str | None, field: str) -> date | None:
    clean = _optional_str(value)
    if clean is None:
        return None
    try:
        return _parse_date(clean)
    except ValueError as exc:
        raise ValueError(
            f"Invalid {field} '{value}'. Use format dd.mm.yy (e.g. 05.08.26)."
        ) from exc


def _finish_date_expr():
    """Gantt end date: start_date + duration days (same as frontend addDays)."""
    return func.date(
        Task.start_date,
        cast(Task.duration, String) + " days",
    )


def _task_finish_date(task: Task) -> date:
    return task.start_date + timedelta(days=max(task.duration, 1))


def _apply_task_filters(
    query,
    *,
    assignee: str | None = None,
    priority: str | None = None,
    text_query: str | None = None,
    start_from: date | None = None,
    start_to: date | None = None,
    finish_from: date | None = None,
    finish_to: date | None = None,
):
    """Apply optional filters. Assignee uses case-insensitive contains; priority is canonical."""
    clean_assignee = _optional_str(assignee)
    if clean_assignee:
        query = query.filter(Task.assignee.ilike(f"%{clean_assignee}%"))

    clean_priority = _optional_str(priority)
    if clean_priority:
        query = query.filter(Task.priority == normalize_priority(clean_priority))

    clean_text = _optional_str(text_query)
    if clean_text:
        pattern = f"%{clean_text}%"
        query = query.filter(
            or_(Task.title.ilike(pattern), Task.description.ilike(pattern))
        )

    if start_from is not None:
        query = query.filter(Task.start_date >= start_from)
    if start_to is not None:
        query = query.filter(Task.start_date <= start_to)

    finish_expr = _finish_date_expr()
    if finish_from is not None:
        query = query.filter(finish_expr >= finish_from.isoformat())
    if finish_to is not None:
        query = query.filter(finish_expr <= finish_to.isoformat())

    return query


@mcp.tool()
def get_project_summary(
    assignee: str | None = None,
    priority: str | None = None,
) -> str:
    """Aggregated task analytics (counts by assignee and priority). Use for «сколько задач», загрузка, распределение по приоритетам — do not count from the prompt table."""
    db = _db()
    base = _apply_task_filters(
        db.query(Task), assignee=assignee, priority=priority
    )
    total = base.count()

    by_assignee_rows = (
        _apply_task_filters(
            db.query(Task.assignee, func.count(Task.id)),
            assignee=assignee,
            priority=priority,
        )
        .group_by(Task.assignee)
        .order_by(func.count(Task.id).desc())
        .all()
    )
    by_priority_rows = (
        _apply_task_filters(
            db.query(Task.priority, func.count(Task.id)),
            assignee=assignee,
            priority=priority,
        )
        .group_by(Task.priority)
        .order_by(func.count(Task.id).desc())
        .all()
    )

    lines = [f"total_tasks: {total}"]
    if _optional_str(assignee) or _optional_str(priority):
        filters = []
        if _optional_str(assignee):
            filters.append(f"assignee~{_optional_str(assignee)}")
        if _optional_str(priority):
            filters.append(f"priority={normalize_priority(priority)}")
        lines.append(f"filters: {', '.join(filters)}")

    lines.append("by_assignee:")
    if not by_assignee_rows:
        lines.append("  (none)")
    else:
        for name, count in by_assignee_rows:
            lines.append(f"  {name or 'unassigned'}: {count}")

    lines.append("by_priority:")
    if not by_priority_rows:
        lines.append("  (none)")
    else:
        for label, count in by_priority_rows:
            lines.append(f"  {label or TaskPriority.MEDIUM.value}: {count}")

    return "\n".join(lines)


@mcp.tool()
def search_tasks(
    query: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    start_from: str | None = None,
    start_to: str | None = None,
    finish_from: str | None = None,
    finish_to: str | None = None,
    limit: int = 10,
) -> str:
    """Search/filter tasks by text, assignee, priority, and start/finish date ranges (dd.mm.yy). Finish = start_date + duration days. Prefer this over scanning the prompt table."""
    if limit < 1:
        raise ValueError("limit must be >= 1")
    if limit > 50:
        limit = 50

    parsed_start_from = _optional_date(start_from, "start_from")
    parsed_start_to = _optional_date(start_to, "start_to")
    parsed_finish_from = _optional_date(finish_from, "finish_from")
    parsed_finish_to = _optional_date(finish_to, "finish_to")

    if (
        parsed_start_from is not None
        and parsed_start_to is not None
        and parsed_start_from > parsed_start_to
    ):
        raise ValueError("start_from must be <= start_to")
    if (
        parsed_finish_from is not None
        and parsed_finish_to is not None
        and parsed_finish_from > parsed_finish_to
    ):
        raise ValueError("finish_from must be <= finish_to")

    db = _db()
    q = _apply_task_filters(
        db.query(Task),
        assignee=assignee,
        priority=priority,
        text_query=query,
        start_from=parsed_start_from,
        start_to=parsed_start_to,
        finish_from=parsed_finish_from,
        finish_to=parsed_finish_to,
    )
    total = q.count()
    rows = q.order_by(Task.id).limit(limit).all()

    if not rows:
        return "No tasks matched the filters."

    lines = [f"matched: {total} (showing {len(rows)})"]
    for task in rows:
        finish = _task_finish_date(task)
        lines.append(
            f"#{task.id} «{task.title}» | {task.assignee or '-'} | "
            f"{task.priority or TaskPriority.MEDIUM.value} | "
            f"{format_date_ddmmyy(task.start_date)}→{format_date_ddmmyy(finish)} | {task.duration}d"
        )
    return "\n".join(lines)


@mcp.tool()
def move_task(task_id: int, new_start_date: str) -> str:
    """Move a task to a new start date. Date must be dd.mm.yy (e.g. 05.08.26)."""
    task = _get_task(task_id)
    parsed = _parse_date(new_start_date)
    old = format_date_ddmmyy(task.start_date)
    task.start_date = parsed
    _db().commit()
    _db().refresh(task)
    return (
        f"Moved task #{task.id} «{task.title}» "
        f"from {old} to {format_date_ddmmyy(task.start_date)}."
    )


@mcp.tool()
def assign_task(task_id: int, assignee: str) -> str:
    """Assign (or reassign) a task to a person by name. Empty string clears assignee."""
    task = _get_task(task_id)
    previous = task.assignee or "unassigned"
    task.assignee = _clip(assignee, _ASSIGNEE_MAX, "assignee")
    _db().commit()
    _db().refresh(task)
    return (
        f"Assigned task #{task.id} «{task.title}» "
        f"from «{previous}» to «{task.assignee or 'unassigned'}»."
    )


@mcp.tool()
def add_dependency(task_id: int, predecessor_id: int) -> str:
    """Add a finish-to-start predecessor dependency to a task (layer A validation)."""
    task = _get_task(task_id)
    predecessor = _get_task(predecessor_id)

    deps = parse_predecessor_ids(task.predecessors)
    if predecessor_id in deps:
        return (
            f"Task #{task.id} «{task.title}» already depends on "
            f"#{predecessor.id} «{predecessor.title}»."
        )

    deps.append(predecessor_id)
    task.predecessors = validate_predecessors(
        _db(),
        task_id=task.id,
        predecessors=format_predecessor_ids(deps),
    )
    _db().commit()
    _db().refresh(task)
    return (
        f"Added dependency: task #{task.id} «{task.title}» now waits for "
        f"#{predecessor.id} «{predecessor.title}»."
    )


@mcp.tool()
def remove_dependency(task_id: int, predecessor_id: int) -> str:
    """Remove a predecessor dependency from a task."""
    task = _get_task(task_id)
    deps = parse_predecessor_ids(task.predecessors)
    if predecessor_id not in deps:
        return (
            f"Task #{task.id} «{task.title}» does not depend on #{predecessor_id}."
        )

    deps = [i for i in deps if i != predecessor_id]
    task.predecessors = format_predecessor_ids(deps)
    _db().commit()
    _db().refresh(task)
    return (
        f"Removed dependency: task #{task.id} «{task.title}» "
        f"no longer waits for #{predecessor_id}."
    )


@mcp.tool()
def create_task(
    title: str,
    start_date: str,
    duration: int = 1,
    description: str | None = None,
    assignee: str | None = None,
    priority: str = "Средний",
    predecessors: str | None = None,
) -> str:
    """Create a new task. start_date is dd.mm.yy (e.g. 05.08.26). predecessors: comma-separated IDs."""
    clean_title = _clip(title, _TITLE_MAX, "title")
    if not clean_title:
        raise ValueError("title is required")
    if duration < 1:
        raise ValueError("duration must be >= 1")

    parsed_start = _parse_date(start_date)
    clean_description = _clip(description, _DESCRIPTION_MAX, "description")
    clean_assignee = _clip(assignee, _ASSIGNEE_MAX, "assignee")
    normalized_priority = normalize_priority(priority)

    db = _db()
    task = Task(
        title=clean_title,
        description=clean_description,
        assignee=clean_assignee,
        start_date=parsed_start,
        duration=duration,
        predecessors=None,
        priority=normalized_priority,
    )
    db.add(task)
    db.flush()

    task.predecessors = validate_predecessors(
        db, task_id=task.id, predecessors=predecessors
    )
    db.commit()
    db.refresh(task)
    return (
        f"Created task #{task.id} «{task.title}» "
        f"(start {format_date_ddmmyy(task.start_date)}, {task.duration}d, "
        f"priority {task.priority})."
    )


@mcp.tool()
def delete_task(task_id: int) -> str:
    """Delete a task and remove references to it from other tasks' predecessors."""
    task = _get_task(task_id)
    title = task.title
    db = _db()
    strip_predecessor_references(db, task_id)
    db.delete(task)
    db.commit()
    return f"Deleted task #{task_id} «{title}». Dependency references cleaned up."


@mcp.tool()
def update_task_duration(task_id: int, duration: int) -> str:
    """Update task duration in days (must be >= 1)."""
    if duration < 1:
        raise ValueError("duration must be >= 1")
    task = _get_task(task_id)
    old = task.duration
    task.duration = duration
    _db().commit()
    _db().refresh(task)
    return (
        f"Updated duration of task #{task.id} «{task.title}» "
        f"from {old} to {task.duration} day(s)."
    )


@mcp.tool()
def update_task_priority(task_id: int, priority: str) -> str:
    """Update task priority. Accepts Russian labels or EN aliases (high, low, critical, …)."""
    task = _get_task(task_id)
    old = task.priority or TaskPriority.MEDIUM.value
    task.priority = normalize_priority(priority)
    _db().commit()
    _db().refresh(task)
    return (
        f"Updated priority of task #{task.id} «{task.title}» "
        f"from «{old}» to «{task.priority}»."
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
            f"{format_date_ddmmyy(task.start_date)} | {task.duration} | "
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
