import asyncio


def get_live(client, headers):
    response = client.get("/api/sessions/s_live_feed", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_candidate_can_read_assigned_session_but_not_another(client, candidate_headers):
    assert (
        client.get("/api/sessions/s_live_feed", headers=candidate_headers).status_code
        == 200
    )
    denied = client.get(
        "/api/sessions/s_scheduled_shortener", headers=candidate_headers
    )
    assert denied.status_code == 403


def test_join_and_leave_updates_presence(client, candidate_headers):
    joined = client.post(
        "/api/sessions/s_live_feed/participants",
        json={"name": "Amara Boateng", "role": "candidate"},
        headers=candidate_headers,
    )
    assert joined.status_code == 200
    participant = next(
        item
        for item in joined.json()["participants"]
        if item["name"] == "Amara Boateng"
    )
    assert participant["online"] is True

    left = client.delete(
        f"/api/sessions/s_live_feed/participants/{participant['id']}",
        headers=candidate_headers,
    )
    assert left.status_code == 200
    updated = next(
        item for item in left.json()["participants"] if item["id"] == participant["id"]
    )
    assert updated["online"] is False


def test_client_supplied_role_cannot_escalate_privileges(client, candidate_headers):
    join = client.post(
        "/api/sessions/s_live_feed/participants",
        json={"name": "Amara Boateng", "role": "interviewer"},
        headers=candidate_headers,
    )
    assert join.status_code == 403

    session = get_live(client, candidate_headers)
    save = client.put(
        "/api/sessions/s_live_feed/canvas",
        json={"canvas": session["canvas"], "actor": "interviewer"},
        headers=candidate_headers,
    )
    assert save.status_code == 403


def test_candidate_canvas_permissions_and_revision(
    client, interviewer_headers, candidate_headers
):
    session = get_live(client, candidate_headers)
    original_revision = session["canvas"]["revision"]
    saved = client.put(
        "/api/sessions/s_live_feed/canvas",
        json={"canvas": session["canvas"], "actor": "candidate"},
        headers=candidate_headers,
    )
    assert saved.status_code == 200
    assert saved.json()["canvas"]["revision"] == original_revision + 1

    locked = client.patch(
        "/api/sessions/s_live_feed/candidate-editing",
        json={"canEdit": False},
        headers=interviewer_headers,
    )
    assert locked.status_code == 200
    denied = client.put(
        "/api/sessions/s_live_feed/canvas",
        json={"canvas": saved.json()["canvas"], "actor": "candidate"},
        headers=candidate_headers,
    )
    assert denied.status_code == 403
    assert "locked" in denied.json()["message"].lower()


def test_feedback_is_interviewer_only(client, interviewer_headers, candidate_headers):
    payload = {
        "notes": "Strong trade-off analysis.",
        "scores": {"communication": 5, "tradeoffs": 5, "scalability": 4, "depth": 4},
        "recommendation": "hire",
    }
    denied = client.put(
        "/api/sessions/s_live_feed/feedback", json=payload, headers=candidate_headers
    )
    assert denied.status_code == 403

    saved = client.put(
        "/api/sessions/s_live_feed/feedback", json=payload, headers=interviewer_headers
    )
    assert saved.status_code == 200
    assert saved.json()["feedback"]["recommendation"] == "hire"
    assert saved.json()["feedback"]["updatedAt"] is not None


def test_store_subscription_receives_complete_session_snapshot(app):
    store = app.state.store

    async def scenario():
        with store.subscribe("s_live_feed") as queue:
            store.set_candidate_editing("s_live_feed", False)
            update = await asyncio.wait_for(queue.get(), timeout=0.2)
            assert update.id == "s_live_feed"
            assert update.candidate_can_edit is False

    asyncio.run(scenario())
