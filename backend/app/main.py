from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import AuthenticationError, AuthorizationError, seeded_auth_service
from .database import Database
from .routers import auth, sessions
from .store import ForbiddenError, NotFoundError, SessionStore


def error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"message": message})


def create_app(database_url: str | None = None) -> FastAPI:
    application = FastAPI(
        title="System Design Studio API",
        version="1.0.0",
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        redoc_url="/api/redoc",
    )
    database = Database(database_url)
    database.create_schema()
    application.state.database = database
    application.state.store = SessionStore(database)
    application.state.auth = seeded_auth_service(database)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.exception_handler(AuthenticationError)
    async def authentication_error(
        _: Request, exc: AuthenticationError
    ) -> JSONResponse:
        return error_response(status.HTTP_401_UNAUTHORIZED, str(exc))

    @application.exception_handler(AuthorizationError)
    async def authorization_error(_: Request, exc: AuthorizationError) -> JSONResponse:
        return error_response(status.HTTP_403_FORBIDDEN, str(exc))

    @application.exception_handler(ForbiddenError)
    async def forbidden_error(_: Request, exc: ForbiddenError) -> JSONResponse:
        return error_response(status.HTTP_403_FORBIDDEN, str(exc))

    @application.exception_handler(NotFoundError)
    async def not_found_error(_: Request, exc: NotFoundError) -> JSONResponse:
        return error_response(status.HTTP_404_NOT_FOUND, str(exc))

    @application.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else None
        message = (
            first.get("msg", "Request validation failed")
            if first
            else "Request validation failed"
        )
        return error_response(status.HTTP_400_BAD_REQUEST, str(message))

    application.include_router(auth.router, prefix="/api")
    application.include_router(sessions.router, prefix="/api")
    return application


app = create_app()
