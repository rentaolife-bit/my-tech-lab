import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Note, User
from ..schemas import NoteCreate, NoteOut, NoteUpdate
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/notes", tags=["notes"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[NoteOut])
def list_notes(
    db: SessionDep,
    user: CurrentUser,
) -> list[Note]:
    return (
        db.query(Note)
        .filter(Note.user_id == user.id, Note.deleted_at.is_(None))
        .order_by(Note.created_at.desc())
        .all()
    )


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: NoteCreate,
    db: SessionDep,
    user: CurrentUser,
) -> Note:
    note = Note(user_id=user.id, text=payload.text)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: uuid.UUID,
    payload: NoteUpdate,
    db: SessionDep,
    user: CurrentUser,
) -> Note:
    note = (
        db.query(Note)
        .filter(
            Note.id == note_id,
            Note.user_id == user.id,
            Note.deleted_at.is_(None),
        )
        .first()
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    if payload.version is not None and payload.version != note.version:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Version conflict"
        )
    note.text = payload.text
    note.version = note.version + 1
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: uuid.UUID,
    db: SessionDep,
    user: CurrentUser,
) -> None:
    note = (
        db.query(Note)
        .filter(
            Note.id == note_id,
            Note.user_id == user.id,
            Note.deleted_at.is_(None),
        )
        .first()
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    note.deleted_at = datetime.now(UTC)
    db.commit()
