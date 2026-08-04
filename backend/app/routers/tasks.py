from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task
from app.schemas import (
    TaskCreate,
    TaskImportRequest,
    TaskImportResult,
    TaskImportSkipped,
    TaskRead,
    TaskUpdate,
)
from app.task_graph import (
    format_predecessor_ids,
    parse_predecessor_ids,
    strip_predecessor_references,
    validate_predecessors,
)

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _http_422(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=message
    )


@router.get("", response_model=list[TaskRead])
def list_tasks(db: Session = Depends(get_db)) -> list[Task]:
    return db.query(Task).order_by(Task.id).all()


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)) -> Task:
    data = payload.model_dump()
    raw_preds = data.pop("predecessors", None)

    task = Task(**data, predecessors=None)
    db.add(task)
    db.flush()

    try:
        task.predecessors = validate_predecessors(
            db, task_id=task.id, predecessors=raw_preds
        )
    except ValueError as exc:
        db.rollback()
        raise _http_422(str(exc)) from exc

    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(
    task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)
) -> Task:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    updates = payload.model_dump(exclude_unset=True)
    if "predecessors" in updates:
        try:
            updates["predecessors"] = validate_predecessors(
                db, task_id=task.id, predecessors=updates["predecessors"]
            )
        except ValueError as exc:
            raise _http_422(str(exc)) from exc

    for key, value in updates.items():
        setattr(task, key, value)

    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, db: Session = Depends(get_db)) -> Response:
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    strip_predecessor_references(db, task_id)
    db.delete(task)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/import", response_model=TaskImportResult)
def import_tasks(
    payload: TaskImportRequest, db: Session = Depends(get_db)
) -> TaskImportResult:
    """Append tasks with unique titles; remap file-local predecessor indices."""
    existing = db.query(Task).all()
    title_to_task: dict[str, Task] = {
        (t.title or "").strip().lower(): t for t in existing if t.title
    }
    # IDs present before this import (for predecessor fallback).
    preexisting_ids = {t.id for t in existing}

    created: list[Task] = []
    skipped: list[TaskImportSkipped] = []
    # 1-based index in the request payload → resolved DB id
    index_to_id: dict[int, int] = {}
    pending: list[tuple[int, TaskCreate, Task]] = []

    for index, item in enumerate(payload.tasks, start=1):
        key = item.title.strip().lower()
        if key in title_to_task:
            existing_task = title_to_task[key]
            index_to_id[index] = existing_task.id
            skipped.append(
                TaskImportSkipped(
                    title=item.title,
                    reason="duplicate_title",
                )
            )
            continue

        data = item.model_dump()
        data.pop("predecessors", None)
        task = Task(**data, predecessors=None)
        db.add(task)
        db.flush()
        title_to_task[key] = task
        index_to_id[index] = task.id
        created.append(task)
        pending.append((index, item, task))

    known_ids = preexisting_ids | set(index_to_id.values())

    try:
        for _index, item, task in pending:
            raw_ids = parse_predecessor_ids(item.predecessors)
            remapped: list[int] = []
            seen: set[int] = set()
            for pred in raw_ids:
                if pred in index_to_id:
                    resolved = index_to_id[pred]
                elif pred in preexisting_ids:
                    resolved = pred
                else:
                    raise ValueError(
                        f"Task «{item.title}»: unknown predecessor '{pred}' "
                        "(not a row in this file and not an existing task id)."
                    )
                if resolved == task.id:
                    raise ValueError(
                        f"Task «{item.title}»: cannot depend on itself."
                    )
                if resolved not in seen:
                    seen.add(resolved)
                    remapped.append(resolved)

            task.predecessors = format_predecessor_ids(remapped)

        # Validate cycles for each newly created task against full graph.
        for _index, _item, task in pending:
            validate_predecessors(
                db,
                task_id=task.id,
                predecessors=task.predecessors,
                known_ids=known_ids,
            )
    except ValueError as exc:
        db.rollback()
        raise _http_422(str(exc)) from exc

    db.commit()
    for task in created:
        db.refresh(task)

    return TaskImportResult(
        created=[TaskRead.model_validate(t) for t in created],
        skipped=skipped,
    )
