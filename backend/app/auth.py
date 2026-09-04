from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash

from .models import Role


class AuthenticationError(Exception):
    pass


class AuthorizationError(Exception):
    pass


@dataclass(frozen=True)
class Principal:
    email: str
    name: str
    role: Role


@dataclass(frozen=True)
class User:
    email: str
    name: str
    role: Role
    password_hash: str


class AuthService:
    def __init__(self, secret: str | None = None) -> None:
        self._secret = secret or os.getenv(
            "JWT_SECRET", "development-only-secret-change-before-production"
        )
        self._algorithm = "HS256"
        self._passwords = PasswordHash.recommended()
        self._users: dict[str, User] = {}

    def add_user(self, email: str, name: str, role: Role, password: str) -> None:
        normalized = email.casefold()
        self._users[normalized] = User(
            email=normalized,
            name=name,
            role=role,
            password_hash=self._passwords.hash(password),
        )

    def authenticate(self, email: str, password: str) -> Principal:
        user = self._users.get(email.casefold())
        if user is None or not self._passwords.verify(password, user.password_hash):
            raise AuthenticationError("Invalid email or password")
        return Principal(email=user.email, name=user.name, role=user.role)

    def issue_token(
        self, principal: Principal, expires_in: timedelta = timedelta(hours=8)
    ) -> str:
        now = datetime.now(UTC)
        return jwt.encode(
            {
                "sub": principal.email,
                "name": principal.name,
                "role": principal.role.value,
                "iat": now,
                "exp": now + expires_in,
            },
            self._secret,
            algorithm=self._algorithm,
        )

    def decode_token(self, token: str) -> Principal:
        try:
            payload = jwt.decode(token, self._secret, algorithms=[self._algorithm])
            return Principal(
                email=str(payload["sub"]),
                name=str(payload["name"]),
                role=Role(payload["role"]),
            )
        except (jwt.PyJWTError, KeyError, ValueError) as exc:
            raise AuthenticationError("Invalid or expired access token") from exc


bearer_scheme = HTTPBearer(auto_error=False)


def get_auth(request: Request) -> AuthService:
    return request.app.state.auth


def current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    auth: AuthService = Depends(get_auth),
) -> Principal:
    if credentials is None or credentials.scheme.casefold() != "bearer":
        raise AuthenticationError("A bearer access token is required")
    return auth.decode_token(credentials.credentials)


def interviewer(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role is not Role.INTERVIEWER:
        raise AuthorizationError("Interviewer access is required")
    return principal


def seeded_auth_service() -> AuthService:
    service = AuthService()
    service.add_user(
        "interviewer@example.com",
        "Fred Offei",
        Role.INTERVIEWER,
        "interviewer-password",
    )
    service.add_user(
        "candidate@example.com", "Amara Boateng", Role.CANDIDATE, "candidate-password"
    )
    return service
