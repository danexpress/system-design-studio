from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, EmailStr, Field


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class HealthResponse(ApiModel):
    status: str


class SessionStatus(StrEnum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"


class Difficulty(StrEnum):
    JUNIOR = "junior"
    MID = "mid"
    SENIOR = "senior"
    STAFF = "staff"


class Role(StrEnum):
    INTERVIEWER = "interviewer"
    CANDIDATE = "candidate"


class NodeKind(StrEnum):
    CLIENT = "client"
    SERVICE = "service"
    DATABASE = "database"
    CACHE = "cache"
    QUEUE = "queue"
    LOAD_BALANCER = "loadbalancer"
    CDN = "cdn"
    STORAGE = "storage"
    GATEWAY = "gateway"
    WORKER = "worker"


class Recommendation(StrEnum):
    STRONG_HIRE = "strong_hire"
    HIRE = "hire"
    LEAN_HIRE = "lean_hire"
    NO_HIRE = "no_hire"
    NOT_SET = ""


class ShareLink(ApiModel):
    token: str
    created_at: datetime
    revoked_at: datetime | None


class Participant(ApiModel):
    id: str
    name: str
    role: Role
    online: bool
    last_seen: datetime
    color: str


class CanvasNode(ApiModel):
    id: str
    kind: NodeKind
    label: str
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)


class CanvasEdge(ApiModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    label: str
    dashed: bool


class CanvasNote(ApiModel):
    id: str
    x: float
    y: float
    w: float = Field(gt=0)
    h: float = Field(gt=0)
    text: str


class CanvasStroke(ApiModel):
    id: str
    points: list[tuple[float, float]]


class CanvasDoc(ApiModel):
    nodes: list[CanvasNode]
    edges: list[CanvasEdge]
    notes: list[CanvasNote]
    strokes: list[CanvasStroke]
    revision: int = Field(ge=0)
    updated_at: datetime


class FeedbackScores(ApiModel):
    communication: int = Field(ge=0, le=5)
    tradeoffs: int = Field(ge=0, le=5)
    scalability: int = Field(ge=0, le=5)
    depth: int = Field(ge=0, le=5)


class Feedback(ApiModel):
    notes: str
    scores: FeedbackScores
    recommendation: Recommendation
    updated_at: datetime | None


class Session(ApiModel):
    id: str
    title: str
    prompt: str
    difficulty: Difficulty
    duration_minutes: int = Field(ge=1)
    candidate_name: str
    candidate_email: EmailStr
    status: SessionStatus
    created_at: datetime
    scheduled_for: datetime
    started_at: datetime | None
    ended_at: datetime | None
    candidate_can_edit: bool
    share: ShareLink | None
    participants: list[Participant]
    canvas: CanvasDoc
    feedback: Feedback


class CreateSessionInput(ApiModel):
    title: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    difficulty: Difficulty
    duration_minutes: int = Field(ge=1)
    candidate_name: str = Field(min_length=1)
    candidate_email: EmailStr
    scheduled_for: datetime


class JoinSessionInput(ApiModel):
    name: str = Field(min_length=1)
    role: Role


class CandidateEditingInput(ApiModel):
    can_edit: bool


class SaveCanvasInput(ApiModel):
    canvas: CanvasDoc
    actor: Role


class SaveFeedbackInput(ApiModel):
    notes: str
    scores: FeedbackScores
    recommendation: Recommendation


class SessionEvent(ApiModel):
    type: str = "session:updated"
    session: Session


class LoginInput(ApiModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"


class ErrorResponse(ApiModel):
    message: str
