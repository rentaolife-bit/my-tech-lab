import uuid

from app.security import (
    create_access_token,
    decode_access_token,
    hash_secret,
    verify_secret,
)


def test_access_token_roundtrip() -> None:
    user_id = uuid.uuid4()
    token = create_access_token(user_id)
    assert decode_access_token(token) == user_id


def test_decode_rejects_garbage() -> None:
    assert decode_access_token("not-a-jwt") is None


def test_secret_hash_roundtrip() -> None:
    digest, salt = hash_secret("123456")
    assert verify_secret("123456", salt, digest) is True
    assert verify_secret("000000", salt, digest) is False
