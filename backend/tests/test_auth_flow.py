import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.cli import create_owner
from app.db import SessionLocal
from app.main import app
from app.otp import get_otp_delivery


class CapturingDelivery:
    def __init__(self) -> None:
        self.codes: list[tuple[str, str]] = []

    def send(self, email: str, code: str) -> None:
        self.codes.append((email, code))


@pytest.fixture
def client():
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
    except OperationalError as exc:
        session.close()
        pytest.skip(f"PostgreSQL not available: {exc}")

    # Ensure a single owner exists for the integration flow.
    create_owner(session, "owner@example.com", "Owner")
    session.commit()
    session.close()

    delivery = CapturingDelivery()
    app.dependency_overrides[get_otp_delivery] = lambda: delivery
    with TestClient(app) as test_client:
        yield test_client, delivery
    app.dependency_overrides.clear()


def test_full_auth_and_notes_flow(client) -> None:
    test_client, delivery = client

    # Request an OTP and read the delivered code.
    response = test_client.post("/api/v1/auth/otp/request", json={"email": "owner@example.com"})
    assert response.status_code == 202
    assert len(delivery.codes) == 1
    code = delivery.codes[0][1]

    # Unauthenticated access is rejected.
    assert test_client.get("/api/v1/notes").status_code == 401

    # Login with the code.
    response = test_client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "code": code},
    )
    assert response.status_code == 200
    tokens = response.json()
    headers = {"Authorization": f"Bearer {tokens['access_token']}"}

    # Create, list, update and delete a note as the owner.
    response = test_client.post("/api/v1/notes", json={"text": "第一条笔记"}, headers=headers)
    assert response.status_code == 201
    note = response.json()
    assert note["text"] == "第一条笔记"

    response = test_client.get("/api/v1/notes", headers=headers)
    assert response.status_code == 200
    assert any(item["id"] == note["id"] for item in response.json())

    response = test_client.patch(
        f"/api/v1/notes/{note['id']}",
        json={"text": "已更新", "version": note["version"]},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["text"] == "已更新"
    assert response.json()["version"] == note["version"] + 1

    response = test_client.delete(f"/api/v1/notes/{note['id']}", headers=headers)
    assert response.status_code == 204

    # Refresh and logout close the session loop.
    response = test_client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 200
    refreshed = response.json()

    response = test_client.post(
        "/api/v1/auth/logout", json={"refresh_token": refreshed["refresh_token"]}
    )
    assert response.status_code == 204
