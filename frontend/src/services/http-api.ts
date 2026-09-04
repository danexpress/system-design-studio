import type { BackendApi } from "./index";
import type {
  CanvasDoc,
  ConnectionState,
  CreateSessionInput,
  Feedback,
  Role,
  Session,
  SessionEvent,
} from "./types";

interface TokenResponse {
  accessToken: string;
  tokenType: "bearer";
}

interface ErrorResponse {
  message?: string;
}

interface Credentials {
  email: string;
  password: string;
}

export interface HttpApiOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  credentials?: Partial<Record<Role, Credentials>>;
  reconnectDelayMs?: number;
}

const defaultCredentials: Record<Role, Credentials> = {
  interviewer: {
    email: import.meta.env.VITE_INTERVIEWER_EMAIL ?? "interviewer@example.com",
    password: import.meta.env.VITE_INTERVIEWER_PASSWORD ?? "interviewer-password",
  },
  candidate: {
    email: import.meta.env.VITE_CANDIDATE_EMAIL ?? "candidate@example.com",
    password: import.meta.env.VITE_CANDIDATE_PASSWORD ?? "candidate-password",
  },
};

export function createHttpApi(options: HttpApiOptions = {}): BackendApi {
  const baseUrl = (
    options.baseUrl ??
    import.meta.env.VITE_API_BASE_URL ??
    "http://127.0.0.1:8000/api"
  ).replace(/\/$/, "");
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const credentials = { ...defaultCredentials, ...options.credentials };
  const tokenPromises = new Map<Role, Promise<string>>();
  const connectionListeners = new Set<(state: ConnectionState) => void>();
  let connection: ConnectionState = "online";

  function setConnection(next: ConnectionState) {
    if (next === connection) return;
    connection = next;
    connectionListeners.forEach((listener) => listener(next));
  }

  async function parseError(response: Response): Promise<Error> {
    let message = `${response.status} ${response.statusText}`.trim();
    try {
      const payload = (await response.json()) as ErrorResponse;
      if (payload.message) message = payload.message;
    } catch {
      // Preserve the HTTP status when the response is not JSON.
    }
    return new Error(message);
  }

  async function login(role: Role): Promise<string> {
    const credential = credentials[role];
    if (!credential) throw new Error(`No ${role} credentials are configured`);
    const response = await fetcher(`${baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    });
    if (!response.ok) throw await parseError(response);
    return ((await response.json()) as TokenResponse).accessToken;
  }

  function tokenFor(role: Role): Promise<string> {
    const existing = tokenPromises.get(role);
    if (existing) return existing;
    const pending = login(role).catch((error) => {
      tokenPromises.delete(role);
      throw error;
    });
    tokenPromises.set(role, pending);
    return pending;
  }

  async function request<T>(
    path: string,
    init: RequestInit = {},
    role: Role | null = "interviewer",
    retry = true,
  ): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (role) headers.set("Authorization", `Bearer ${await tokenFor(role)}`);

    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, { ...init, headers });
      setConnection("online");
    } catch (error) {
      setConnection("offline");
      throw error;
    }

    if (response.status === 401 && role && retry) {
      tokenPromises.delete(role);
      return request<T>(path, init, role, false);
    }
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as T;
  }

  function mutation(path: string, method: string, body?: unknown, role: Role = "interviewer") {
    const init: RequestInit = { method };
    if (body !== undefined) init.body = JSON.stringify(body);
    return request<Session>(path, init, role);
  }

  function subscribe(id: string, listener: (session: Session) => void, role: Role = "interviewer") {
    const controller = new AbortController();

    async function connect() {
      while (!controller.signal.aborted) {
        try {
          const token = await tokenFor(role);
          const response = await fetcher(`${baseUrl}/sessions/${encodeURIComponent(id)}/events`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (response.status === 401) tokenPromises.delete(role);
          if (!response.ok) throw await parseError(response);
          if (!response.body) throw new Error("Realtime response has no body");
          setConnection("online");

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const messages = buffer.split("\n\n");
            buffer = messages.pop() ?? "";
            for (const message of messages) {
              const data = message
                .split("\n")
                .find((line) => line.startsWith("data:"))
                ?.slice(5)
                .trim();
              if (!data) continue;
              const event = JSON.parse(data) as SessionEvent;
              if (event.type === "session:updated") listener(event.session);
            }
            if (done) break;
          }
        } catch (error) {
          if (controller.signal.aborted) return;
          console.warn("Session update stream disconnected", error);
        }

        if (!controller.signal.aborted) {
          setConnection("reconnecting");
          await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
        }
      }
    }

    void connect();
    return () => controller.abort();
  }

  return {
    listSessions: () => request<Session[]>("/sessions"),
    getSession: (id, role = "interviewer") =>
      request<Session>(`/sessions/${encodeURIComponent(id)}`, {}, role),
    getSessionByToken: (token) =>
      request<Session>(`/invites/${encodeURIComponent(token)}`, {}, null),
    createSession: (input: CreateSessionInput) => mutation("/sessions", "POST", input),
    createShareLink: (id) => mutation(`/sessions/${encodeURIComponent(id)}/share-link`, "POST"),
    revokeShareLink: (id) => mutation(`/sessions/${encodeURIComponent(id)}/share-link`, "DELETE"),
    joinSession: (id, name, role) =>
      mutation(`/sessions/${encodeURIComponent(id)}/participants`, "POST", { name, role }, role),
    leaveSession: (id, participantId, role = "interviewer") =>
      mutation(
        `/sessions/${encodeURIComponent(id)}/participants/${encodeURIComponent(participantId)}`,
        "DELETE",
        undefined,
        role,
      ),
    setCandidateCanEdit: (id, canEdit) =>
      mutation(`/sessions/${encodeURIComponent(id)}/candidate-editing`, "PATCH", { canEdit }),
    startSession: (id) => mutation(`/sessions/${encodeURIComponent(id)}/start`, "POST"),
    endSession: (id) => mutation(`/sessions/${encodeURIComponent(id)}/end`, "POST"),
    saveCanvas: (id, canvas: CanvasDoc, actor: Role) =>
      mutation(`/sessions/${encodeURIComponent(id)}/canvas`, "PUT", { canvas, actor }, actor),
    saveFeedback: (id, feedback: Omit<Feedback, "updatedAt">) =>
      mutation(`/sessions/${encodeURIComponent(id)}/feedback`, "PUT", feedback),
    subscribe,
    connectionState: () => connection,
    onConnectionChange(listener) {
      connectionListeners.add(listener);
      return () => connectionListeners.delete(listener);
    },
  };
}
