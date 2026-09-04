from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import uuid4

from .models import (
    CanvasDoc,
    CanvasEdge,
    CanvasNode,
    CanvasNote,
    CreateSessionInput,
    Difficulty,
    Feedback,
    FeedbackScores,
    JoinSessionInput,
    NodeKind,
    Participant,
    Recommendation,
    Role,
    SaveFeedbackInput,
    Session,
    SessionStatus,
    ShareLink,
)

PARTICIPANT_COLORS = ["#5eead4", "#fbbf24", "#f472b6", "#93c5fd", "#a3e635"]


class NotFoundError(Exception):
    pass


class ForbiddenError(Exception):
    pass


def now() -> datetime:
    return datetime.now(UTC)


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def empty_canvas() -> CanvasDoc:
    return CanvasDoc(
        nodes=[], edges=[], notes=[], strokes=[], revision=0, updated_at=now()
    )


def empty_feedback() -> Feedback:
    return Feedback(
        notes="",
        scores=FeedbackScores(communication=0, tradeoffs=0, scalability=0, depth=0),
        recommendation=Recommendation.NOT_SET,
        updated_at=None,
    )


class SessionStore:
    def __init__(self) -> None:
        self._lock = RLock()
        self._sessions: dict[str, Session] = {}
        self._subscribers: dict[str, set[asyncio.Queue[Session]]] = {}
        self.reset()

    def reset(self) -> None:
        with self._lock:
            seeded = seed_sessions()
            self._sessions = {session.id: session for session in seeded}
            self._subscribers = {}

    def list_sessions(self) -> list[Session]:
        with self._lock:
            return [
                session.model_copy(deep=True) for session in self._sessions.values()
            ]

    def get(self, session_id: str) -> Session:
        with self._lock:
            return self._find(session_id).model_copy(deep=True)

    def get_by_token(self, token: str) -> Session:
        with self._lock:
            session = next(
                (
                    item
                    for item in self._sessions.values()
                    if item.share and item.share.token == token
                ),
                None,
            )
            if session is None:
                raise NotFoundError("Invite link is not valid")
            if session.share and session.share.revoked_at:
                raise ForbiddenError("This invite link has been revoked")
            return session.model_copy(deep=True)

    def create(self, data: CreateSessionInput, interviewer_name: str) -> Session:
        created = now()
        session = Session(
            id=uid("s"),
            title=data.title,
            prompt=data.prompt,
            difficulty=data.difficulty,
            duration_minutes=data.duration_minutes,
            candidate_name=data.candidate_name,
            candidate_email=data.candidate_email,
            status=SessionStatus.SCHEDULED,
            created_at=created,
            scheduled_for=data.scheduled_for,
            started_at=None,
            ended_at=None,
            candidate_can_edit=True,
            share=None,
            participants=[
                self._participant(interviewer_name, Role.INTERVIEWER, False, 0)
            ],
            canvas=empty_canvas(),
            feedback=empty_feedback(),
        )
        with self._lock:
            self._sessions = {session.id: session, **self._sessions}
            return session.model_copy(deep=True)

    def create_share_link(self, session_id: str) -> Session:
        with self._lock:
            session = self._find(session_id)
            session.share = ShareLink(
                token=uid("shr"), created_at=now(), revoked_at=None
            )
            return self._commit(session)

    def revoke_share_link(self, session_id: str) -> Session:
        with self._lock:
            session = self._find(session_id)
            if session.share is None:
                raise NotFoundError("No share link to revoke")
            session.share.revoked_at = now()
            return self._commit(session)

    def join(self, session_id: str, data: JoinSessionInput) -> Session:
        with self._lock:
            session = self._find(session_id)
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("This session has already ended")
            existing = next(
                (
                    p
                    for p in session.participants
                    if p.name == data.name and p.role is data.role
                ),
                None,
            )
            if existing:
                existing.online = True
                existing.last_seen = now()
            else:
                session.participants.append(
                    self._participant(
                        data.name, data.role, True, len(session.participants)
                    )
                )
            return self._commit(session)

    def leave(self, session_id: str, participant_id: str) -> Session:
        with self._lock:
            session = self._find(session_id)
            participant = next(
                (p for p in session.participants if p.id == participant_id), None
            )
            if participant is None:
                raise NotFoundError(f"Participant {participant_id} not found")
            participant.online = False
            participant.last_seen = now()
            return self._commit(session)

    def set_candidate_editing(self, session_id: str, can_edit: bool) -> Session:
        with self._lock:
            session = self._find(session_id)
            session.candidate_can_edit = can_edit
            return self._commit(session)

    def start(self, session_id: str) -> Session:
        with self._lock:
            session = self._find(session_id)
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("Cannot start an ended session")
            if session.status is SessionStatus.LIVE:
                return session.model_copy(deep=True)
            session.status = SessionStatus.LIVE
            session.started_at = now()
            return self._commit(session)

    def end(self, session_id: str) -> Session:
        with self._lock:
            session = self._find(session_id)
            if session.status is not SessionStatus.LIVE:
                raise ForbiddenError("Only a live session can be ended")
            timestamp = now()
            session.status = SessionStatus.ENDED
            session.ended_at = timestamp
            session.candidate_can_edit = False
            for participant in session.participants:
                participant.online = False
            if session.share and session.share.revoked_at is None:
                session.share.revoked_at = timestamp
            return self._commit(session)

    def save_canvas(self, session_id: str, canvas: CanvasDoc, actor: Role) -> Session:
        with self._lock:
            session = self._find(session_id)
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("Session has ended; canvas is read-only")
            if actor is Role.CANDIDATE and not session.candidate_can_edit:
                raise ForbiddenError("Editing is locked by the interviewer")
            saved = canvas.model_copy(deep=True)
            saved.revision = session.canvas.revision + 1
            saved.updated_at = now()
            session.canvas = saved
            return self._commit(session)

    def save_feedback(self, session_id: str, data: SaveFeedbackInput) -> Session:
        with self._lock:
            session = self._find(session_id)
            session.feedback = Feedback(**data.model_dump(), updated_at=now())
            return self._commit(session)

    @contextmanager
    def subscribe(self, session_id: str) -> Iterator[asyncio.Queue[Session]]:
        self.get(session_id)
        queue: asyncio.Queue[Session] = asyncio.Queue(maxsize=10)
        with self._lock:
            self._subscribers.setdefault(session_id, set()).add(queue)
        try:
            yield queue
        finally:
            with self._lock:
                subscribers = self._subscribers.get(session_id)
                if subscribers:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(session_id, None)

    def _find(self, session_id: str) -> Session:
        session = self._sessions.get(session_id)
        if session is None:
            raise NotFoundError(f"Session {session_id} not found")
        return session

    def _commit(self, session: Session) -> Session:
        self._sessions[session.id] = session
        snapshot = session.model_copy(deep=True)
        for queue in self._subscribers.get(session.id, set()):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(snapshot.model_copy(deep=True))
        return snapshot

    @staticmethod
    def _participant(name: str, role: Role, online: bool, index: int) -> Participant:
        return Participant(
            id=uid("p"),
            name=name,
            role=role,
            online=online,
            last_seen=now(),
            color=PARTICIPANT_COLORS[index % len(PARTICIPANT_COLORS)],
        )


def seeded_canvas(timestamp: datetime) -> CanvasDoc:
    client = CanvasNode(
        id=uid("n"), kind=NodeKind.CLIENT, label="Client", x=80, y=220, w=168, h=76
    )
    gateway = CanvasNode(
        id=uid("n"),
        kind=NodeKind.GATEWAY,
        label="API gateway",
        x=340,
        y=220,
        w=168,
        h=76,
    )
    service = CanvasNode(
        id=uid("n"),
        kind=NodeKind.SERVICE,
        label="Feed service",
        x=600,
        y=220,
        w=168,
        h=76,
    )
    database = CanvasNode(
        id=uid("n"), kind=NodeKind.DATABASE, label="Postgres", x=860, y=220, w=168, h=76
    )
    return CanvasDoc(
        nodes=[client, gateway, service, database],
        edges=[
            CanvasEdge(
                id=uid("e"),
                **{"from": client.id},
                to=gateway.id,
                label="HTTPS",
                dashed=False,
            ),
            CanvasEdge(
                id=uid("e"),
                **{"from": gateway.id},
                to=service.id,
                label="request",
                dashed=False,
            ),
            CanvasEdge(
                id=uid("e"),
                **{"from": service.id},
                to=database.id,
                label="query",
                dashed=False,
            ),
        ],
        notes=[
            CanvasNote(
                id=uid("note"),
                x=80,
                y=400,
                w=230,
                h=110,
                text="50M DAU\np99 under 200 ms",
            )
        ],
        strokes=[],
        revision=12,
        updated_at=timestamp,
    )


def seed_sessions() -> list[Session]:
    timestamp = now()
    interviewer = SessionStore._participant("Fred Offei", Role.INTERVIEWER, True, 0)
    candidate = SessionStore._participant("Amara Boateng", Role.CANDIDATE, True, 1)
    live = Session(
        id="s_live_feed",
        title="Design a social feed",
        prompt="Design the read and write path for a social feed serving 50M daily active users.",
        difficulty=Difficulty.SENIOR,
        duration_minutes=60,
        candidate_name="Amara Boateng",
        candidate_email="candidate@example.com",
        status=SessionStatus.LIVE,
        created_at=timestamp - timedelta(days=4),
        scheduled_for=timestamp - timedelta(minutes=45),
        started_at=timestamp - timedelta(minutes=42),
        ended_at=None,
        candidate_can_edit=True,
        share=ShareLink(
            token="shr_feed_9m2k",
            created_at=timestamp - timedelta(minutes=90),
            revoked_at=None,
        ),
        participants=[interviewer, candidate],
        canvas=seeded_canvas(timestamp - timedelta(minutes=2)),
        feedback=empty_feedback(),
    )
    scheduled = Session(
        id="s_scheduled_shortener",
        title="Design a URL shortener",
        prompt="Design a URL shortening service with analytics and custom aliases.",
        difficulty=Difficulty.MID,
        duration_minutes=45,
        candidate_name="Ken Watanabe",
        candidate_email="ken@example.com",
        status=SessionStatus.SCHEDULED,
        created_at=timestamp - timedelta(days=1),
        scheduled_for=timestamp + timedelta(hours=3),
        started_at=None,
        ended_at=None,
        candidate_can_edit=True,
        share=None,
        participants=[
            SessionStore._participant("Fred Offei", Role.INTERVIEWER, False, 0)
        ],
        canvas=empty_canvas(),
        feedback=empty_feedback(),
    )
    ended = Session(
        id="s_ended_dispatch",
        title="Design a ride-hailing dispatch system",
        prompt="Design real-time driver matching and dispatch across multiple cities.",
        difficulty=Difficulty.STAFF,
        duration_minutes=75,
        candidate_name="Lucia Ferreira",
        candidate_email="lucia@example.com",
        status=SessionStatus.ENDED,
        created_at=timestamp - timedelta(days=8),
        scheduled_for=timestamp - timedelta(days=2),
        started_at=timestamp - timedelta(days=2),
        ended_at=timestamp - timedelta(days=2) + timedelta(minutes=75),
        candidate_can_edit=False,
        share=ShareLink(
            token="shr_ride_77qd",
            created_at=timestamp - timedelta(days=3),
            revoked_at=timestamp - timedelta(days=2) + timedelta(minutes=75),
        ),
        participants=[
            SessionStore._participant("Fred Offei", Role.INTERVIEWER, False, 0),
            SessionStore._participant("Lucia Ferreira", Role.CANDIDATE, False, 1),
        ],
        canvas=seeded_canvas(timestamp - timedelta(days=2)),
        feedback=Feedback(
            notes="Strong discussion of geo-sharding and matching latency.",
            scores=FeedbackScores(communication=4, tradeoffs=5, scalability=4, depth=4),
            recommendation=Recommendation.HIRE,
            updated_at=timestamp - timedelta(days=2),
        ),
    )
    return [live, scheduled, ended]
