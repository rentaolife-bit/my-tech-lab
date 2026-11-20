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
        yield {"Authorization": f"Bearer {response.json()['access_token']}"}
    app.dependency_overrides.clear()


def test_knowledge_item_crud_with_links(auth_headers) -> None:
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/knowledge",
            json={
                "title": "一篇知识",
                "content": "# 正文\nMarkdown 内容",
                "tags": ["研究", "笔记"],
                "source_links": [{"source_type": "note", "source_id": "n1"}],
            },
            headers=auth_headers,
        )
        assert created.status_code == 201
        item = created.json()
        assert item["title"] == "一篇知识"
        assert item["tags"] == ["研究", "笔记"]
        assert item["links"][0]["source_id"] == "n1"

        updated = client.patch(
            f"/api/v1/knowledge/{item['id']}",
            json={"tags": ["研究"], "version": item["version"]},
            headers=auth_headers,
        )
        assert updated.status_code == 200
        assert updated.json()["tags"] == ["研究"]

        deleted = client.delete(
            f"/api/v1/knowledge/{item['id']}", headers=auth_headers
        )
        assert deleted.status_code == 204
