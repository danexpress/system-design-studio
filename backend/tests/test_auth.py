from app.database import UserRecord
from app.models import Role


def test_seeded_passwords_are_hashed(app):
    with app.state.database.session() as database_session:
        user = database_session.get(UserRecord, "interviewer@example.com")
        assert user is not None
        assert user.password_hash != "interviewer-password"
        assert user.password_hash.startswith("$argon2")


def test_login_returns_a_working_bearer_token(client):
    login = client.post(
        "/api/auth/token",
        json={"email": "interviewer@example.com", "password": "interviewer-password"},
    )
    assert login.status_code == 200
    assert login.json()["tokenType"] == "bearer"

    token = login.json()["accessToken"]
    sessions = client.get("/api/sessions", headers={"Authorization": f"Bearer {token}"})
    assert sessions.status_code == 200
    assert len(sessions.json()) == 3


def test_invalid_credentials_and_missing_token_are_rejected(client):
    invalid = client.post(
        "/api/auth/token",
        json={"email": "interviewer@example.com", "password": "wrong"},
    )
    assert invalid.status_code == 401
    assert invalid.json() == {"message": "Invalid email or password"}

    missing = client.get("/api/sessions")
    assert missing.status_code == 401
    assert "bearer" in missing.json()["message"].lower()


def test_candidate_cannot_use_interviewer_endpoint(client, candidate_headers):
    response = client.get("/api/sessions", headers=candidate_headers)
    assert response.status_code == 403
    assert response.json() == {"message": "Interviewer access is required"}


def test_token_contains_authenticated_role(app):
    principal = app.state.auth.authenticate(
        "candidate@example.com", "candidate-password"
    )
    decoded = app.state.auth.decode_token(app.state.auth.issue_token(principal))
    assert decoded.role is Role.CANDIDATE
    assert decoded.email == "candidate@example.com"
