// Single services layer: every backend call in the app goes through `api`.
// The active implementation is the in-memory mock so the app runs with no backend.

import {
  emptyCanvas,
  newSessionFrom,
  PARTICIPANT_COLORS,
  seedSessions,
  uid,
} from "./mock-backend";
import type {
  CanvasDoc,
  ConnectionState,
  CreateSessionInput,
  Feedback,
  Participant,
  Session,
} from "./types";

export * from "./types";

export interface BackendApi {
  listSessions(): Promise<Session[]>;
  getSession(id: string): Promise<Session>;
  getSessionByToken(token: string): Promise<Session>;
  createSession(input: CreateSessionInput): Promise<Session>;
  createShareLink(id: string): Promise<Session>;
  revokeShareLink(id: string): Promise<Session>;
  joinSession(id: string, name: string, role: Participant["role"]): Promise<Session>;
  leaveSession(id: string, participantId: string): Promise<Session>;
  setCandidateCanEdit(id: string, canEdit: boolean): Promise<Session>;
  startSession(id: string): Promise<Session>;
  endSession(id: string): Promise<Session>;
  saveCanvas(id: string, canvas: CanvasDoc, actor: Participant["role"]): Promise<Session>;
  saveFeedback(id: string, feedback: Omit<Feedback, "updatedAt">): Promise<Session>;
  subscribe(id: string, listener: (s: Session) => void): () => void;
  connectionState(): ConnectionState;
  onConnectionChange(listener: (s: ConnectionState) => void): () => void;
  simulateConnectionDrop(ms?: number): void;
  reset(sessions?: Session[]): void;
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

const LATENCY = 90;
const delay = (ms = LATENCY) => new Promise<void>((r) => setTimeout(r, ms));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createMockApi(options: { latency?: number } = {}): BackendApi {
  const latency = options.latency ?? LATENCY;
  let sessions: Session[] = seedSessions();
  const listeners = new Map<string, Set<(s: Session) => void>>();
  const connListeners = new Set<(s: ConnectionState) => void>();
  let connection: ConnectionState = "online";
  let dropTimer: ReturnType<typeof setTimeout> | undefined;

  function find(id: string): Session {
    const s = sessions.find((x) => x.id === id);
    if (!s) throw new NotFoundError(`Session ${id} not found`);
    return s;
  }

  function emit(session: Session) {
    listeners.get(session.id)?.forEach((l) => l(clone(session)));
  }

  function commit(session: Session): Session {
    sessions = sessions.map((s) => (s.id === session.id ? session : s));
    emit(session);
    return clone(session);
  }

  async function guard<T>(fn: () => T): Promise<T> {
    await delay(latency);
    if (connection === "offline") throw new Error("Offline: request could not be sent");
    return fn();
  }

  return {
    async listSessions() {
      return guard(() => clone(sessions));
    },
    async getSession(id) {
      return guard(() => clone(find(id)));
    },
    async getSessionByToken(token) {
      return guard(() => {
        const s = sessions.find((x) => x.share?.token === token);
        if (!s) throw new NotFoundError("Invite link is not valid");
        if (s.share?.revokedAt) throw new ForbiddenError("This invite link has been revoked");
        return clone(s);
      });
    },
    async createSession(input) {
      return guard(() => {
        const session = newSessionFrom(input);
        sessions = [session, ...sessions];
        return clone(session);
      });
    },
    async createShareLink(id) {
      return guard(() => {
        const s = find(id);
        return commit({
          ...s,
          share: { token: uid("shr"), createdAt: new Date().toISOString(), revokedAt: null },
        });
      });
    },
    async revokeShareLink(id) {
      return guard(() => {
        const s = find(id);
        if (!s.share) throw new NotFoundError("No share link to revoke");
        return commit({
          ...s,
          share: { ...s.share, revokedAt: new Date().toISOString() },
        });
      });
    },
    async joinSession(id, name, role) {
      return guard(() => {
        const s = find(id);
        if (s.status === "ended") throw new ForbiddenError("This session has already ended");
        const existing = s.participants.find((p) => p.name === name && p.role === role);
        const participants = existing
          ? s.participants.map((p) =>
              p.id === existing.id ? { ...p, online: true, lastSeen: new Date().toISOString() } : p,
            )
          : [
              ...s.participants,
              {
                id: uid("p"),
                name,
                role,
                online: true,
                lastSeen: new Date().toISOString(),
                color: PARTICIPANT_COLORS[s.participants.length % PARTICIPANT_COLORS.length]!,
              },
            ];
        return commit({ ...s, participants });
      });
    },
    async leaveSession(id, participantId) {
      return guard(() => {
        const s = find(id);
        return commit({
          ...s,
          participants: s.participants.map((p) =>
            p.id === participantId ? { ...p, online: false, lastSeen: new Date().toISOString() } : p,
          ),
        });
      });
    },
    async setCandidateCanEdit(id, canEdit) {
      return guard(() => commit({ ...find(id), candidateCanEdit: canEdit }));
    },
    async startSession(id) {
      return guard(() => {
        const s = find(id);
        if (s.status === "ended") throw new ForbiddenError("Cannot start an ended session");
        if (s.status === "live") return clone(s);
        return commit({
          ...s,
          status: "live",
          startedAt: new Date().toISOString(),
          canvas: s.canvas.revision === 0 ? emptyCanvas() : s.canvas,
        });
      });
    },
    async endSession(id) {
      return guard(() => {
        const s = find(id);
        if (s.status !== "live") throw new ForbiddenError("Only a live session can be ended");
        return commit({
          ...s,
          status: "ended",
          endedAt: new Date().toISOString(),
          candidateCanEdit: false,
          participants: s.participants.map((p) => ({ ...p, online: false })),
          share: s.share ? { ...s.share, revokedAt: s.share.revokedAt ?? new Date().toISOString() } : null,
        });
      });
    },
    async saveCanvas(id, canvas, actor) {
      return guard(() => {
        const s = find(id);
        if (s.status === "ended") throw new ForbiddenError("Session has ended; canvas is read-only");
        if (actor === "candidate" && !s.candidateCanEdit)
          throw new ForbiddenError("Editing is locked by the interviewer");
        return commit({
          ...s,
          canvas: { ...canvas, revision: s.canvas.revision + 1, updatedAt: new Date().toISOString() },
        });
      });
    },
    async saveFeedback(id, feedback) {
      return guard(() =>
        commit({ ...find(id), feedback: { ...feedback, updatedAt: new Date().toISOString() } }),
      );
    },
    subscribe(id, listener) {
      const set = listeners.get(id) ?? new Set();
      set.add(listener);
      listeners.set(id, set);
      return () => set.delete(listener);
    },
    connectionState() {
      return connection;
    },
    onConnectionChange(listener) {
      connListeners.add(listener);
      return () => connListeners.delete(listener);
    },
    simulateConnectionDrop(ms = 3500) {
      clearTimeout(dropTimer);
      connection = "reconnecting";
      connListeners.forEach((l) => l(connection));
      dropTimer = setTimeout(() => {
        connection = "online";
        connListeners.forEach((l) => l(connection));
      }, ms);
    },
    reset(next) {
      sessions = next ? clone(next) : seedSessions();
      connection = "online";
    },
  };
}

export const api: BackendApi = createMockApi();
