from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DailyFocusEntry, User
from ..schemas import DailyFocusOut, DailyFocusUpsert
from ..security import get_current_user

router = APIRouter(prefix="/api/v1/daily-focus", tags=["daily-focus"])

SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[DailyFocusOut])
def list_daily_focus(db: SessionDep, user: CurrentUser) -> list[DailyFocusEntry]:
    return (
        db.query(DailyFocusEntry)
        .filter(DailyFocusEntry.user_id == user.id)
        .order_by(DailyFocusEntry.focus_date.desc())
        .all()
    )


@router.get("/{focus_date}", response_model=DailyFocusOut)
def get_daily_focus(
    focus_date: date, db: SessionDep, user: CurrentUser
) -> DailyFocusEntry:
    entry = (
        db.query(DailyFocusEntry)
        .filter(
            DailyFocusEntry.user_id == user.id,
            DailyFocusEntry.focus_date == focus_date,
        )
        .first()
    )
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Daily focus not found"
        )
    return entry


@router.put("/{focus_date}", response_model=DailyFocusOut)
def upsert_daily_focus(
    focus_date: date, payload: DailyFocusUpsert, db: SessionDep, user: CurrentUser
) -> DailyFocusEntry:
    entry = (
        db.query(DailyFocusEntry)
        .filter(
            DailyFocusEntry.user_id == user.id,
            DailyFocusEntry.focus_date == focus_date,
        )
        .first()
    )
    if entry is None:
        entry = DailyFocusEntry(
            user_id=user.id, focus_date=focus_date, priorities=payload.priorities
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return entry
    entry.priorities = payload.priorities
    entry.version = entry.version + 1
    db.commit()
    db.refresh(entry)
    return entry
