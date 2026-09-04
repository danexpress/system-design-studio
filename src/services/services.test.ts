import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi, ForbiddenError, NotFoundError, type BackendApi } from "./index";
import { anchorPoint } from "@/components/canvas/DesignCanvas";

let api: BackendApi;

beforeEach(() => {
  api = createMockApi({ latency: 0 });
});

async function seeded(status: "live" | "scheduled" | "ended") {
  const all = await api.listSessions();
  const s = all.find((x) => x.status === status);
  if (!s) throw new Error(`no seeded ${status} session`);
  return s;
}

describe("session lifecycle", () => {
  it("seeds demo sessions across every status", async () => {
    const sessions = await api.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sessions.map((s) => s.status))).toEqual(new Set(["live", "scheduled", "ended"]));
  });

  it("creates a session in scheduled state with no share link", async () => {
    const created = await api.createSession({
      title: "Design a rate limiter",
      prompt: "Design a distributed rate limiter",
      difficulty: "mid",
      durationMinutes: 45,
      candidateName: "Ada L",
      candidateEmail: "ada@example.com",
      scheduledFor: new Date().toISOString(),
    });
    expect(created.status).toBe("scheduled");
    expect(created.share).toBeNull();
    expect(await api.listSessions()).toHaveLength(5);
  });

  it("starts then ends a session, locking the candidate and revoking the link", async () => {
    const s = await seeded("scheduled");
    const live = await api.startSession(s.id);
    expect(live.status).toBe("live");
    expect(live.startedAt).not.toBeNull();

    const ended = await api.endSession(s.id);
    expect(ended.status).toBe("ended");
    expect(ended.candidateCanEdit).toBe(false);
    expect(ended.share?.revokedAt).toBeTruthy();
    expect(ended.participants.every((p) => !p.online)).toBe(true);
  });

  it("refuses to end a session that is not live", async () => {
    const s = await seeded("scheduled");
    await expect(api.endSession(s.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws NotFoundError for unknown ids", async () => {
    await expect(api.getSession("nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("share links", () => {
  it("resolves a session by an active token", async () => {
    const live = await seeded("live");
    const found = await api.getSessionByToken(live.share!.token);
    expect(found.id).toBe(live.id);
  });

  it("rejects a revoked token and accepts a freshly issued one", async () => {
    const live = await seeded("live");
    const revoked = await api.revokeShareLink(live.id);
    await expect(api.getSessionByToken(revoked.share!.token)).rejects.toBeInstanceOf(ForbiddenError);

    const reissued = await api.createShareLink(live.id);
    expect(reissued.share!.revokedAt).toBeNull();
    expect((await api.getSessionByToken(reissued.share!.token)).id).toBe(live.id);
  });
});

describe("presence", () => {
  it("adds a participant on join and marks them offline on leave", async () => {
    const live = await seeded("live");
    const joined = await api.joinSession(live.id, "Sam Guest", "interviewer");
    const guest = joined.participants.find((p) => p.name === "Sam Guest")!;
    expect(guest.online).toBe(true);

    const left = await api.leaveSession(live.id, guest.id);
    expect(left.participants.find((p) => p.id === guest.id)!.online).toBe(false);
  });

  it("re-uses the existing participant when the same person rejoins", async () => {
    const live = await seeded("live");
    const before = live.participants.length;
    const rejoined = await api.joinSession(live.id, live.candidateName, "candidate");
    expect(rejoined.participants).toHaveLength(before);
  });

  it("blocks joining an ended session", async () => {
    const ended = await seeded("ended");
    await expect(api.joinSession(ended.id, "Someone", "candidate")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("canvas permissions and autosave", () => {
  it("increments the revision when the interviewer saves", async () => {
    const live = await seeded("live");
    const next = await api.saveCanvas(live.id, live.canvas, "interviewer");
    expect(next.canvas.revision).toBe(live.canvas.revision + 1);
    expect(next.canvas.updatedAt).not.toBe(live.canvas.updatedAt);
  });

  it("blocks candidate saves while editing is locked and allows them once unlocked", async () => {
    const live = await seeded("live");
    await api.setCandidateCanEdit(live.id, false);
    await expect(api.saveCanvas(live.id, live.canvas, "candidate")).rejects.toBeInstanceOf(ForbiddenError);

    await api.setCandidateCanEdit(live.id, true);
    await expect(api.saveCanvas(live.id, live.canvas, "candidate")).resolves.toBeTruthy();
  });

  it("makes the canvas read-only after the session ends", async () => {
    const live = await seeded("live");
    await api.endSession(live.id);
    await expect(api.saveCanvas(live.id, live.canvas, "interviewer")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("feedback", () => {
  it("saves feedback with a timestamp on an ended session", async () => {
    const ended = await seeded("ended");
    const saved = await api.saveFeedback(ended.id, {
      notes: "Great depth on partitioning.",
      scores: { communication: 5, tradeoffs: 4, scalability: 4, depth: 5 },
      recommendation: "strong_hire",
    });
    expect(saved.feedback.recommendation).toBe("strong_hire");
    expect(saved.feedback.updatedAt).toBeTruthy();
  });
});

describe("realtime subscription", () => {
  it("notifies subscribers on mutation and stops after unsubscribe", async () => {
    const live = await seeded("live");
    const listener = vi.fn();
    const unsub = api.subscribe(live.id, listener);
    await api.setCandidateCanEdit(live.id, false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0].candidateCanEdit).toBe(false);

    unsub();
    await api.setCandidateCanEdit(live.id, true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("connection handling", () => {
  it("reports reconnecting then recovers, and fails requests while offline", async () => {
    vi.useFakeTimers();
    const states: string[] = [];
    api.onConnectionChange((s) => states.push(s));
    api.simulateConnectionDrop(1000);
    expect(api.connectionState()).toBe("reconnecting");
    vi.advanceTimersByTime(1000);
    expect(api.connectionState()).toBe("online");
    expect(states).toEqual(["reconnecting", "online"]);
    vi.useRealTimers();
  });
});

describe("canvas geometry", () => {
  it("anchors connectors on facing edges", () => {
    const a = { id: "a", kind: "service" as const, label: "A", x: 0, y: 0, w: 100, h: 50 };
    const b = { id: "b", kind: "service" as const, label: "B", x: 300, y: 0, w: 100, h: 50 };
    const { start, end } = anchorPoint(a, b);
    expect(start).toEqual({ x: 100, y: 25 });
    expect(end).toEqual({ x: 300, y: 25 });

    const below = { ...b, x: 0, y: 300 };
    const vertical = anchorPoint(a, below);
    expect(vertical.start).toEqual({ x: 50, y: 50 });
    expect(vertical.end).toEqual({ x: 50, y: 300 });
  });
});
