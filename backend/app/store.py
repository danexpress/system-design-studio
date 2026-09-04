from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from threading import RLock
from uuid import uuid4

from sqlalchemy import delete, select

from .database import Database, SessionRecord
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
    def __init__(self, database: Database) -> None:
        self._database = database
        self._subscriber_lock = RLock()
        self._subscribers: dict[str, set[asyncio.Queue[Session]]] = {}
        self.seed_if_empty()

    def seed_if_empty(self) -> None:
        with self._database.session() as database_session:
            if database_session.scalar(select(SessionRecord.id).limit(1)) is not None:
                return
            database_session.add_all(
                [self._record(session) for session in seed_sessions()]
            )

    def reset(self) -> None:
        with self._database.session() as database_session:
            database_session.execute(delete(SessionRecord))
            database_session.add_all(
                [self._record(session) for session in seed_sessions()]
            )
        with self._subscriber_lock:
            self._subscribers = {}

    def list_sessions(self) -> list[Session]:
        with self._database.session() as database_session:
            records = database_session.scalars(select(SessionRecord)).all()
            return [self._domain(record) for record in records]

    def get(self, session_id: str) -> Session:
        with self._database.session() as database_session:
            return self._domain(self._find(database_session, session_id))

    def get_by_token(self, token: str) -> Session:
        with self._database.session() as database_session:
            records = database_session.scalars(select(SessionRecord)).all()
            session = next(
                (
                    domain
                    for record in records
                    if (domain := self._domain(record)).share
                    and domain.share.token == token
                ),
                None,
            )
            if session is None:
                raise NotFoundError("Invite link is not valid")
            if session.share and session.share.revoked_at:
                raise ForbiddenError("This invite link has been revoked")
            return session

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
        with self._database.session() as database_session:
            database_session.add(self._record(session))
        return session

    def create_share_link(self, session_id: str) -> Session:
        def update(session: Session) -> None:
            session.share = ShareLink(
                token=uid("shr"), created_at=now(), revoked_at=None
            )

        return self._mutate(session_id, update)

    def revoke_share_link(self, session_id: str) -> Session:
        def update(session: Session) -> None:
            if session.share is None:
                raise NotFoundError("No share link to revoke")
            session.share.revoked_at = now()

        return self._mutate(session_id, update)

    def join(self, session_id: str, data: JoinSessionInput) -> Session:
        def update(session: Session) -> None:
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("This session has already ended")
            existing = next(
                (
                    participant
                    for participant in session.participants
                    if participant.name == data.name and participant.role is data.role
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

        return self._mutate(session_id, update)

    def leave(self, session_id: str, participant_id: str) -> Session:
        def update(session: Session) -> None:
            participant = next(
                (item for item in session.participants if item.id == participant_id),
                None,
            )
            if participant is None:
                raise NotFoundError(f"Participant {participant_id} not found")
            participant.online = False
            participant.last_seen = now()

        return self._mutate(session_id, update)

    def set_candidate_editing(self, session_id: str, can_edit: bool) -> Session:
        return self._mutate(
            session_id, lambda session: setattr(session, "candidate_can_edit", can_edit)
        )

    def start(self, session_id: str) -> Session:
        def update(session: Session) -> None:
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("Cannot start an ended session")
            if session.status is SessionStatus.SCHEDULED:
                session.status = SessionStatus.LIVE
                session.started_at = now()

        return self._mutate(session_id, update)

    def end(self, session_id: str) -> Session:
        def update(session: Session) -> None:
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

        return self._mutate(session_id, update)

    def save_canvas(self, session_id: str, canvas: CanvasDoc, actor: Role) -> Session:
        def update(session: Session) -> None:
            if session.status is SessionStatus.ENDED:
                raise ForbiddenError("Session has ended; canvas is read-only")
            if actor is Role.CANDIDATE and not session.candidate_can_edit:
                raise ForbiddenError("Editing is locked by the interviewer")
            saved = canvas.model_copy(deep=True)
            saved.revision = session.canvas.revision + 1
            saved.updated_at = now()
            session.canvas = saved

        return self._mutate(session_id, update)

    def save_feedback(self, session_id: str, data: SaveFeedbackInput) -> Session:
        def update(session: Session) -> None:
            session.feedback = Feedback(**data.model_dump(), updated_at=now())

        return self._mutate(session_id, update)

    @contextmanager
    def subscribe(self, session_id: str) -> Iterator[asyncio.Queue[Session]]:
        self.get(session_id)
        queue: asyncio.Queue[Session] = asyncio.Queue(maxsize=10)
        with self._subscriber_lock:
            self._subscribers.setdefault(session_id, set()).add(queue)
        try:
            yield queue
        finally:
            with self._subscriber_lock:
                subscribers = self._subscribers.get(session_id)
                if subscribers:
                    subscribers.discard(queue)
                    if not subscribers:
                        self._subscribers.pop(session_id, None)

    def _mutate(self, session_id: str, update: Callable[[Session], None]) -> Session:
        with self._database.session() as database_session:
            record = self._find(database_session, session_id)
            session = self._domain(record)
            update(session)
            record.document = self._document(session)
        self._publish(session)
        return session

    def _publish(self, session: Session) -> None:
        snapshot = session.model_copy(deep=True)
        with self._subscriber_lock:
            for queue in self._subscribers.get(session.id, set()):
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait(snapshot.model_copy(deep=True))

    @staticmethod
    def _find(database_session, session_id: str) -> SessionRecord:
        record = database_session.get(SessionRecord, session_id)
        if record is None:
            raise NotFoundError(f"Session {session_id} not found")
        return record

    @staticmethod
    def _record(session: Session) -> SessionRecord:
        return SessionRecord(id=session.id, document=SessionStore._document(session))

    @staticmethod
    def _domain(record: SessionRecord) -> Session:
        return Session.model_validate(record.document)

    @staticmethod
    def _document(session: Session) -> dict:
        return session.model_dump(mode="json", by_alias=True)

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
        id=uid("n"),
        kind=NodeKind.DATABASE,
        label="Postgres",
        x=860,
        y=220,
        w=168,
        h=76,
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
        participants=[
            SessionStore._participant("Fred Offei", Role.INTERVIEWER, True, 0),
            SessionStore._participant("Amara Boateng", Role.CANDIDATE, True, 1),
        ],
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
