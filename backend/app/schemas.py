import re
import uuid
from datetime import datetime

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
