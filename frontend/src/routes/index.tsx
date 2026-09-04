import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Copy, Link2, Link2Off, Plus, Search, Users } from "lucide-react";
import { api, type Session } from "@/services";
import { StatusPill, TopBar } from "@/components/app/Shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Interviewer dashboard — WhiteboardIQ" },
      {
        name: "description",
        content:
          "Run system design interviews on a shared canvas: schedule sessions, share invite links, and review candidate feedback.",
      },
      { property: "og:title", content: "Interviewer dashboard — WhiteboardIQ" },
      {
        property: "og:description",
        content: "Schedule, run, and review system design interviews on a live shared canvas.",
      },
    ],
  }),
  component: Dashboard,
});

function shareUrl(token: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/join/${token}`;
}

function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "live" | "scheduled" | "ended">("all");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = () => api.listSessions().then(setSessions);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const visible = useMemo(
    () =>
      sessions.filter(
        (s) =>
          (filter === "all" || s.status === filter) &&
          (s.title + s.candidateName).toLowerCase().includes(query.toLowerCase()),
      ),
    [sessions, filter, query],
  );

  const stats = useMemo(
    () => ({
      live: sessions.filter((s) => s.status === "live").length,
      scheduled: sessions.filter((s) => s.status === "scheduled").length,
      ended: sessions.filter((s) => s.status === "ended").length,
    }),
    [sessions],
  );

  async function toggleLink(s: Session) {
    const next = s.share && !s.share.revokedAt ? await api.revokeShareLink(s.id) : await api.createShareLink(s.id);
    setSessions((prev) => prev.map((x) => (x.id === next.id ? next : x)));
    setToast(next.share?.revokedAt ? "Invite link revoked" : "New invite link created");
  }

  async function copyLink(s: Session) {
    if (!s.share || s.share.revokedAt) return;
    try {
      await navigator.clipboard.writeText(shareUrl(s.share.token));
      setToast("Invite link copied to clipboard");
    } catch {
      setToast(shareUrl(s.share.token));
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <TopBar
        right={
          <Link
            to="/sessions/new"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New session
          </Link>
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Interview sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every session gets a shared canvas, presence, and autosaved feedback.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["Live now", stats.live],
              ["Scheduled", stats.scheduled],
              ["Completed", stats.ended],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-card-foreground">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title or candidate"
              aria-label="Search sessions"
              className="w-full rounded-md border border-input bg-card py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex gap-1 rounded-md border border-border bg-card p-1" role="tablist">
            {(["all", "live", "scheduled", "ended"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1.5 text-sm capitalize transition ${
                  filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? <p className="text-sm text-muted-foreground">Loading sessions…</p> : null}
          {!loading && visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No sessions match your filters.
            </p>
          ) : null}
          {visible.map((s) => {
            const linkActive = Boolean(s.share && !s.share.revokedAt);
            return (
              <article
                key={s.id}
                className="rounded-lg border border-border bg-card p-4 transition hover:border-primary/40"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-semibold text-card-foreground">{s.title}</h2>
                      <StatusPill status={s.status} />
                      <span className="rounded border border-border px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">
                        {s.difficulty}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{s.prompt}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" /> {s.candidateName}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5" />
                        {new Date(s.scheduledFor).toLocaleString()} · {s.durationMinutes} min
                      </span>
                      <span>
                        {s.participants.filter((p) => p.online).length} online · rev {s.canvas.revision}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => copyLink(s)}
                      disabled={!linkActive}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-40"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy link
                    </button>
                    <button
                      onClick={() => toggleLink(s)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground transition hover:bg-accent"
                    >
                      {linkActive ? <Link2Off className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                      {linkActive ? "Revoke" : "Create link"}
                    </button>
                    <Link
                      to="/sessions/$sessionId"
                      params={{ sessionId: s.id }}
                      search={{ role: "interviewer" }}
                      className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/90"
                    >
                      {s.status === "ended" ? "Review" : s.status === "live" ? "Rejoin" : "Open"}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {toast ? (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-md border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
