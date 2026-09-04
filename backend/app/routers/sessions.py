from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import StreamingResponse

from ..auth import AuthorizationError, Principal, current_principal, interviewer
from ..models import (
    CandidateEditingInput,
    CreateSessionInput,
    JoinSessionInput,
    Role,
    SaveCanvasInput,
    SaveFeedbackInput,
    Session,
    SessionEvent,
)
from ..store import SessionStore

router = APIRouter(tags=["Sessions"])


def get_store(request: Request) -> SessionStore:
    return request.app.state.store


def require_session_access(session: Session, principal: Principal) -> None:
    if principal.role is Role.INTERVIEWER:
        return
    if (
        principal.role is Role.CANDIDATE
        and principal.email == str(session.candidate_email).casefold()
    ):
        return
    raise AuthorizationError("You do not have access to this session")


@router.get("/sessions", response_model=list[Session])
def list_sessions(
    _: Principal = Depends(interviewer), store: SessionStore = Depends(get_store)
) -> list[Session]:
    return store.list_sessions()


@router.post("/sessions", response_model=Session, status_code=status.HTTP_201_CREATED)
def create_session(
    data: CreateSessionInput,
    principal: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.create(data, principal.name)


@router.get("/sessions/{session_id}", response_model=Session)
def get_session(
    session_id: str,
    principal: Principal = Depends(current_principal),
    store: SessionStore = Depends(get_store),
) -> Session:
    session = store.get(session_id)
    require_session_access(session, principal)
    return session


@router.get("/invites/{token}", response_model=Session)
def get_session_by_token(
    token: str, store: SessionStore = Depends(get_store)
) -> Session:
    return store.get_by_token(token)


@router.post("/sessions/{session_id}/share-link", response_model=Session)
def create_share_link(
    session_id: str,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.create_share_link(session_id)


@router.delete("/sessions/{session_id}/share-link", response_model=Session)
def revoke_share_link(
    session_id: str,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.revoke_share_link(session_id)


@router.post("/sessions/{session_id}/participants", response_model=Session)
def join_session(
    session_id: str,
    data: JoinSessionInput,
    principal: Principal = Depends(current_principal),
    store: SessionStore = Depends(get_store),
) -> Session:
    session = store.get(session_id)
    require_session_access(session, principal)
    if data.role is not principal.role:
        raise AuthorizationError(
            "The requested participant role does not match your account"
        )
    if principal.role is Role.CANDIDATE and data.name != session.candidate_name:
        raise AuthorizationError("Candidate name does not match the session invitation")
    return store.join(session_id, data)


@router.delete(
    "/sessions/{session_id}/participants/{participant_id}", response_model=Session
)
def leave_session(
    session_id: str,
    participant_id: str,
    principal: Principal = Depends(current_principal),
    store: SessionStore = Depends(get_store),
) -> Session:
    session = store.get(session_id)
    require_session_access(session, principal)
    participant = next(
        (item for item in session.participants if item.id == participant_id), None
    )
    if (
        participant
        and principal.role is Role.CANDIDATE
        and participant.name != principal.name
    ):
        raise AuthorizationError("Candidates can only update their own presence")
    return store.leave(session_id, participant_id)


@router.patch("/sessions/{session_id}/candidate-editing", response_model=Session)
def set_candidate_can_edit(
    session_id: str,
    data: CandidateEditingInput,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.set_candidate_editing(session_id, data.can_edit)


@router.post("/sessions/{session_id}/start", response_model=Session)
def start_session(
    session_id: str,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.start(session_id)


@router.post("/sessions/{session_id}/end", response_model=Session)
def end_session(
    session_id: str,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.end(session_id)


@router.put("/sessions/{session_id}/canvas", response_model=Session)
def save_canvas(
    session_id: str,
    data: SaveCanvasInput,
    principal: Principal = Depends(current_principal),
    store: SessionStore = Depends(get_store),
) -> Session:
    session = store.get(session_id)
    require_session_access(session, principal)
    if data.actor is not principal.role:
        raise AuthorizationError(
            "Canvas actor does not match the authenticated account"
        )
    return store.save_canvas(session_id, data.canvas, principal.role)


@router.put("/sessions/{session_id}/feedback", response_model=Session)
def save_feedback(
    session_id: str,
    data: SaveFeedbackInput,
    _: Principal = Depends(interviewer),
    store: SessionStore = Depends(get_store),
) -> Session:
    return store.save_feedback(session_id, data)


@router.get("/sessions/{session_id}/events", response_class=StreamingResponse)
def subscribe_to_session(
    session_id: str,
    principal: Principal = Depends(current_principal),
    store: SessionStore = Depends(get_store),
) -> StreamingResponse:
    session = store.get(session_id)
    require_session_access(session, principal)

    async def events():
        with store.subscribe(session_id) as queue:
            while True:
                update = await queue.get()
                event = SessionEvent(session=update)
                payload = json.dumps(event.model_dump(mode="json", by_alias=True))
                yield f"event: session:updated\ndata: {payload}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
