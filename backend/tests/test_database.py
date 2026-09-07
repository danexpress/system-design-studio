from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.database import Database, SessionRecord, UserRecord, normalize_database_url
from app.main import create_app


def login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/token",
        json={
            "email": "interviewer@example.com",
            "password": "interviewer-password",
        },
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_database_url_comes_from_environment(monkeypatch, tmp_path):
    url = f"sqlite:///{tmp_path / 'configured.db'}"
    monkeypatch.setenv("DATABASE_URL", url)

    application = create_app()

    assert application.state.database.url == url
    with application.state.database.session() as database_session:
        assert database_session.get(SessionRecord, "s_live_feed") is not None
        assert database_session.get(UserRecord, "interviewer@example.com") is not None


def test_data_persists_across_application_instances(tmp_path):
    url = f"sqlite:///{tmp_path / 'persistent.db'}"
    first_app = create_app(url)
    with TestClient(first_app) as first_client:
        headers = login(first_client)
        response = first_client.post(
            "/api/sessions",
            headers=headers,
            json={
                "title": "Persistent interview",
                "prompt": "Design a durable workflow processing service.",
                "difficulty": "senior",
                "durationMinutes": 60,
                "candidateName": "Ada Lovelace",
                "candidateEmail": "ada@example.com",
                "scheduledFor": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
            },
        )
        assert response.status_code == 201
        session_id = response.json()["id"]

    second_app = create_app(url)
    with TestClient(second_app) as second_client:
        headers = login(second_client)
        response = second_client.get(f"/api/sessions/{session_id}", headers=headers)

    assert response.status_code == 200
    assert response.json()["title"] == "Persistent interview"


def test_postgres_urls_use_the_psycopg_3_dialect():
    assert normalize_database_url("postgres://user:pass@db/studio") == (
        "postgresql+psycopg://user:pass@db/studio"
    )
    assert normalize_database_url("postgresql://user:pass@db/studio") == (
        "postgresql+psycopg://user:pass@db/studio"
    )

    database = Database("postgresql://user:pass@localhost/studio")
    try:
        assert database.engine.dialect.name == "postgresql"
        assert database.engine.dialect.driver == "psycopg"
    finally:
        database.engine.dispose()
