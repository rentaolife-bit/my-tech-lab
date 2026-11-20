from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    DailyFocusEntry,
    DocumentSummary,
    Idea,
    Note,
    Task,
    User,
    UserPreferences,
)
from ..schemas import (
    DailyFocusOut,
    DocumentOut,
    IdeaOut,
    NoteOut,
    TaskOut,
)
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/data-center", tags=["data-center"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/export")
def export_data(db: SessionDep, user: CurrentUser) -> dict:
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user.id, Task.deleted_at.is_(None))
        .all()
    )
    notes = (
        db.query(Note)
        .filter(Note.user_id == user.id, Note.deleted_at.is_(None))
        .all()
    )
    ideas = (
        db.query(Idea)
        .filter(Idea.user_id == user.id, Idea.deleted_at.is_(None))
        .all()
    )
    documents = (
        db.query(DocumentSummary)
        .filter(DocumentSummary.user_id == user.id, DocumentSummary.deleted_at.is_(None))
        .all()
    )
    daily_focus = (
        db.query(DailyFocusEntry)
        .filter(DailyFocusEntry.user_id == user.id)
        .order_by(DailyFocusEntry.focus_date.asc())
        .all()
    )
    preferences = db.get(UserPreferences, user.id)

    return {
        "schemaVersion": 1,
        "exportedAt": datetime.now(UTC).isoformat(),
        "tasks": [TaskOut.model_validate(item).model_dump(mode="json") for item in tasks],
        "notes": [NoteOut.model_validate(item).model_dump(mode="json") for item in notes],
        "ideas": [IdeaOut.model_validate(item).model_dump(mode="json") for item in ideas],
        "documents": [
            DocumentOut.model_validate(item).model_dump(mode="json") for item in documents
        ],
        "dailyFocus": [
            DailyFocusOut.model_validate(item).model_dump(mode="json")
            for item in daily_focus
        ],
        "preferences": (
            {"enabled_by_id": preferences.enabled_by_id, "schema_version": preferences.schema_version}
            if preferences is not None
            else None
        ),
    }
