"""MCP tools for Gantt tasks: analytics, search, and mutations."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import date, datetime, timedelta
from typing import Any

from mcp.server.mcpserver import MCPServer
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session

from app.models import Task, TaskPriority
from app.schemas import normalize_priority
from app.task_graph import (
    format_predecessor_ids,
    parse_predecessor_ids,
    strip_predecessor_references,
    strip_predecessor_references_many,
    validate_predecessors,
)

mcp = MCPServer("Repka")

_db_session: ContextVar[Session | None] = ContextVar("repka_db_session", default=None)

_TITLE_MAX = 80
_DESCRIPTION_MAX = 500
_ASSIGNEE_MAX = 60
_SEARCH_DEFAULT_LIMIT = 50
_SEARCH_MAX_LIMIT = 250
_BULK_MAX_IDS = 250


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


def _coerce_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n", ""}:
            return False
    raise ValueError(f"{field} must be a boolean")


def _inclusive_finish_expr():
    """Last active calendar day: start_date + duration - 1 (Finish for interval math)."""
    return func.date(
        Task.start_date,
        cast(Task.duration - 1, String) + " days",
    )


def _task_finish_date(task: Task) -> date:
    """Inclusive last active day of the task interval."""
    return task.start_date + timedelta(days=max(task.duration, 1) - 1)


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
    on_date: date | None = None,
    active_from: date | None = None,
    active_to: date | None = None,
):
    """Apply optional filters. Assignee uses case-insensitive contains; priority is canonical.

    start_*/finish_* filter by start_date or inclusive Finish alone.
    on_date / active_from+active_to use working-interval intersection
    (Start ≤ bound AND Finish ≥ bound; Finish = start + duration − 1).
    """
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

    # finish_from/to use inclusive last active day (start + duration - 1).
    finish_expr = _inclusive_finish_expr()
    if finish_from is not None:
        query = query.filter(finish_expr >= finish_from.isoformat())
    if finish_to is not None:
        query = query.filter(finish_expr <= finish_to.isoformat())

    # Active on date: Start <= on_date <= Finish.
    if on_date is not None:
        target = on_date.isoformat()
        query = query.filter(
            Task.start_date <= on_date,
            finish_expr >= target,
        )

    # Active during [active_from, active_to]: Start <= active_to AND Finish >= active_from.
    if active_from is not None or active_to is not None:
        if active_to is not None:
            query = query.filter(Task.start_date <= active_to)
        if active_from is not None:
            query = query.filter(finish_expr >= active_from.isoformat())

    return query


def _validate_date_filter_combos(
    *,
    on_date: date | None,
    active_from: date | None,
    active_to: date | None,
    starts_from: date | None = None,
    starts_to: date | None = None,
    ends_from: date | None = None,
    ends_to: date | None = None,
) -> None:
    if on_date is not None and (active_from is not None or active_to is not None):
        raise ValueError("Pass either on_date or active_from/active_to, not both")
    if (active_from is None) ^ (active_to is None):
        raise ValueError("active_from and active_to must be passed together")
    if (
        active_from is not None
        and active_to is not None
        and active_from > active_to
    ):
        raise ValueError("active_from must be <= active_to")
    if (
        starts_from is not None
        and starts_to is not None
        and starts_from > starts_to
    ):
        raise ValueError("starts_from must be <= starts_to")
    if ends_from is not None and ends_to is not None and ends_from > ends_to:
        raise ValueError("ends_from must be <= ends_to")


def _parse_common_filters(
    *,
    query: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
    starts_from: str | None = None,
    starts_to: str | None = None,
    ends_from: str | None = None,
    ends_to: str | None = None,
) -> dict[str, Any]:
    parsed_on_date = _optional_date(on_date, "on_date")
    parsed_active_from = _optional_date(active_from, "active_from")
    parsed_active_to = _optional_date(active_to, "active_to")
    parsed_starts_from = _optional_date(starts_from, "starts_from")
    parsed_starts_to = _optional_date(starts_to, "starts_to")
    parsed_ends_from = _optional_date(ends_from, "ends_from")
    parsed_ends_to = _optional_date(ends_to, "ends_to")
    _validate_date_filter_combos(
        on_date=parsed_on_date,
        active_from=parsed_active_from,
        active_to=parsed_active_to,
        starts_from=parsed_starts_from,
        starts_to=parsed_starts_to,
        ends_from=parsed_ends_from,
        ends_to=parsed_ends_to,
    )
    return {
        "assignee": assignee,
        "priority": priority,
        "text_query": query,
        "on_date": parsed_on_date,
        "active_from": parsed_active_from,
        "active_to": parsed_active_to,
        "start_from": parsed_starts_from,
        "start_to": parsed_starts_to,
        "finish_from": parsed_ends_from,
        "finish_to": parsed_ends_to,
    }


def _query_filtered_tasks(**filter_kwargs: Any):
    return _apply_task_filters(_db().query(Task), **filter_kwargs)


def _require_filter_scope(filter_kwargs: dict[str, Any]) -> None:
    """Refuse unscoped where-mutations (would match the whole project)."""
    scoped = any(
        filter_kwargs.get(key) is not None
        for key in (
            "assignee",
            "priority",
            "text_query",
            "on_date",
            "active_from",
            "active_to",
            "start_from",
            "start_to",
            "finish_from",
            "finish_to",
        )
    )
    if not scoped:
        raise ValueError(
            "Refusing unscoped mutation: pass at least one filter "
            "(assignee, priority, query, or dates). "
            "To wipe the whole project use clear_entire_project(confirm=true)."
        )


def _filter_bits(filter_kwargs: dict[str, Any]) -> list[str]:
    bits: list[str] = []
    if _optional_str(filter_kwargs.get("assignee")):
        bits.append(f"assignee~{_optional_str(filter_kwargs.get('assignee'))}")
    if _optional_str(filter_kwargs.get("priority")):
        bits.append(
            f"priority={normalize_priority(filter_kwargs['priority'])}"
        )
    if _optional_str(filter_kwargs.get("text_query")):
        bits.append(f"query~{_optional_str(filter_kwargs.get('text_query'))}")
    on_date = filter_kwargs.get("on_date")
    if on_date is not None:
        bits.append(f"on_date={format_date_ddmmyy(on_date)}")
    active_from = filter_kwargs.get("active_from")
    active_to = filter_kwargs.get("active_to")
    if active_from is not None and active_to is not None:
        bits.append(
            f"active={format_date_ddmmyy(active_from)}…{format_date_ddmmyy(active_to)}"
        )
    start_from = filter_kwargs.get("start_from")
    start_to = filter_kwargs.get("start_to")
    if start_from is not None or start_to is not None:
        bits.append(
            f"starts={format_date_ddmmyy(start_from) if start_from else '…'}"
            f"…{format_date_ddmmyy(start_to) if start_to else '…'}"
        )
    finish_from = filter_kwargs.get("finish_from")
    finish_to = filter_kwargs.get("finish_to")
    if finish_from is not None or finish_to is not None:
        bits.append(
            f"ends={format_date_ddmmyy(finish_from) if finish_from else '…'}"
            f"…{format_date_ddmmyy(finish_to) if finish_to else '…'}"
        )
    return bits


def _resolve_schedule(
    task: Task,
    *,
    new_start_date: str | None = None,
    new_end_date: str | None = None,
    duration: int | None = None,
) -> tuple[date, int, str]:
    """Resolve start/duration from optional fields. Returns (start, duration, mode)."""
    start = _optional_date(new_start_date, "new_start_date")
    end = _optional_date(new_end_date, "new_end_date")

    if start is None and end is None and duration is None:
        raise ValueError(
            "Provide new_start_date and/or new_end_date "
            "(optionally duration with start or end)."
        )
    if duration is not None and duration < 1:
        raise ValueError("duration must be >= 1")

    if start is not None and end is not None:
        if duration is not None:
            raise ValueError(
                "Pass either new_end_date or duration with new_start_date, not both"
            )
        if end < start:
            raise ValueError("new_end_date must be >= new_start_date")
        return start, (end - start).days + 1, "start+end"

    if start is not None and duration is not None:
        return start, duration, "start+duration"

    if start is not None:
        return start, max(task.duration, 1), "start_only"

    if end is not None and duration is not None:
        return end - timedelta(days=duration - 1), duration, "end+duration"

    if end is not None:
        dur = max(task.duration, 1)
        return end - timedelta(days=dur - 1), dur, "end_only"

    raise ValueError("duration alone: use update_task_duration")


def _shift_task(task: Task, offset_days: int) -> None:
    task.start_date = task.start_date + timedelta(days=offset_days)


@mcp.tool()
def get_project_summary(
    assignee: str | None = None,
    priority: str | None = None,
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
) -> str:
    """Aggregated task analytics ONLY (counts by assignee and priority). No task titles/IDs.

    Use for «сколько», «статистика», «распределение», «загрузка».
    Do NOT use for «какие задачи…» / «перечисли» / «покажи список» — use search_tasks instead.

    Optional date filters (dd.mm.yy) restrict COUNT/GROUP BY to tasks whose working
    interval intersects the period — not only those that start inside it:
    - on_date: active that calendar day (Start ≤ date ≤ Finish)
    - active_from + active_to: active anytime in [active_from, active_to]
      (Start ≤ active_to AND Finish ≥ active_from; Finish = start + duration − 1)

    For time-scoped counts always pass date bounds.
    """
    filter_kwargs = _parse_common_filters(
        assignee=assignee,
        priority=priority,
        on_date=on_date,
        active_from=active_from,
        active_to=active_to,
    )
    # summary ignores text/starts/ends — drop unused keys for clarity
    summary_filters = {
        "assignee": filter_kwargs["assignee"],
        "priority": filter_kwargs["priority"],
        "on_date": filter_kwargs["on_date"],
        "active_from": filter_kwargs["active_from"],
        "active_to": filter_kwargs["active_to"],
    }

    db = _db()
    base = _apply_task_filters(db.query(Task), **summary_filters)
    total = base.count()

    by_assignee_rows = (
        _apply_task_filters(
            db.query(Task.assignee, func.count(Task.id)),
            **summary_filters,
        )
        .group_by(Task.assignee)
        .order_by(func.count(Task.id).desc())
        .all()
    )
    by_priority_rows = (
        _apply_task_filters(
            db.query(Task.priority, func.count(Task.id)),
            **summary_filters,
        )
        .group_by(Task.priority)
        .order_by(func.count(Task.id).desc())
        .all()
    )

    lines = [f"total_tasks: {total}"]
    bits = _filter_bits(summary_filters)
    if bits:
        lines.append(f"filters: {', '.join(bits)}")

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
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
    starts_from: str | None = None,
    starts_to: str | None = None,
    ends_from: str | None = None,
    ends_to: str | None = None,
    limit: int = _SEARCH_DEFAULT_LIMIT,
    ids_only: bool = False,
) -> str:
    """Return matching tasks. Use for «какие / перечисли / покажи» and to collect IDs for bulk_*.

    Not for bare counts — use get_project_summary for «сколько».
    Default limit 50, max 250. For bulk prep set ids_only=true (compact id list).

    Date modes (dd.mm.yy; do not mix ACTIVE with STARTS/ENDS unless intentional):

    1) ACTIVE (interval intersection) — «какие задачи на сегодня / на этой неделе»:
       - on_date / active_from+active_to
    2) STARTS — starts_from / starts_to
    3) ENDS — ends_from / ends_to
    """
    if limit < 1:
        raise ValueError("limit must be >= 1")
    if limit > _SEARCH_MAX_LIMIT:
        limit = _SEARCH_MAX_LIMIT
    want_ids_only = _coerce_bool(ids_only, "ids_only")

    filter_kwargs = _parse_common_filters(
        query=query,
        assignee=assignee,
        priority=priority,
        on_date=on_date,
        active_from=active_from,
        active_to=active_to,
        starts_from=starts_from,
        starts_to=starts_to,
        ends_from=ends_from,
        ends_to=ends_to,
    )
    q = _query_filtered_tasks(**filter_kwargs)
    total = q.count()
    rows = q.order_by(Task.id).limit(limit).all()

    if not rows:
        return "No tasks matched the filters."

    header = f"matched: {total} (showing {len(rows)})"
    if want_ids_only:
        return f"{header} ids_only\nids: {','.join(str(t.id) for t in rows)}"

    lines = [header]
    for task in rows:
        finish = _task_finish_date(task)
        lines.append(
            f"#{task.id} «{task.title}» | {task.assignee or '-'} | "
            f"{task.priority or TaskPriority.MEDIUM.value} | "
            f"{format_date_ddmmyy(task.start_date)}→{format_date_ddmmyy(finish)} | {task.duration}d"
        )
    return "\n".join(lines)


@mcp.tool()
def move_task(
    task_id: int,
    new_start_date: str | None = None,
    new_end_date: str | None = None,
    duration: int | None = None,
) -> str:
    """Reschedule one task. Dates dd.mm.yy. Modes:
    - new_start_date only → keep duration
    - new_start_date + new_end_date → recompute duration (inclusive)
    - new_end_date only → keep duration, shift start
    - new_start_date + duration → set both
    """
    task = _get_task(task_id)
    old_start = format_date_ddmmyy(task.start_date)
    old_end = format_date_ddmmyy(_task_finish_date(task))
    old_duration = task.duration

    start, new_duration, mode = _resolve_schedule(
        task,
        new_start_date=new_start_date,
        new_end_date=new_end_date,
        duration=duration,
    )
    task.start_date = start
    task.duration = new_duration
    _db().commit()
    _db().refresh(task)
    new_end = format_date_ddmmyy(_task_finish_date(task))
    return (
        f"Moved task #{task.id} «{task.title}» ({mode}): "
        f"{old_start}→{old_end} ({old_duration}d) → "
        f"{format_date_ddmmyy(task.start_date)}→{new_end} ({task.duration}d)."
    )


def _normalize_task_ids(task_ids: list[int]) -> list[int]:
    if not task_ids:
        raise ValueError("task_ids must not be empty")
    cleaned: list[int] = []
    seen: set[int] = set()
    for raw in task_ids:
        tid = int(raw)
        if tid in seen:
            continue
        seen.add(tid)
        cleaned.append(tid)
    if len(cleaned) > _BULK_MAX_IDS:
        raise ValueError(f"task_ids must contain at most {_BULK_MAX_IDS} items")
    return cleaned


def _load_tasks_for_bulk(task_ids: list[int]) -> tuple[list[Task], list[int]]:
    ids = _normalize_task_ids(task_ids)
    db = _db()
    rows = db.query(Task).filter(Task.id.in_(ids)).all()
    by_id = {t.id: t for t in rows}
    found = [by_id[i] for i in ids if i in by_id]
    missing = [i for i in ids if i not in by_id]
    return found, missing


@mcp.tool()
def bulk_move_tasks(task_ids: list[int], new_start_date: str) -> str:
    """Move many tasks to the same start date in one call (dd.mm.yy). Prefer this over repeated move_task.
    For relative shifts use shift_tasks; for filter-based absolute move use move_tasks_where.
    """
    parsed = _parse_date(new_start_date)
    tasks, missing = _load_tasks_for_bulk(task_ids)
    if not tasks and missing:
        raise ValueError(f"No tasks found for ids: {missing}")

    for task in tasks:
        task.start_date = parsed
    _db().commit()

    lines = [
        f"Moved {len(tasks)} task(s) to {format_date_ddmmyy(parsed)}:",
    ]
    for task in tasks:
        lines.append(f"  #{task.id} «{task.title}»")
    if missing:
        lines.append(f"missing ids (skipped): {missing}")
    return "\n".join(lines)


@mcp.tool()
def shift_tasks(task_ids: list[int], offset_days: int) -> str:
    """Shift start dates of many tasks by offset_days (e.g. +3 or -5). Duration unchanged."""
    if not isinstance(offset_days, int):
        offset_days = int(offset_days)
    if offset_days == 0:
        raise ValueError("offset_days must be non-zero")

    tasks, missing = _load_tasks_for_bulk(task_ids)
    if not tasks and missing:
        raise ValueError(f"No tasks found for ids: {missing}")

    for task in tasks:
        _shift_task(task, offset_days)
    _db().commit()

    sign = "+" if offset_days > 0 else ""
    lines = [f"Shifted {len(tasks)} task(s) by {sign}{offset_days} day(s):"]
    for task in tasks:
        lines.append(
            f"  #{task.id} «{task.title}» → {format_date_ddmmyy(task.start_date)}"
        )
    if missing:
        lines.append(f"missing ids (skipped): {missing}")
    return "\n".join(lines)


@mcp.tool()
def bulk_assign_tasks(task_ids: list[int], new_assignee: str) -> str:
    """Assign many tasks to the same person in one call. Empty new_assignee clears assignee. Prefer over repeated assign_task."""
    clean_assignee = _clip(new_assignee, _ASSIGNEE_MAX, "new_assignee")
    tasks, missing = _load_tasks_for_bulk(task_ids)
    if not tasks and missing:
        raise ValueError(f"No tasks found for ids: {missing}")

    label = clean_assignee or "unassigned"
    for task in tasks:
        task.assignee = clean_assignee
    _db().commit()

    lines = [f"Assigned {len(tasks)} task(s) to «{label}»:"]
    for task in tasks:
        lines.append(f"  #{task.id} «{task.title}»")
    if missing:
        lines.append(f"missing ids (skipped): {missing}")
    return "\n".join(lines)


@mcp.tool()
def bulk_delete_tasks(task_ids: list[int]) -> str:
    """Delete many tasks in one call and clean predecessor references. Prefer over repeated delete_task.
    To delete by filters use delete_tasks_where; to wipe all tasks use clear_entire_project(confirm=true).
    """
    tasks, missing = _load_tasks_for_bulk(task_ids)
    if not tasks and missing:
        raise ValueError(f"No tasks found for ids: {missing}")

    db = _db()
    deleted: list[tuple[int, str]] = [(t.id, t.title) for t in tasks]
    strip_predecessor_references_many(db, {tid for tid, _ in deleted})
    for task in tasks:
        db.delete(task)
    db.commit()

    lines = [f"Deleted {len(deleted)} task(s):"]
    for task_id, title in deleted:
        lines.append(f"  #{task_id} «{title}»")
    if missing:
        lines.append(f"missing ids (skipped): {missing}")
    return "\n".join(lines)


@mcp.tool()
def move_tasks_where(
    new_start_date: str,
    query: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
    starts_from: str | None = None,
    starts_to: str | None = None,
    ends_from: str | None = None,
    ends_to: str | None = None,
) -> str:
    """Move ALL tasks matching filters to new_start_date (dd.mm.yy). No search pagination.
    At least one filter required. Prefer over search+bulk_move for large sets.
    """
    parsed = _parse_date(new_start_date)
    filter_kwargs = _parse_common_filters(
        query=query,
        assignee=assignee,
        priority=priority,
        on_date=on_date,
        active_from=active_from,
        active_to=active_to,
        starts_from=starts_from,
        starts_to=starts_to,
        ends_from=ends_from,
        ends_to=ends_to,
    )
    _require_filter_scope(filter_kwargs)
    tasks = _query_filtered_tasks(**filter_kwargs).order_by(Task.id).all()
    if not tasks:
        return "No tasks matched the filters."

    for task in tasks:
        task.start_date = parsed
    _db().commit()

    bits = _filter_bits(filter_kwargs)
    lines = [
        f"Moved {len(tasks)} task(s) matching [{', '.join(bits)}] "
        f"to {format_date_ddmmyy(parsed)}:"
    ]
    for task in tasks[:30]:
        lines.append(f"  #{task.id} «{task.title}»")
    if len(tasks) > 30:
        lines.append(f"  … and {len(tasks) - 30} more")
    return "\n".join(lines)


@mcp.tool()
def shift_tasks_where(
    offset_days: int,
    query: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
    starts_from: str | None = None,
    starts_to: str | None = None,
    ends_from: str | None = None,
    ends_to: str | None = None,
) -> str:
    """Shift ALL matching tasks by offset_days (+/−). No search pagination. At least one filter required."""
    if not isinstance(offset_days, int):
        offset_days = int(offset_days)
    if offset_days == 0:
        raise ValueError("offset_days must be non-zero")

    filter_kwargs = _parse_common_filters(
        query=query,
        assignee=assignee,
        priority=priority,
        on_date=on_date,
        active_from=active_from,
        active_to=active_to,
        starts_from=starts_from,
        starts_to=starts_to,
        ends_from=ends_from,
        ends_to=ends_to,
    )
    _require_filter_scope(filter_kwargs)
    tasks = _query_filtered_tasks(**filter_kwargs).order_by(Task.id).all()
    if not tasks:
        return "No tasks matched the filters."

    for task in tasks:
        _shift_task(task, offset_days)
    _db().commit()

    sign = "+" if offset_days > 0 else ""
    bits = _filter_bits(filter_kwargs)
    lines = [
        f"Shifted {len(tasks)} task(s) matching [{', '.join(bits)}] "
        f"by {sign}{offset_days} day(s):"
    ]
    for task in tasks[:30]:
        lines.append(
            f"  #{task.id} «{task.title}» → {format_date_ddmmyy(task.start_date)}"
        )
    if len(tasks) > 30:
        lines.append(f"  … and {len(tasks) - 30} more")
    return "\n".join(lines)


@mcp.tool()
def delete_tasks_where(
    query: str | None = None,
    assignee: str | None = None,
    priority: str | None = None,
    on_date: str | None = None,
    active_from: str | None = None,
    active_to: str | None = None,
    starts_from: str | None = None,
    starts_to: str | None = None,
    ends_from: str | None = None,
    ends_to: str | None = None,
) -> str:
    """Delete ALL tasks matching filters + clean predecessor refs. No search pagination.
    At least one filter required. To wipe everything use clear_entire_project(confirm=true).
    """
    filter_kwargs = _parse_common_filters(
        query=query,
        assignee=assignee,
        priority=priority,
        on_date=on_date,
        active_from=active_from,
        active_to=active_to,
        starts_from=starts_from,
        starts_to=starts_to,
        ends_from=ends_from,
        ends_to=ends_to,
    )
    _require_filter_scope(filter_kwargs)
    db = _db()
    tasks = _query_filtered_tasks(**filter_kwargs).order_by(Task.id).all()
    if not tasks:
        return "No tasks matched the filters."

    deleted: list[tuple[int, str]] = [(t.id, t.title) for t in tasks]
    strip_predecessor_references_many(db, {tid for tid, _ in deleted})
    for task in tasks:
        db.delete(task)
    db.commit()

    bits = _filter_bits(filter_kwargs)
    lines = [
        f"Deleted {len(deleted)} task(s) matching [{', '.join(bits)}]:"
    ]
    for task_id, title in deleted[:30]:
        lines.append(f"  #{task_id} «{title}»")
    if len(deleted) > 30:
        lines.append(f"  … and {len(deleted) - 30} more")
    return "\n".join(lines)


@mcp.tool()
def clear_entire_project(confirm: bool = False) -> str:
    """Delete ALL tasks in the project (full wipe). Requires confirm=true.
    Prefer this over search+bulk_delete when the user asks to clear the whole plan.
    """
    if not _coerce_bool(confirm, "confirm"):
        raise ValueError(
            "Refusing to clear project: pass confirm=true to delete ALL tasks."
        )
    db = _db()
    count = db.query(Task).count()
    db.query(Task).delete()
    db.commit()
    return f"Cleared entire project: deleted {count} task(s)."


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
