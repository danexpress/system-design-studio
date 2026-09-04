def test_local_frontend_preflight_allows_any_development_port(client):
    response = client.options(
        "/api/auth/token",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert "POST" in response.headers["access-control-allow-methods"]


def test_configured_nonlocal_origin_is_allowed(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    monkeypatch.setenv("CORS_ORIGINS", "https://studio.example.com")
    application = create_app(f"sqlite:///{tmp_path / 'cors.db'}")

    with TestClient(application) as test_client:
        response = test_client.options(
            "/api/auth/token",
            headers={
                "Origin": "https://studio.example.com",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"] == "https://studio.example.com"
    )
