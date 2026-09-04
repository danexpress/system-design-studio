import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def login(client: TestClient, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/token", json={"email": email, "password": password}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


@pytest.fixture
def interviewer_headers(client):
    return login(client, "interviewer@example.com", "interviewer-password")


@pytest.fixture
def candidate_headers(client):
    return login(client, "candidate@example.com", "candidate-password")
