import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.cli import create_owner
from app.db import SessionLocal
from app.models import AuthIdentity, User


@pytest.fixture
def db_session():
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
    except OperationalError as exc:
        session.close()
        pytest.skip(f"PostgreSQL not available: {exc}")

    try:
        yield session
    finally:
        session.rollback()
        session.close()


def test_create_owner_is_idempotent(db_session) -> None:
    # Isolate from any pre-existing data; the fixture rolls everything back.
    db_session.query(AuthIdentity).delete()
    db_session.query(User).delete()
    db_session.flush()

    user1, created1 = create_owner(db_session, "owner@example.com", "Owner")
    user2, created2 = create_owner(db_session, "owner@example.com", "Owner")

    assert created1 is True
    assert created2 is False
    assert user1.id == user2.id
    assert db_session.query(User).filter(User.is_owner.is_(True)).count() == 1
    assert db_session.query(AuthIdentity).count() == 1
