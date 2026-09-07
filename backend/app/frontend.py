from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles


def resolve_frontend_directory(configured: str | Path | None = None) -> Path:
    if configured is not None:
        return Path(configured).resolve()
    environment_path = os.getenv("FRONTEND_DIST_DIR")
    if environment_path:
        return Path(environment_path).resolve()
    return (Path(__file__).resolve().parents[2] / "frontend" / "dist").resolve()


def serve_frontend(application: FastAPI, configured: str | Path | None = None) -> None:
    directory = resolve_frontend_directory(configured)
    index = directory / "index.html"
    application.state.frontend_directory = directory
    if not index.is_file():
        return

    assets = directory / "assets"
    if assets.is_dir():
        application.mount(
            "/assets", StaticFiles(directory=assets), name="frontend-assets"
        )

    @application.get("/{full_path:path}", include_in_schema=False)
    async def frontend_fallback(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            return JSONResponse(
                status_code=404, content={"message": "API endpoint not found"}
            )

        requested = (directory / full_path).resolve()
        if requested.is_relative_to(directory) and requested.is_file():
            return FileResponse(requested)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
