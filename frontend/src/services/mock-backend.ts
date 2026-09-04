// In-memory mock backend. The ONLY place that fabricates data.
// Swap this out for a real HTTP/Cloud implementation behind the same
// `BackendApi` contract in src/services/index.ts.

import type {
  CanvasDoc,
  CreateSessionInput,
  Feedback,
  Participant,
  Session,
  SessionStatus,
} from "./types";

export const PARTICIPANT_COLORS = ["#5eead4", "#fbbf24", "#f472b6", "#93c5fd", "#a3e635"];

let counter = 0;
export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function emptyCanvas(): CanvasDoc {
  return { nodes: [], edges: [], notes: [], strokes: [], revision: 0, updatedAt: iso(0) };
}

export function emptyFeedback(): Feedback {
  return {
    notes: "",
    scores: { communication: 0, tradeoffs: 0, scalability: 0, depth: 0 },
    recommendation: "",
    updatedAt: null,
  };
}

function iso(offsetMinutes: number): string {
  return new Date(Date.UTC(2026, 8, 4, 9, 0, 0) + offsetMinutes * 60_000).toISOString();
}

function participant(name: string, role: Participant["role"], online: boolean, i: number): Participant {
  return {
    id: uid("p"),
    name,
    role,
    online,
    lastSeen: iso(0),
    color: PARTICIPANT_COLORS[i % PARTICIPANT_COLORS.length]!,
  };
}

function seededCanvas(): CanvasDoc {
  const n = (kind: CanvasDoc["nodes"][number]["kind"], label: string, x: number, y: number) => ({
    id: uid("n"),
    kind,
    label,
    x,
    y,
    w: 168,
    h: 76,
  });
  const client = n("client", "Mobile / Web client", 80, 220);
  const cdn = n("cdn", "CDN", 300, 90);
  const lb = n("loadbalancer", "Load balancer", 300, 220);
  const api = n("gateway", "API gateway", 540, 220);
  const feed = n("service", "Feed service", 780, 130);
  const post = n("service", "Post service", 780, 320);
  const cache = n("cache", "Redis timeline cache", 1020, 130);
  const db = n("database", "Postgres (sharded)", 1020, 320);
  const queue = n("queue", "Fanout queue", 780, 470);
  const worker = n("worker", "Fanout workers", 1020, 470);
  const nodes = [client, cdn, lb, api, feed, post, cache, db, queue, worker];
  const e = (from: string, to: string, label = "", dashed = false) => ({
    id: uid("e"),
    from,
    to,
    label,
    dashed,
  });
  return {
    nodes,
    edges: [
      e(client.id, cdn.id, "static"),
      e(client.id, lb.id, "https"),
      e(lb.id, api.id),
      e(api.id, feed.id, "GET /feed"),
      e(api.id, post.id, "POST /post"),
      e(feed.id, cache.id, "read"),
      e(post.id, db.id, "write"),
      e(post.id, queue.id, "publish", true),
      e(queue.id, worker.id, "consume", true),
      e(worker.id, cache.id, "fanout", true),
    ],
    notes: [
      {
        id: uid("note"),
        x: 90,
        y: 430,
        w: 230,
        h: 120,
        text: "Assumptions:\n• 50M DAU\n• 100:1 read/write\n• p99 < 200ms feed read",
      },
    ],
    strokes: [],
    revision: 12,
    updatedAt: iso(-40),
  };
}

function baseSession(over: Partial<Session>): Session {
  return {
    id: uid("s"),
    title: "System design interview",
    prompt: "Design a scalable service.",
    difficulty: "senior",
    durationMinutes: 60,
    candidateName: "Candidate",
    candidateEmail: "candidate@example.com",
    status: "scheduled" as SessionStatus,
    createdAt: iso(-6000),
    scheduledFor: iso(120),
    startedAt: null,
    endedAt: null,
    candidateCanEdit: true,
    share: null,
    participants: [],
    canvas: emptyCanvas(),
    feedback: emptyFeedback(),
    ...over,
  };
}

export function seedSessions(): Session[] {
  return [
    baseSession({
      title: "Design a social feed",
      prompt:
        "Design the read and write path for a social feed serving 50M daily active users. Discuss fanout strategy, caching, and consistency trade-offs.",
      difficulty: "senior",
      candidateName: "Amara Boateng",
      candidateEmail: "amara.boateng@example.com",
      status: "live",
      startedAt: iso(-42),
      scheduledFor: iso(-45),
      share: { token: "shr_feed_9m2k", createdAt: iso(-90), revokedAt: null },
      participants: [
        participant("Fred Offei", "interviewer", true, 0),
        participant("Amara Boateng", "candidate", true, 1),
        participant("Priya Raman (shadow)", "interviewer", false, 2),
      ],
      canvas: seededCanvas(),
    }),
    baseSession({
      title: "Design a URL shortener",
      prompt:
        "Design a URL shortening service handling 500M new links per month with analytics and custom aliases.",
      difficulty: "mid",
      durationMinutes: 45,
      candidateName: "Ken Watanabe",
      candidateEmail: "ken.watanabe@example.com",
      status: "scheduled",
      scheduledFor: iso(180),
      share: { token: "shr_short_4a71", createdAt: iso(-30), revokedAt: null },
      participants: [participant("Fred Offei", "interviewer", false, 0)],
    }),
    baseSession({
      title: "Design a ride-hailing dispatch system",
      prompt:
        "Design real-time driver matching and dispatch for a ride-hailing product in 40 cities.",
      difficulty: "staff",
      durationMinutes: 75,
      candidateName: "Lucia Ferreira",
      candidateEmail: "lucia.ferreira@example.com",
      status: "ended",
      scheduledFor: iso(-2000),
      startedAt: iso(-2000),
      endedAt: iso(-1925),
      candidateCanEdit: false,
      share: { token: "shr_ride_77qd", createdAt: iso(-2200), revokedAt: iso(-1920) },
      participants: [
        participant("Fred Offei", "interviewer", false, 0),
        participant("Lucia Ferreira", "candidate", false, 1),
      ],
      canvas: { ...seededCanvas(), revision: 41 },
      feedback: {
        notes:
          "Strong on geo-sharding and matching latency budgets. Drove the discussion on hot-city partition skew without prompting. Weaker on failure handling for the dispatch worker fleet.",
        scores: { communication: 4, tradeoffs: 5, scalability: 4, depth: 4 },
        recommendation: "hire",
        updatedAt: iso(-1900),
      },
    }),
    baseSession({
      title: "Design a collaborative document editor",
      prompt: "Design real-time collaborative editing with offline support and conflict resolution.",
      difficulty: "senior",
      candidateName: "Tomas Nowak",
      candidateEmail: "tomas.nowak@example.com",
      status: "ended",
      scheduledFor: iso(-5000),
      startedAt: iso(-5000),
      endedAt: iso(-4940),
      candidateCanEdit: false,
      canvas: { ...emptyCanvas(), revision: 3 },
      feedback: {
        notes: "Struggled to move past a single-writer model; needed heavy prompting on CRDTs.",
        scores: { communication: 3, tradeoffs: 2, scalability: 2, depth: 2 },
        recommendation: "no_hire",
        updatedAt: iso(-4900),
      },
    }),
  ];
}

export function newSessionFrom(input: CreateSessionInput): Session {
  return baseSession({
    title: input.title,
    prompt: input.prompt,
    difficulty: input.difficulty,
    durationMinutes: input.durationMinutes,
    candidateName: input.candidateName,
    candidateEmail: input.candidateEmail,
    scheduledFor: input.scheduledFor,
    createdAt: new Date().toISOString(),
    participants: [participant("Fred Offei", "interviewer", false, 0)],
  });
}
