// Shared domain types for the System Design Interview Platform.

export type SessionStatus = "scheduled" | "live" | "ended";
export type Difficulty = "junior" | "mid" | "senior" | "staff";
export type Role = "interviewer" | "candidate";

export interface ShareLink {
  token: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface Participant {
  id: string;
  name: string;
  role: Role;
  online: boolean;
  lastSeen: string;
  color: string;
}

export type NodeKind =
  | "client"
  | "service"
  | "database"
  | "cache"
  | "queue"
  | "loadbalancer"
  | "cdn"
  | "storage"
  | "gateway"
  | "worker";

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  dashed: boolean;
}

export interface CanvasNote {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

export interface CanvasStroke {
  id: string;
  points: [number, number][];
}

export interface CanvasDoc {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  notes: CanvasNote[];
  strokes: CanvasStroke[];
  revision: number;
  updatedAt: string;
}

export interface Feedback {
  notes: string;
  scores: { communication: number; tradeoffs: number; scalability: number; depth: number };
  recommendation: "strong_hire" | "hire" | "lean_hire" | "no_hire" | "";
  updatedAt: string | null;
}

export interface Session {
  id: string;
  title: string;
  prompt: string;
  difficulty: Difficulty;
  durationMinutes: number;
  candidateName: string;
  candidateEmail: string;
  status: SessionStatus;
  createdAt: string;
  scheduledFor: string;
  startedAt: string | null;
  endedAt: string | null;
  candidateCanEdit: boolean;
  share: ShareLink | null;
  participants: Participant[];
  canvas: CanvasDoc;
  feedback: Feedback;
}

export interface CreateSessionInput {
  title: string;
  prompt: string;
  difficulty: Difficulty;
  durationMinutes: number;
  candidateName: string;
  candidateEmail: string;
  scheduledFor: string;
}

export type ConnectionState = "online" | "reconnecting" | "offline";

export interface SessionEvent {
  type: "session:updated";
  session: Session;
}
