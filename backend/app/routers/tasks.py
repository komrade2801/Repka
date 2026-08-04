from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Task
from app.schemas import TaskBulkCreate, TaskRead

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskRead])
def list_tasks(db: Session = Depends(get_db)) -> list[Task]:
    return db.query(Task).order_by(Task.id).all()


@router.post("/bulk", response_model=list[TaskRead])
def bulk_create_tasks(payload: TaskBulkCreate, db: Session = Depends(get_db)) -> list[Task]:
    """Replace all tasks with the uploaded Excel payload.

    Tasks get sequential IDs starting at 1 so Excel `predecessors`
    can reference row order (1-based).
    """
    db.query(Task).delete()
    db.flush()

    tasks = [
        Task(id=index, **item.model_dump())
        for index, item in enumerate(payload.tasks, start=1)
    ]
    db.add_all(tasks)
    db.commit()
    for task in tasks:
        db.refresh(task)
    return tasks
