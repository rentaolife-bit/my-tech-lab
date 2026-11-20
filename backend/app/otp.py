import secrets
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Protocol

from sqlalchemy.orm import Session

from .config import get_settings
from .models import AuthIdentity, OTPCode, User
from .security import hash_secret, verify_secret


class OTPDelivery(Protocol):
    def send(self, email: str, code: str) -> None: ...


class ConsoleOTPDelivery:
    def send(self, email: str, code: str) -> None:
        print(f"[dev-otp] code for {email}: {code}")


class SMTPOTPDelivery:
    def send(self, email: str, code: str) -> None:
        settings = get_settings()
        message = EmailMessage()
        message["Subject"] = "My Tech Lab 登录验证码"
        message["From"] = settings.smtp_from
        message["To"] = email
        message.set_content(
            f"你的登录验证码是：{code}，{settings.otp_ttl_seconds // 60} 分钟内有效。"
        )
        if settings.smtp_use_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.starttls()
                smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.login(settings.smtp_user, settings.smtp_password)
                smtp.send_message(message)


def get_otp_delivery() -> OTPDelivery:
    settings = get_settings()
    if settings.otp_sender == "smtp":
        return SMTPOTPDelivery()
    return ConsoleOTPDelivery()


def generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def issue_otp(db: Session, email: str, delivery: OTPDelivery) -> None:
    settings = get_settings()
    normalized = email.strip().lower()
    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == "email",
            AuthIdentity.provider_sub == normalized,
        )
        .first()
    )
    if identity is None:
        return  # Do not reveal whether the email is registered.

    now = datetime.now(UTC)
    db.query(OTPCode).filter(
        OTPCode.user_id == identity.user_id,
        OTPCode.consumed_at.is_(None),
        OTPCode.expires_at > now,
    ).update({"consumed_at": now}, synchronize_session=False)

    code = generate_otp()
    code_hash, salt = hash_secret(code)
    db.add(
        OTPCode(
            user_id=identity.user_id,
            code_hash=code_hash,
            salt=salt,
            expires_at=now + timedelta(seconds=settings.otp_ttl_seconds),
        )
    )
    db.commit()
    delivery.send(normalized, code)


def verify_otp(db: Session, email: str, code: str) -> User | None:
    settings = get_settings()
    normalized = email.strip().lower()
    now = datetime.now(UTC)
    identity = (
        db.query(AuthIdentity)
        .filter(
            AuthIdentity.provider == "email",
            AuthIdentity.provider_sub == normalized,
        )
        .first()
    )
    if identity is None:
        return None

    row = (
        db.query(OTPCode)
        .filter(
            OTPCode.user_id == identity.user_id,
            OTPCode.consumed_at.is_(None),
            OTPCode.expires_at > now,
        )
        .order_by(OTPCode.created_at.desc())
        .first()
    )
    if row is None:
        return None

    if row.attempts >= settings.otp_max_attempts:
        row.consumed_at = now
        db.commit()
        return None

    if not verify_secret(code, row.salt, row.code_hash):
        row.attempts += 1
        db.commit()
        return None

    row.consumed_at = now
    db.commit()
    return db.get(User, identity.user_id)
