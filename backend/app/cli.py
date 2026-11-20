import argparse

from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import AuthIdentity, User


def create_owner(
    db: Session, email: str, display_name: str | None = None
) -> tuple[User, bool]:
    """Create the single Owner user and bind an email identity (idempotent).

    Returns ``(user, created)``. Does not commit; the caller owns the transaction.
    """
    normalized_email = email.strip().lower()
    existing = db.query(User).filter(User.is_owner.is_(True)).first()
    if existing is not None:
        return existing, False

    user = User(
        is_owner=True,
        username=normalized_email,
        display_name=display_name or normalized_email,
    )
    db.add(user)
    db.flush()
    db.add(
        AuthIdentity(
            user_id=user.id,
            provider="email",
            provider_sub=normalized_email,
        )
    )
    db.flush()
    return user, True


def bootstrap_owner(email: str, display_name: str | None = None) -> None:
    with SessionLocal() as db:
        user, created = create_owner(db, email, display_name)
        db.commit()
        action = "Created owner" if created else "Owner already exists"
        print(
            f"{action}: user_id={user.id} "
            f"identity=email:{user.username}"
        )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="bootstrap-owner",
        description="Create the single Owner account (idempotent, run on the server only).",
    )
    parser.add_argument("--email", required=True, help="Owner email used for OTP login")
    parser.add_argument("--display-name", default=None, help="Optional display name")
    args = parser.parse_args(argv)
    bootstrap_owner(args.email, args.display_name)


if __name__ == "__main__":
    main()
