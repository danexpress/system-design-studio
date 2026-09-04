import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Link2,
  Link2Off,
  Lock,
  LogIn,
  PlugZap,
  Square,
  Unlock,
  Play,
} from "lucide-react";
import { api, type CanvasDoc, type Feedback, type Role, type Session } from "@/services";
import { ConnectionBadge, StatusPill, TopBar } from "@/components/app/Shell";
import { DesignCanvas } from "@/components/canvas/DesignCanvas";
import { useAutosave, useConnection, useSessionState } from "@/hooks/useSessionState";

export const Route = createFileRoute("/sessions/$sessionId")({
  validateSearch: (search: Record<string, unknown>): { role: Role } => ({
    role: search['role'] === "candidate" ? "candidate" : "interviewer",
  }),
  head: () => ({
    meta: [
      { title: "Live interview session — WhiteboardIQ" },
      {
        name: "description",
        content: "Shared system design canvas with presence, editing controls, and autosaved feedback.",
      },
      { property: "og:title", content: "Live interview session — WhiteboardIQ" },
      {
        property: "og:description",
        content: "Shared system design canvas with presence, editing controls, and autosaved feedback.",
      },
    ],
  }),
  component: SessionPage,
});

function SessionPage() {
  const { sessionId } = Route.useParams();
  const { role } = Route.useSearch();
  const navigate = useNavigate();
  const { session, setSession, loading, error } = useSessionState(sessionId);
  const connection = useConnection();
  const [banner, setBanner] = useState<string | null>(null);
  const [canvas, setCanvas] = useState<CanvasDoc | null>(null);
  const [joined, setJoined] = useState(role === "interviewer");

  useEffect(() => {
    if (session && !canvas) setCanvas(session.canvas);
  }, [session, canvas]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 3000);
    return () => clearTimeout(t);
  }, [banner]);

  const canEdit =
    !!session &&
    session.status === "live" &&
    (role === "interviewer" || session.candidateCanEdit) &&
    connection !== "offline";

  const canvasSave = useAutosave(canvas, async (doc) => {
    if (!doc || !session || session.status !== "live") return;
    if (role === "candidate" && !session.candidateCanEdit) return;
    await api.saveCanvas(sessionId, doc, role);
  });

  if (loading) return <Centered>Loading session…</Centered>;
  if (error || !session) return <Centered>{error ?? "Session not found"}</Centered>;

  async function act<T>(fn: () => Promise<Session>, message: string) {
    try {
      const next = await fn();
      setSession(next);
      setBanner(message);
    } catch (e) {
      setBanner((e as Error).message);
    }
  }

  const shared = session;
  const linkActive = Boolean(shared.share && !shared.share.revokedAt);
  const shareHref = shared.share ? `${typeof window === "undefined" ? "" : window.location.origin}/join/${shared.share.token}` : "";

  const header = (
    <TopBar
      right={
        <div className="flex items-center gap-3">
          <ConnectionBadge state={connection} />
          <button
            onClick={() => api.simulateConnectionDrop()}
            title="Simulate a dropped connection"
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-accent"
          >
            <PlugZap className="h-3.5 w-3.5" /> Test reconnect
          </button>
          <span className="rounded-full border border-border px-2.5 py-1 text-xs capitalize text-muted-foreground">
            {role} view
          </span>
          <button
            onClick={() =>
              navigate({
                to: "/sessions/$sessionId",
                params: { sessionId },
                search: { role: role === "interviewer" ? "candidate" : "interviewer" },
              })
            }
            className="rounded-md border border-input px-2.5 py-1.5 text-xs transition hover:bg-accent"
          >
            Switch to {role === "interviewer" ? "candidate" : "interviewer"}
          </button>
        </div>
      }
    />
  );

  // Candidate lobby
  if (role === "candidate" && (!joined || shared.status === "scheduled")) {
    return (
      <div className="min-h-screen bg-background">
        {header}
        <main className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
          <StatusPill status={shared.status} />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">{shared.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {shared.status === "scheduled"
              ? "You're in the lobby. The interviewer will start the session shortly."
              : "Join the shared canvas when you're ready."}
          </p>
          <div className="mt-6 w-full rounded-lg border border-border bg-card p-5 text-left">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Prompt</p>
            <p className="mt-2 text-sm text-card-foreground">{shared.prompt}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Duration</dt>
                <dd className="text-card-foreground">{shared.durationMinutes} minutes</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Level</dt>
                <dd className="capitalize text-card-foreground">{shared.difficulty}</dd>
              </div>
            </dl>
            <div className="mt-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">In the room</p>
              <Presence session={shared} />
            </div>
          </div>
          <button
            onClick={async () => {
              await act(() => api.joinSession(sessionId, shared.candidateName, "candidate"), "Joined the session");
              setJoined(true);
            }}
            disabled={shared.status === "scheduled"}
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            <LogIn className="h-4 w-4" />
            {shared.status === "scheduled" ? "Waiting for interviewer…" : "Join canvas"}
          </button>
          {banner ? <p className="mt-4 text-sm text-muted-foreground">{banner}</p> : null}
        </main>
      </div>
    );
  }

  // Ended session review
  if (shared.status === "ended") {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {header}
        <ReviewView session={shared} role={role} onSaved={setSession} />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {header}
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card/40 px-4 py-2">
        <Link to="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-sm font-semibold text-foreground">{shared.title}</h1>
        <StatusPill status={shared.status} />
        <Presence session={shared} compact />
        <span className="text-xs text-muted-foreground">
          {canvasSave.state === "saving"
            ? "Saving…"
            : canvasSave.state === "error"
              ? `Not saved: ${canvasSave.message}`
              : `Saved · rev ${shared.canvas.revision}`}
        </span>

        {role === "interviewer" ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={() => navigator.clipboard?.writeText(shareHref).then(() => setBanner("Invite link copied"))}
              disabled={!linkActive}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs transition hover:bg-accent disabled:opacity-40"
            >
              <Copy className="h-3.5 w-3.5" /> Copy invite
            </button>
            <button
              onClick={() =>
                linkActive
                  ? act(() => api.revokeShareLink(sessionId), "Invite link revoked")
                  : act(() => api.createShareLink(sessionId), "New invite link created")
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs transition hover:bg-accent"
            >
              {linkActive ? <Link2Off className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {linkActive ? "Revoke link" : "Create link"}
            </button>
            <button
              onClick={() =>
                act(
                  () => api.setCandidateCanEdit(sessionId, !shared.candidateCanEdit),
                  shared.candidateCanEdit ? "Candidate editing locked" : "Candidate editing unlocked",
                )
              }
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs transition hover:bg-accent"
            >
              {shared.candidateCanEdit ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              {shared.candidateCanEdit ? "Lock candidate" : "Unlock candidate"}
            </button>
            {shared.status === "scheduled" ? (
              <button
                onClick={() => act(() => api.startSession(sessionId), "Session started")}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" /> Start session
              </button>
            ) : (
              <button
                onClick={() => act(() => api.endSession(sessionId), "Session ended")}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                <Square className="h-3.5 w-3.5" /> End session
              </button>
            )}
          </div>
        ) : (
          <span className="ml-auto text-xs text-muted-foreground">
            {shared.candidateCanEdit ? "You can edit the canvas" : "Editing locked by interviewer"}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {canvas ? (
            <DesignCanvas
              doc={canvas}
              onChange={setCanvas}
              readOnly={!canEdit}
              lockedReason={
                connection === "offline"
                  ? "Offline — changes paused"
                  : role === "candidate" && !shared.candidateCanEdit
                    ? "Read-only: interviewer locked editing"
                    : shared.status !== "live"
                      ? "Session not live"
                      : undefined
              }
            />
          ) : null}
        </div>
        {role === "interviewer" ? <InterviewerPanel session={shared} onSaved={setSession} /> : null}
      </div>

      {banner ? (
        <div role="status" className="pointer-events-none fixed bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg">
          {banner}
        </div>
      ) : null}
    </div>
  );
}

function Presence({ session, compact = false }: { session: Session; compact?: boolean }) {
  return (
    <ul className={compact ? "flex items-center gap-1" : "mt-2 space-y-1.5"}>
      {session.participants.map((p) => (
        <li key={p.id} className={compact ? "" : "flex items-center gap-2 text-sm"}>
          {compact ? (
            <span
              title={`${p.name} · ${p.online ? "online" : "offline"}`}
              style={{ backgroundColor: p.online ? p.color : "transparent", borderColor: p.color }}
              className="flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold text-background"
            >
              <span className={p.online ? "text-background" : "text-muted-foreground"}>
                {p.name.slice(0, 1)}
              </span>
            </span>
          ) : (
            <>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: p.online ? p.color : "var(--color-muted-foreground)" }}
              />
              <span className="text-card-foreground">{p.name}</span>
              <span className="text-xs capitalize text-muted-foreground">{p.role}</span>
              <span className="ml-auto text-xs text-muted-foreground">{p.online ? "online" : "offline"}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function useFeedbackDraft(session: Session, onSaved: (s: Session) => void) {
  const [draft, setDraft] = useState<Omit<Feedback, "updatedAt">>({
    notes: session.feedback.notes,
    scores: session.feedback.scores,
    recommendation: session.feedback.recommendation,
  });
  const save = useAutosave(draft, async (d) => onSaved(await api.saveFeedback(session.id, d)));
  return { draft, setDraft, save };
}

function InterviewerPanel({ session, onSaved }: { session: Session; onSaved: (s: Session) => void }) {
  const { draft, setDraft, save } = useFeedbackDraft(session, onSaved);
  return (
    <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-border bg-card/60 p-4 lg:flex">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Prompt</p>
        <p className="mt-1 text-sm text-card-foreground">{session.prompt}</p>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Participants</p>
        <Presence session={session} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Private notes</p>
          <span className="text-[11px] text-muted-foreground">
            {save.state === "saving" ? "Saving…" : save.state === "error" ? "Save failed" : "Autosaved"}
          </span>
        </div>
        <textarea
          aria-label="Private interviewer notes"
          value={draft.notes}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          className="mt-2 min-h-40 flex-1 rounded-md border border-input bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          placeholder="Observations, signals, follow-ups…"
        />
      </div>
      <ScoreGrid draft={draft} setDraft={setDraft} />
    </aside>
  );
}

function ScoreGrid({
  draft,
  setDraft,
  disabled = false,
}: {
  draft: Omit<Feedback, "updatedAt">;
  setDraft: (d: Omit<Feedback, "updatedAt">) => void;
  disabled?: boolean;
}) {
  const labels: [keyof Feedback["scores"], string][] = [
    ["communication", "Communication"],
    ["tradeoffs", "Trade-offs"],
    ["scalability", "Scalability"],
    ["depth", "Technical depth"],
  ];
  return (
    <div className="space-y-3">
      {labels.map(([key, label]) => (
        <div key={key}>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="tabular-nums text-card-foreground">{draft.scores[key] || "—"}/5</span>
          </div>
          <div className="mt-1 flex gap-1" role="group" aria-label={label}>
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                disabled={disabled}
                aria-label={`${label} ${v} of 5`}
                aria-pressed={draft.scores[key] === v}
                onClick={() => setDraft({ ...draft, scores: { ...draft.scores, [key]: v } })}
                className={`h-7 flex-1 rounded border text-xs transition ${
                  draft.scores[key] >= v
                    ? "border-primary bg-primary/20 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                } disabled:opacity-50`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="block space-y-1 text-xs">
        <span className="text-muted-foreground">Recommendation</span>
        <select
          disabled={disabled}
          value={draft.recommendation}
          onChange={(e) => setDraft({ ...draft, recommendation: e.target.value as Feedback["recommendation"] })}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Not set</option>
          <option value="strong_hire">Strong hire</option>
          <option value="hire">Hire</option>
          <option value="lean_hire">Lean hire</option>
          <option value="no_hire">No hire</option>
        </select>
      </label>
    </div>
  );
}

function ReviewView({
  session,
  role,
  onSaved,
}: {
  session: Session;
  role: Role;
  onSaved: (s: Session) => void;
}) {
  const { draft, setDraft, save } = useFeedbackDraft(session, onSaved);
  const duration = useMemo(() => {
    if (!session.startedAt || !session.endedAt) return "—";
    const mins = Math.round(
      (new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000,
    );
    return `${mins} min`;
  }, [session.startedAt, session.endedAt]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to dashboard
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{session.title}</h1>
        <StatusPill status="ended" />
        <span className="text-sm text-muted-foreground">
          {session.candidateName} · {duration} · rev {session.canvas.revision}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">
        <section className="h-[540px] overflow-hidden rounded-lg border border-border bg-card">
          <DesignCanvas
            doc={session.canvas}
            onChange={() => {}}
            readOnly
            lockedReason="Read-only archive"
          />
        </section>
        <aside className="space-y-4 rounded-lg border border-border bg-card p-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Prompt</p>
            <p className="mt-1 text-sm text-card-foreground">{session.prompt}</p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Feedback</p>
            <span className="text-[11px] text-muted-foreground">
              {role !== "interviewer"
                ? "Interviewer only"
                : save.state === "saving"
                  ? "Saving…"
                  : save.state === "error"
                    ? "Save failed"
                    : session.feedback.updatedAt
                      ? `Autosaved ${new Date(session.feedback.updatedAt).toLocaleTimeString()}`
                      : "Autosaved"}
            </span>
          </div>
          {role === "interviewer" ? (
            <>
              <textarea
                aria-label="Interview feedback"
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={7}
                className="w-full rounded-md border border-input bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <ScoreGrid draft={draft} setDraft={setDraft} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Feedback for this session is private to the interview panel.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      {children}
    </div>
  );
}
