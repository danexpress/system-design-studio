import { Link } from "@tanstack/react-router";
import { Waypoints } from "lucide-react";
import type { ReactNode } from "react";

export function TopBar({ right }: { right?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-border bg-card/70 px-4 backdrop-blur">
      <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-foreground">
        <Waypoints className="h-5 w-5 text-primary" aria-hidden />
        Whiteboard<span className="text-primary">IQ</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </header>
  );
}

export function StatusPill({ status }: { status: "scheduled" | "live" | "ended" }) {
  const map = {
    scheduled: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    live: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    ended: "bg-muted text-muted-foreground border-border",
  } as const;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${map[status]}`}>
      {status === "live" ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" /> : null}
      {status === "live" ? "Live" : status === "scheduled" ? "Scheduled" : "Ended"}
    </span>
  );
}

export function ConnectionBadge({ state }: { state: "online" | "reconnecting" | "offline" }) {
  if (state === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden /> Connected
      </span>
    );
  }
  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300"
    >
      <span className="h-2 w-2 animate-ping rounded-full bg-amber-400" aria-hidden />
      {state === "reconnecting" ? "Reconnecting…" : "Offline"}
    </span>
  );
}
