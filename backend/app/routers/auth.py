from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import RefreshToken, User
from ..otp import OTPDelivery, get_otp_delivery, issue_otp, verify_otp
from ..schemas import LoginRequest, LogoutRequest, OTPRequest, RefreshRequest, TokenPair
from ..security import create_access_token, new_refresh_token, sha256_hex

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

SessionDep = Annotated[Session, Depends(get_db)]
DeliveryDep = Annotated[OTPDelivery, Depends(get_otp_delivery)]


def _issue_tokens(db: Session, user: User) -> TokenPair:
    settings = get_settings()
    access_token = create_access_token(user.id)
    raw_refresh, refresh_hash = new_refresh_token()
    now = datetime.now(UTC)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=refresh_hash,
            expires_at=now + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    db.commit()
    return TokenPair(
        access_token=access_token,
        expires_in=settings.access_token_ttl_minutes * 60,
        refresh_token=raw_refresh,
    )


@router.post("/otp/request", status_code=status.HTTP_202_ACCEPTED)
def request_otp(
    payload: OTPRequest,
    db: SessionDep,
    delivery: DeliveryDep,
) -> dict[str, str]:
    issue_otp(db, payload.email, delivery)
    return {"status": "accepted"}


@router.post("/login", response_model=TokenPair)
def login(payload: LoginRequest, db: SessionDep) -> TokenPair:
    user = verify_otp(db, payload.email, payload.code)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired code"
        )
    return _issue_tokens(db, user)


@router.post("/refresh", response_model=TokenPair)
def refresh(payload: RefreshRequest, db: SessionDep) -> TokenPair:
    now = datetime.now(UTC)
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == sha256_hex(payload.refresh_token))
        .first()
    )
    if row is None or row.revoked_at is not None or row.expires_at <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    row.revoked_at = now
    db.commit()
    return _issue_tokens(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(payload: LogoutRequest, db: SessionDep) -> None:
    row = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == sha256_hex(payload.refresh_token))
        .first()
    )
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        db.commit()
