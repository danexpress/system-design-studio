from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

pytestmark = pytest.mark.integration
BASE_URL = os.getenv("INTEGRATION_BASE_URL", "http://127.0.0.1:18083").rstrip("/")
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def client():
    with httpx.Client(base_url=BASE_URL, timeout=10) as api_client:
        yield api_client


def authenticate(client: httpx.Client, email: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/token", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


@pytest.fixture(scope="module")
def interviewer_headers(client):
    return authenticate(client, "interviewer@example.com", "interviewer-password")


@pytest.fixture(scope="module")
def candidate_headers(client):
    return authenticate(client, "candidate@example.com", "candidate-password")


def new_session_payload(title: str) -> dict:
    return {
        "title": title,
        "prompt": "Design a database-backed distributed workflow processing platform.",
        "difficulty": "senior",
        "durationMinutes": 60,
        "candidateName": "Ada Lovelace",
        "candidateEmail": "ada@example.com",
        "scheduledFor": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
    }


def test_container_health_frontend_and_spa_fallback(client):
    schema = client.get("/api/openapi.json")
    root = client.get("/")
    spa_route = client.get("/sessions/new")

    assert schema.status_code == 200
    assert schema.json()["info"]["title"] == "System Design Studio API"
    assert root.status_code == 200
    assert '<div id="root"></div>' in root.text
    assert spa_route.status_code == 200
    assert spa_route.text == root.text
    assert spa_route.headers["cache-control"] == "no-cache"


def test_authentication_and_role_authorization(client, candidate_headers):
    invalid = client.post(
        "/api/auth/token",
        json={"email": "interviewer@example.com", "password": "incorrect"},
    )
    missing = client.get("/api/sessions")
    candidate_dashboard = client.get("/api/sessions", headers=candidate_headers)

    assert invalid.status_code == 401
    assert missing.status_code == 401
    assert candidate_dashboard.status_code == 403


def test_postgres_is_seeded(client, interviewer_headers):
    response = client.get("/api/sessions", headers=interviewer_headers)

    assert response.status_code == 200
    sessions = response.json()
    assert {session["status"] for session in sessions} == {"scheduled", "live", "ended"}
    assert any(session["id"] == "s_live_feed" for session in sessions)


def test_session_invitation_and_lifecycle(client, interviewer_headers):
    title = f"Compose lifecycle {uuid4().hex}"
    created = client.post(
        "/api/sessions", headers=interviewer_headers, json=new_session_payload(title)
    )
    assert created.status_code == 201, created.text
    session_id = created.json()["id"]

    shared = client.post(
        f"/api/sessions/{session_id}/share-link", headers=interviewer_headers
    )
    assert shared.status_code == 200
    token = shared.json()["share"]["token"]
    public_invite = client.get(f"/api/invites/{token}")
    assert public_invite.status_code == 200
    assert public_invite.json()["id"] == session_id

    started = client.post(
        f"/api/sessions/{session_id}/start", headers=interviewer_headers
    )
    ended = client.post(f"/api/sessions/{session_id}/end", headers=interviewer_headers)
    assert started.status_code == 200
    assert started.json()["status"] == "live"
    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"
    assert ended.json()["share"]["revokedAt"] is not None
    assert client.get(f"/api/invites/{token}").status_code == 403


def test_candidate_canvas_permissions(client, interviewer_headers, candidate_headers):
    session = client.get("/api/sessions/s_live_feed", headers=candidate_headers).json()
    original_revision = session["canvas"]["revision"]
    saved = client.put(
        "/api/sessions/s_live_feed/canvas",
        headers=candidate_headers,
        json={"canvas": session["canvas"], "actor": "candidate"},
    )
    assert saved.status_code == 200
    assert saved.json()["canvas"]["revision"] == original_revision + 1

    locked = client.patch(
        "/api/sessions/s_live_feed/candidate-editing",
        headers=interviewer_headers,
        json={"canEdit": False},
    )
    denied = client.put(
        "/api/sessions/s_live_feed/canvas",
        headers=candidate_headers,
        json={"canvas": saved.json()["canvas"], "actor": "candidate"},
    )
    assert locked.status_code == 200
    assert denied.status_code == 403

    client.patch(
        "/api/sessions/s_live_feed/candidate-editing",
        headers=interviewer_headers,
        json={"canEdit": True},
    )


def test_realtime_stream_emits_mutations(client, interviewer_headers):
    stream_opened = threading.Event()

    def read_update() -> str:
        with httpx.stream(
            "GET",
            f"{BASE_URL}/api/sessions/s_live_feed/events",
            headers=interviewer_headers,
            timeout=10,
        ) as response:
            assert response.status_code == 200
            stream_opened.set()
            for line in response.iter_lines():
                if line.startswith("data:"):
                    return line
        raise AssertionError("Event stream ended without a session update")

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(read_update)
        stream_opened.wait(timeout=1)
        time.sleep(0.1)
        response = client.patch(
            "/api/sessions/s_live_feed/candidate-editing",
            headers=interviewer_headers,
            json={"canEdit": False},
        )
        assert response.status_code == 200
        event = future.result(timeout=10)

    payload = json.loads(event.removeprefix("data:").strip())
    assert payload["type"] == "session:updated"
    assert payload["session"]["candidateCanEdit"] is False
    client.patch(
        "/api/sessions/s_live_feed/candidate-editing",
        headers=interviewer_headers,
        json={"canEdit": True},
    )


def test_postgres_data_survives_app_restart(client, interviewer_headers):
    title = f"Compose persistence {uuid4().hex}"
    created = client.post(
        "/api/sessions", headers=interviewer_headers, json=new_session_payload(title)
    )
    assert created.status_code == 201
    session_id = created.json()["id"]

    project = os.environ["INTEGRATION_COMPOSE_PROJECT"]
    subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            str(REPOSITORY_ROOT / "docker-compose.yaml"),
            "-p",
            project,
            "restart",
            "app",
        ],
        check=True,
        cwd=REPOSITORY_ROOT,
    )

    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            if client.get("/api/openapi.json").status_code == 200:
                break
        except httpx.TransportError:
            pass
        time.sleep(0.25)
    else:
        pytest.fail("App did not become ready after restart")

    refreshed_headers = authenticate(
        client, "interviewer@example.com", "interviewer-password"
    )
    persisted = client.get(f"/api/sessions/{session_id}", headers=refreshed_headers)
    assert persisted.status_code == 200
    assert persisted.json()["title"] == title
