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
def auth_headers():
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
    except OperationalError as exc:
        session.close()
        pytest.skip(f"PostgreSQL not available: {exc}")

    create_owner(session, "owner@example.com", "Owner")
    session.commit()
    session.close()

    delivery = CapturingDelivery()
    app.dependency_overrides[get_otp_delivery] = lambda: delivery
    with TestClient(app) as client:
        client.post("/api/v1/auth/otp/request", json={"email": "owner@example.com"})
        code = delivery.codes[-1][1]
        response = client.post(
            "/api/v1/auth/login",
            json={"email": "owner@example.com", "code": code},
        )
        token = response.json()["access_token"]
        yield {"Authorization": f"Bearer {token}"}
    app.dependency_overrides.clear()


def test_task_crud(auth_headers) -> None:
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/tasks", json={"text": "写一篇周报"}, headers=auth_headers
        )
        assert created.status_code == 201
        task = created.json()
        assert task["completed"] is False

        updated = client.patch(
            f"/api/v1/tasks/{task['id']}",
            json={"completed": True, "version": task["version"]},
            headers=auth_headers,
        )
        assert updated.status_code == 200
        assert updated.json()["completed"] is True

        deleted = client.delete(f"/api/v1/tasks/{task['id']}", headers=auth_headers)
        assert deleted.status_code == 204


def test_idea_and_document_crud(auth_headers) -> None:
    with TestClient(app) as client:
        idea = client.post(
            "/api/v1/ideas", json={"title": "灵感", "content": "一个想法"}, headers=auth_headers
        ).json()
        assert idea["title"] == "灵感"

        document = client.post(
            "/api/v1/documents",
            json={
                "title": "资料",
                "source_text": "原文",
                "summary": {"executive": "摘要"},
            },
            headers=auth_headers,
        ).json()
        assert document["summary"]["executive"] == "摘要"

        assert client.delete(f"/api/v1/ideas/{idea['id']}", headers=auth_headers).status_code == 204
        assert client.delete(f"/api/v1/documents/{document['id']}", headers=auth_headers).status_code == 204


def test_daily_focus_upsert_and_export(auth_headers) -> None:
    with TestClient(app) as client:
        focus_date = "2026-11-20"
        put = client.put(
            f"/api/v1/daily-focus/{focus_date}",
            json={"focus_date": focus_date, "priorities": ["a", "b", "c"]},
            headers=auth_headers,
        )
        assert put.status_code == 200
        assert put.json()["priorities"] == ["a", "b", "c"]

        export = client.get("/api/v1/data-center/export", headers=auth_headers)
        assert export.status_code == 200
        payload = export.json()
        for key in ("tasks", "notes", "ideas", "documents", "dailyFocus", "preferences"):
            assert key in payload
