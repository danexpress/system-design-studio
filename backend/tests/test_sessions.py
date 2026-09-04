from datetime import UTC, datetime, timedelta


def create_payload():
    return {
        "title": "Design a rate limiter",
        "prompt": "Design a globally distributed rate limiter.",
        "difficulty": "senior",
        "durationMinutes": 60,
        "candidateName": "Grace Hopper",
        "candidateEmail": "grace@example.com",
        "scheduledFor": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
    }


def test_seed_data_matches_frontend_shape(client, interviewer_headers):
    response = client.get("/api/sessions", headers=interviewer_headers)
    assert response.status_code == 200
    sessions = response.json()
    assert {item["status"] for item in sessions} == {"scheduled", "live", "ended"}
    live = next(item for item in sessions if item["status"] == "live")
    assert live["candidateEmail"] == "candidate@example.com"
    assert live["canvas"]["revision"] == 12
    assert live["share"]["token"] == "shr_feed_9m2k"


def test_create_start_and_end_session(client, interviewer_headers):
    created_response = client.post(
        "/api/sessions", json=create_payload(), headers=interviewer_headers
    )
    assert created_response.status_code == 201
    created = created_response.json()
    assert created["status"] == "scheduled"
    assert created["share"] is None

    started = client.post(
        f"/api/sessions/{created['id']}/start", headers=interviewer_headers
    )
    assert started.status_code == 200
    assert started.json()["status"] == "live"
    assert started.json()["startedAt"] is not None

    ended = client.post(
        f"/api/sessions/{created['id']}/end", headers=interviewer_headers
    )
    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"
    assert ended.json()["candidateCanEdit"] is False
    assert all(
        not participant["online"] for participant in ended.json()["participants"]
    )


def test_invalid_lifecycle_and_unknown_session_errors(client, interviewer_headers):
    cannot_end = client.post(
        "/api/sessions/s_scheduled_shortener/end", headers=interviewer_headers
    )
    assert cannot_end.status_code == 403
    assert cannot_end.json() == {"message": "Only a live session can be ended"}

    missing = client.get("/api/sessions/not-there", headers=interviewer_headers)
    assert missing.status_code == 404
    assert missing.json() == {"message": "Session not-there not found"}


def test_validation_errors_use_the_contract_error_shape(client, interviewer_headers):
    payload = create_payload()
    payload["candidateEmail"] = "not-an-email"
    response = client.post("/api/sessions", json=payload, headers=interviewer_headers)
    assert response.status_code == 400
    assert set(response.json()) == {"message"}


def test_share_link_create_resolve_and_revoke(client, interviewer_headers):
    created = client.post(
        "/api/sessions/s_scheduled_shortener/share-link", headers=interviewer_headers
    )
    assert created.status_code == 200
    token = created.json()["share"]["token"]

    public_lookup = client.get(f"/api/invites/{token}")
    assert public_lookup.status_code == 200
    assert public_lookup.json()["id"] == "s_scheduled_shortener"

    revoked = client.delete(
        "/api/sessions/s_scheduled_shortener/share-link", headers=interviewer_headers
    )
    assert revoked.status_code == 200
    assert revoked.json()["share"]["revokedAt"] is not None
    assert client.get(f"/api/invites/{token}").status_code == 403


def test_revoke_missing_share_link_returns_404(client, interviewer_headers):
    response = client.delete(
        "/api/sessions/s_scheduled_shortener/share-link", headers=interviewer_headers
    )
    assert response.status_code == 404
    assert response.json() == {"message": "No share link to revoke"}
