import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DocumentSummary, User
from ..schemas import DocumentCreate, DocumentOut, DocumentUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[DocumentOut])
def list_documents(db: SessionDep, user: CurrentUser) -> list[DocumentSummary]:
    return (
        db.query(DocumentSummary)
        .filter(DocumentSummary.user_id == user.id, DocumentSummary.deleted_at.is_(None))
        .order_by(DocumentSummary.created_at.desc())
        .all()
    )


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate, db: SessionDep, user: CurrentUser
) -> DocumentSummary:
    document = DocumentSummary(
        user_id=user.id,
        title=payload.title,
        source_text=payload.source_text,
        summary=payload.summary,
        analysis_mode=payload.analysis_mode,
        model=payload.model,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: uuid.UUID,
    payload: DocumentUpdate,
    db: SessionDep,
    user: CurrentUser,
) -> DocumentSummary:
    document = (
        db.query(DocumentSummary)
        .filter(
            DocumentSummary.id == document_id,
            DocumentSummary.user_id == user.id,
            DocumentSummary.deleted_at.is_(None),
        )
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    data = payload.model_dump(exclude_unset=True)
    if "version" in data:
        if data["version"] != document.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Version conflict"
            )
        data.pop("version")
    for field, value in data.items():
        setattr(document, field, value)
    document.version = document.version + 1
    db.commit()
    db.refresh(document)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: uuid.UUID, db: SessionDep, user: CurrentUser
) -> None:
    document = (
        db.query(DocumentSummary)
        .filter(
            DocumentSummary.id == document_id,
            DocumentSummary.user_id == user.id,
            DocumentSummary.deleted_at.is_(None),
        )
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )
    document.deleted_at = datetime.now(UTC)
    db.commit()
