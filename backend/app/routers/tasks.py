import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Task, User
from ..schemas import TaskCreate, TaskOut, TaskUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _get_task(db: Session, task_id: uuid.UUID, user_id: uuid.UUID) -> Task | None:
    return (
        db.query(Task)
        .filter(Task.id == task_id, Task.user_id == user_id, Task.deleted_at.is_(None))
        .first()
    )


@router.get("", response_model=list[TaskOut])
def list_tasks(db: SessionDep, user: CurrentUser) -> list[Task]:
    return (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.deleted_at.is_(None))
        .order_by(Task.created_at.asc())
        .all()
    )


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: SessionDep, user: CurrentUser) -> Task:
    task = Task(
        user_id=user.id,
        text=payload.text,
        priority=payload.priority,
        due_date=payload.due_date,
        note=payload.note,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    task_id: uuid.UUID, payload: TaskUpdate, db: SessionDep, user: CurrentUser
) -> Task:
    task = _get_task(db, task_id, user.id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    if "version" in data:
        if data["version"] != task.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Version conflict"
            )
        data.pop("version")
    for field, value in data.items():
        setattr(task, field, value)
    task.version = task.version + 1
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: uuid.UUID, db: SessionDep, user: CurrentUser) -> None:
    task = _get_task(db, task_id, user.id)
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    task.deleted_at = datetime.now(UTC)
    db.commit()
