import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import KnowledgeItem, KnowledgeLink, User
from ..schemas import KnowledgeItemCreate, KnowledgeItemOut, KnowledgeItemUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _replace_links(db: Session, item: KnowledgeItem, source_links: list[dict]) -> None:
    db.query(KnowledgeLink).filter(KnowledgeLink.knowledge_item_id == item.id).delete(
        synchronize_session=False
    )
    for link in source_links:
        source_type = str(link.get("source_type", "")).strip()
        source_id = str(link.get("source_id", "")).strip()
        if not source_type or not source_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="source_links must include source_type and source_id",
            )
        db.add(
            KnowledgeLink(
                knowledge_item_id=item.id,
                source_type=source_type,
                source_id=source_id,
            )
        )


@router.get("", response_model=list[KnowledgeItemOut])
def list_knowledge(db: SessionDep, user: CurrentUser) -> list[KnowledgeItem]:
    return (
        db.query(KnowledgeItem)
        .filter(KnowledgeItem.user_id == user.id, KnowledgeItem.deleted_at.is_(None))
        .order_by(KnowledgeItem.updated_at.desc())
        .all()
    )


@router.post("", response_model=KnowledgeItemOut, status_code=status.HTTP_201_CREATED)
def create_knowledge(
    payload: KnowledgeItemCreate, db: SessionDep, user: CurrentUser
) -> KnowledgeItem:
    item = KnowledgeItem(
        user_id=user.id,
        title=payload.title,
        content=payload.content,
        tags=payload.tags,
    )
    db.add(item)
    db.flush()
    _replace_links(db, item, payload.source_links)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=KnowledgeItemOut)
def update_knowledge(
    item_id: uuid.UUID,
    payload: KnowledgeItemUpdate,
    db: SessionDep,
    user: CurrentUser,
) -> KnowledgeItem:
    item = (
        db.query(KnowledgeItem)
        .filter(
            KnowledgeItem.id == item_id,
            KnowledgeItem.user_id == user.id,
            KnowledgeItem.deleted_at.is_(None),
        )
        .first()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item not found"
        )
    data = payload.model_dump(exclude_unset=True)
    if "version" in data:
        if data["version"] != item.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Version conflict"
            )
        data.pop("version")
    source_links = data.pop("source_links", None)
    for field, value in data.items():
        setattr(item, field, value)
    item.version = item.version + 1
    if source_links is not None:
        _replace_links(db, item, source_links)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge(item_id: uuid.UUID, db: SessionDep, user: CurrentUser) -> None:
    item = (
        db.query(KnowledgeItem)
        .filter(
            KnowledgeItem.id == item_id,
            KnowledgeItem.user_id == user.id,
            KnowledgeItem.deleted_at.is_(None),
        )
        .first()
    )
    if item is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge item not found"
        )
    item.deleted_at = datetime.now(UTC)
    db.commit()
