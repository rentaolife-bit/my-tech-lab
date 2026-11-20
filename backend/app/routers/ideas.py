import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Idea, User
from ..schemas import IdeaCreate, IdeaOut, IdeaUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/ideas", tags=["ideas"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[IdeaOut])
def list_ideas(db: SessionDep, user: CurrentUser) -> list[Idea]:
    return (
        db.query(Idea)
        .filter(Idea.user_id == user.id, Idea.deleted_at.is_(None))
        .order_by(Idea.created_at.desc())
        .all()
    )


@router.post("", response_model=IdeaOut, status_code=status.HTTP_201_CREATED)
def create_idea(payload: IdeaCreate, db: SessionDep, user: CurrentUser) -> Idea:
    idea = Idea(user_id=user.id, title=payload.title, content=payload.content)
    db.add(idea)
    db.commit()
    db.refresh(idea)
    return idea


@router.patch("/{idea_id}", response_model=IdeaOut)
def update_idea(
    idea_id: uuid.UUID, payload: IdeaUpdate, db: SessionDep, user: CurrentUser
) -> Idea:
    idea = (
        db.query(Idea)
        .filter(Idea.id == idea_id, Idea.user_id == user.id, Idea.deleted_at.is_(None))
        .first()
    )
    if idea is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    data = payload.model_dump(exclude_unset=True)
    if "version" in data:
        if data["version"] != idea.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Version conflict"
            )
        data.pop("version")
    for field, value in data.items():
        setattr(idea, field, value)
    idea.version = idea.version + 1
    db.commit()
    db.refresh(idea)
    return idea


@router.delete("/{idea_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_idea(idea_id: uuid.UUID, db: SessionDep, user: CurrentUser) -> None:
    idea = (
        db.query(Idea)
        .filter(Idea.id == idea_id, Idea.user_id == user.id, Idea.deleted_at.is_(None))
        .first()
    )
    if idea is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    idea.deleted_at = datetime.now(UTC)
    db.commit()
