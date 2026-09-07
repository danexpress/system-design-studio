def test_backend_serves_static_frontend_and_spa_fallback(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    frontend = tmp_path / "frontend"
    assets = frontend / "assets"
    assets.mkdir(parents=True)
    (frontend / "index.html").write_text("<main>studio shell</main>")
    (frontend / "robots.txt").write_text("User-agent: *")
    (assets / "app.js").write_text("console.log('studio')")
    application = create_app(
        f"sqlite:///{tmp_path / 'frontend.db'}", frontend_directory=frontend
    )

    with TestClient(application) as client:
        root = client.get("/")
        nested_route = client.get("/sessions/s_live_feed?role=interviewer")
        asset = client.get("/assets/app.js")
        public_file = client.get("/robots.txt")
        unknown_api = client.get("/api/not-an-endpoint")

    assert root.status_code == 200
    assert root.text == "<main>studio shell</main>"
    assert nested_route.status_code == 200
    assert nested_route.text == "<main>studio shell</main>"
    assert nested_route.headers["cache-control"] == "no-cache"
    assert asset.text == "console.log('studio')"
    assert public_file.text == "User-agent: *"
    assert unknown_api.status_code == 404
    assert unknown_api.json() == {"message": "API endpoint not found"}


def test_missing_frontend_build_keeps_api_only_mode(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    application = create_app(
        f"sqlite:///{tmp_path / 'api-only.db'}",
        frontend_directory=tmp_path / "missing",
    )

    with TestClient(application) as client:
        assert client.get("/").status_code == 404
        assert client.get("/api/openapi.json").status_code == 200
