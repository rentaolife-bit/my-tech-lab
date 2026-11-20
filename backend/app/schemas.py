import re
import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _normalize_email(value: str) -> str:
    if not _EMAIL_RE.match(value):
        raise ValueError("invalid email address")
    return value.strip().lower()


class OTPRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _normalize_email(value)


class LoginRequest(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)

    @field_validator("email")
    @classmethod
    def check_email(cls, value: str) -> str:
        return _normalize_email(value)

    @field_validator("code")
    @classmethod
    def check_code(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("code must be digits")
        return value


class TokenPair(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_token: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class NoteCreate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)


class NoteUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    version: int | None = None


class NoteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    text: str
    version: int
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    priority: str = "medium"
    due_date: date | None = None
    note: str | None = None


class TaskUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=10000)
    priority: str | None = None
    completed: bool | None = None
    due_date: date | None = None
    note: str | None = None
    completed_at: datetime | None = None
    version: int | None = None


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    legacy_id: str | None = None
    text: str
    priority: str
    completed: bool
    due_date: date | None = None
    note: str | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    version: int


class IdeaCreate(BaseModel):
    title: str = Field(min_length=1, max_length=10000)
    content: str = Field(default="", max_length=100000)


class IdeaUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=10000)
    content: str | None = Field(default=None, max_length=100000)
    version: int | None = None


class IdeaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    legacy_id: str | None = None
    title: str
    content: str
    created_at: datetime
    updated_at: datetime
    version: int


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=10000)
    source_text: str = Field(default="", max_length=500000)
    summary: dict
    analysis_mode: str | None = None
    model: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=10000)
    source_text: str | None = Field(default=None, max_length=500000)
    summary: dict | None = None
    analysis_mode: str | None = None
    model: str | None = None
    version: int | None = None


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    legacy_id: str | None = None
    title: str
    source_text: str
    summary: dict
    analysis_mode: str | None = None
    model: str | None = None
    created_at: datetime
    updated_at: datetime
    version: int


class DailyFocusUpsert(BaseModel):
    focus_date: date
    priorities: list


class DailyFocusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    focus_date: date
    priorities: list
    created_at: datetime
    updated_at: datetime
    version: int
