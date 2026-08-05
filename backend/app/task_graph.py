"""Task predecessor graph helpers (integrity — layer A, no date shifting)."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models import Task


def parse_predecessor_ids(raw: str | None) -> list[int]:
    if not raw or not str(raw).strip():
        return []
    ids: list[int] = []
    seen: set[int] = set()
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = int(part)
        except ValueError as exc:
            raise ValueError(
                f"Invalid predecessor id '{part}'. Expected integer IDs."
            ) from exc
        if value <= 0:
            raise ValueError(f"Invalid predecessor id '{value}'.")
        if value not in seen:
            seen.add(value)
            ids.append(value)
    return ids


def format_predecessor_ids(ids: list[int]) -> str | None:
    return ",".join(str(i) for i in ids) if ids else None


def build_adjacency(tasks: list[Task]) -> dict[int, list[int]]:
    graph: dict[int, list[int]] = {task.id: [] for task in tasks}
    for task in tasks:
        for pred_id in parse_predecessor_ids(task.predecessors):
            if pred_id in graph:
                graph[task.id].append(pred_id)
    return graph


def would_create_cycle(
    graph: dict[int, list[int]],
    task_id: int,
    predecessor_ids: list[int],
) -> bool:
    """True if setting task_id → predecessors introduces a cycle."""
    adjacency = {node: list(preds) for node, preds in graph.items()}
    adjacency[task_id] = list(predecessor_ids)

    def reaches(start: int, target: int) -> bool:
        stack = [start]
        visited: set[int] = set()
        while stack:
            node = stack.pop()
            if node == target:
                return True
            if node in visited:
                continue
            visited.add(node)
            stack.extend(adjacency.get(node, []))
        return False

    return any(reaches(pred_id, task_id) for pred_id in predecessor_ids)


def validate_predecessors(
    db: Session,
    *,
    task_id: int | None,
    predecessors: str | None,
    known_ids: set[int] | None = None,
) -> str | None:
    """Normalize predecessors. Raises ValueError if invalid."""
    pred_ids = parse_predecessor_ids(predecessors)

    if task_id is not None and task_id in pred_ids:
        raise ValueError("A task cannot depend on itself.")

    if known_ids is None:
        known_ids = {row.id for row in db.query(Task.id).all()}
    if task_id is not None:
        known_ids = set(known_ids) | {task_id}

    missing = [pid for pid in pred_ids if pid not in known_ids]
    if missing:
        raise ValueError(
            "Unknown predecessor id(s): " + ", ".join(str(i) for i in missing)
        )

    if task_id is None or not pred_ids:
        return format_predecessor_ids(pred_ids)

    tasks = list(db.query(Task).all())
    if task_id not in {t.id for t in tasks}:
        # Creating: flush already assigned id but not committed — include stub.
        pass

    graph = build_adjacency(tasks)
    if task_id not in graph:
        graph[task_id] = []

    if would_create_cycle(graph, task_id, pred_ids):
        raise ValueError("Dependency would create a cycle.")

    return format_predecessor_ids(pred_ids)


def strip_predecessor_references(db: Session, deleted_id: int) -> int:
    """Remove deleted_id from all tasks' predecessors. Returns affected count."""
    return strip_predecessor_references_many(db, {deleted_id})


def strip_predecessor_references_many(db: Session, deleted_ids: set[int]) -> int:
    """Remove any of deleted_ids from all tasks' predecessors. Returns affected count."""
    if not deleted_ids:
        return 0
    updated = 0
    for task in db.query(Task).all():
        ids = parse_predecessor_ids(task.predecessors)
        if not any(i in deleted_ids for i in ids):
            continue
        task.predecessors = format_predecessor_ids(
            [i for i in ids if i not in deleted_ids]
        )
        updated += 1
    return updated
