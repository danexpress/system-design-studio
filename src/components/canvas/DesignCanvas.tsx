import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Database,
  Server,
  Smartphone,
  Zap,
  Layers,
  Globe,
  HardDrive,
  Network,
  Cpu,
  Radio,
  MousePointer2,
  Hand,
  Spline,
  StickyNote,
  Pencil,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
  Maximize,
} from "lucide-react";
import type { CanvasDoc, CanvasNode, NodeKind } from "@/services";
import { cn } from "@/lib/utils";

export type Tool = "select" | "pan" | "connect" | "note" | "draw";

const PALETTE: { kind: NodeKind; label: string; icon: typeof Server }[] = [
  { kind: "client", label: "Client", icon: Smartphone },
  { kind: "gateway", label: "API gateway", icon: Network },
  { kind: "loadbalancer", label: "Load balancer", icon: Layers },
  { kind: "service", label: "Service", icon: Server },
  { kind: "database", label: "Database", icon: Database },
  { kind: "cache", label: "Cache", icon: Zap },
  { kind: "queue", label: "Queue", icon: Radio },
  { kind: "worker", label: "Worker", icon: Cpu },
  { kind: "storage", label: "Object storage", icon: HardDrive },
  { kind: "cdn", label: "CDN", icon: Globe },
];

const KIND_ICON = Object.fromEntries(PALETTE.map((p) => [p.kind, p.icon])) as Record<
  NodeKind,
  typeof Server
>;

let localId = 0;
const nid = (p: string) => `${p}_l${(localId += 1)}_${Math.floor(Math.random() * 1e5).toString(36)}`;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.5;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function anchorPoint(from: CanvasNode, to: CanvasNode) {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = tc.x - fc.x;
  const dy = tc.y - fc.y;
  const horizontal = Math.abs(dx) > Math.abs(dy);
  const start = horizontal
    ? { x: fc.x + (dx > 0 ? from.w / 2 : -from.w / 2), y: fc.y }
    : { x: fc.x, y: fc.y + (dy > 0 ? from.h / 2 : -from.h / 2) };
  const end = horizontal
    ? { x: tc.x + (dx > 0 ? -to.w / 2 : to.w / 2), y: tc.y }
    : { x: tc.x, y: tc.y + (dy > 0 ? -to.h / 2 : to.h / 2) };
  return { start, end };
}

interface Props {
  doc: CanvasDoc;
  onChange: (next: CanvasDoc) => void;
  readOnly?: boolean;
  lockedReason?: string | undefined;
}

export function DesignCanvas({ doc, onChange, readOnly = false, lockedReason }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [zoom, setZoom] = useState(0.85);
  const [offset, setOffset] = useState({ x: 20, y: 10 });
  const [selected, setSelected] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [history, setHistory] = useState<CanvasDoc[]>([]);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const panning = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const drawing = useRef<string | null>(null);
  const state = useRef({ zoom, offset, tool, readOnly, doc });
  state.current = { zoom, offset, tool, readOnly, doc };

  const commit = useCallback(
    (next: Partial<CanvasDoc>) => {
      if (state.current.readOnly) return;
      setHistory((h) => [...h.slice(-24), state.current.doc]);
      onChange({ ...state.current.doc, ...next });
    },
    [onChange],
  );

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const { zoom: z, offset: o } = state.current;
    const px = clientX - (rect?.left ?? 0);
    const py = clientY - (rect?.top ?? 0);
    return { x: (px - o.x) / z, y: (py - o.y) / z };
  }, []);

  // Non-passive wheel listener: React's onWheel is passive and cannot preventDefault.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { zoom: z, offset: o } = state.current;
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 0) {
        const dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
        if (!e.ctrlKey && !e.metaKey && e.shiftKey) {
          setOffset({ x: o.x - dy, y: o.y });
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !e.altKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          setOffset({ x: o.x - e.deltaX, y: o.y - e.deltaY });
          return;
        }
        const next = clamp(z * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
        const k = next / z;
        setZoom(next);
        setOffset({ x: px - (px - o.x) * k, y: py - (py - o.y) * k });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const deleteSelected = useCallback(() => {
    const id = selected;
    if (!id || readOnly) return;
    setSelected(null);
    commit({
      nodes: doc.nodes.filter((n) => n.id !== id),
      edges: doc.edges.filter((e) => e.id !== id && e.from !== id && e.to !== id),
      notes: doc.notes.filter((n) => n.id !== id),
      strokes: doc.strokes.filter((s) => s.id !== id),
    });
  }, [selected, readOnly, commit, doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHistory((h) => {
          const prev = h[h.length - 1];
          if (prev) onChange(prev);
          return h.slice(0, -1);
        });
      }
      if (e.key === "v") setTool("select");
      if (e.key === "h") setTool("pan");
      if (e.key === "c") setTool("connect");
      if (e.key === "n") setTool("note");
      if (e.key === "d") setTool("draw");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteSelected, onChange]);

  function addNode(kind: NodeKind, label: string, at?: { x: number; y: number }) {
    if (readOnly) return;
    const pos = at ?? toWorld(
      (wrapRef.current?.getBoundingClientRect().left ?? 0) + 320,
      (wrapRef.current?.getBoundingClientRect().top ?? 0) + 220,
    );
    const node: CanvasNode = {
      id: nid("n"),
      kind,
      label,
      x: Math.round(pos.x - 84),
      y: Math.round(pos.y - 38),
      w: 168,
      h: 76,
    };
    commit({ nodes: [...doc.nodes, node] });
    setSelected(node.id);
  }

  function onSurfaceMouseDown(e: React.MouseEvent) {
    const world = toWorld(e.clientX, e.clientY);
    if (tool === "pan" || e.button === 1 || e.altKey) {
      panning.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      return;
    }
    if (tool === "note" && !readOnly) {
      const note = { id: nid("note"), x: world.x, y: world.y, w: 210, h: 110, text: "New note" };
      commit({ notes: [...doc.notes, note] });
      setSelected(note.id);
      setTool("select");
      return;
    }
    if (tool === "draw" && !readOnly) {
      const stroke = { id: nid("st"), points: [[world.x, world.y]] as [number, number][] };
      drawing.current = stroke.id;
      commit({ strokes: [...doc.strokes, stroke] });
      return;
    }
    setSelected(null);
    setConnectFrom(null);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (panning.current) {
      setOffset({
        x: panning.current.ox + (e.clientX - panning.current.x),
        y: panning.current.oy + (e.clientY - panning.current.y),
      });
      return;
    }
    if (drawing.current) {
      const world = toWorld(e.clientX, e.clientY);
      onChange({
        ...doc,
        strokes: doc.strokes.map((s) =>
          s.id === drawing.current ? { ...s, points: [...s.points, [world.x, world.y]] } : s,
        ),
      });
      return;
    }
    if (drag.current) {
      const world = toWorld(e.clientX, e.clientY);
      const { id, dx, dy } = drag.current;
      onChange({
        ...doc,
        nodes: doc.nodes.map((n) =>
          n.id === id ? { ...n, x: Math.round(world.x - dx), y: Math.round(world.y - dy) } : n,
        ),
        notes: doc.notes.map((n) =>
          n.id === id ? { ...n, x: Math.round(world.x - dx), y: Math.round(world.y - dy) } : n,
        ),
      });
    }
  }

  function endInteraction() {
    if (drag.current || drawing.current) commit({});
    panning.current = null;
    drag.current = null;
    drawing.current = null;
  }

  function onItemMouseDown(e: React.MouseEvent, id: string, x: number, y: number) {
    e.stopPropagation();
    setSelected(id);
    if (tool === "connect") {
      if (!connectFrom) setConnectFrom(id);
      else if (connectFrom !== id) {
        commit({
          edges: [...doc.edges, { id: nid("e"), from: connectFrom, to: id, label: "", dashed: false }],
        });
        setConnectFrom(null);
      }
      return;
    }
    if (readOnly || tool !== "select") return;
    const world = toWorld(e.clientX, e.clientY);
    drag.current = { id, dx: world.x - x, dy: world.y - y };
  }

  const selectedNode = useMemo(() => doc.nodes.find((n) => n.id === selected), [doc.nodes, selected]);
  const selectedNote = useMemo(() => doc.notes.find((n) => n.id === selected), [doc.notes, selected]);
  const selectedEdge = useMemo(() => doc.edges.find((e) => e.id === selected), [doc.edges, selected]);

  function fit() {
    setZoom(0.85);
    setOffset({ x: 20, y: 10 });
  }

  return (
    <div className="flex h-full min-h-0 w-full">
      {/* Palette */}
      <aside className="hidden w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border bg-card/60 p-3 lg:flex">
        <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Components
        </p>
        {PALETTE.map((p) => (
          <button
            key={p.kind}
            type="button"
            disabled={readOnly}
            onClick={() => addNode(p.kind, p.label)}
            className="flex items-center gap-2 rounded-md border border-transparent px-2 py-2 text-left text-sm text-foreground transition hover:border-border hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <p.icon className="h-4 w-4 text-primary" aria-hidden />
            {p.label}
          </button>
        ))}
      </aside>

      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card/60 px-3 py-2">
          {(
            [
              ["select", MousePointer2, "Select (V)"],
              ["pan", Hand, "Pan (H)"],
              ["connect", Spline, "Connect (C)"],
              ["note", StickyNote, "Note (N)"],
              ["draw", Pencil, "Draw (D)"],
            ] as const
          ).map(([t, Icon, title]) => (
            <button
              key={t}
              type="button"
              title={title}
              aria-label={title}
              aria-pressed={tool === t}
              disabled={readOnly && t !== "select" && t !== "pan"}
              onClick={() => setTool(t)}
              className={cn(
                "rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40",
                tool === t && "bg-primary/15 text-primary",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          <span className="mx-2 h-5 w-px bg-border" />
          <button
            type="button"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
            disabled={readOnly || history.length === 0}
            onClick={() => {
              const prev = history[history.length - 1];
              if (prev) onChange(prev);
              setHistory((h) => h.slice(0, -1));
            }}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Delete selection"
            aria-label="Delete selection"
            disabled={readOnly || !selected}
            onClick={deleteSelected}
            className="rounded-md p-2 text-muted-foreground transition hover:bg-accent hover:text-destructive disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <span className="mx-2 h-5 w-px bg-border" />
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom((z) => clamp(z / 1.2, MIN_ZOOM, MAX_ZOOM))}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom((z) => clamp(z * 1.2, MIN_ZOOM, MAX_ZOOM))}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Reset view"
            onClick={fit}
            className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Maximize className="h-4 w-4" />
          </button>
          {readOnly && lockedReason ? (
            <span className="ml-auto rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-400">
              {lockedReason}
            </span>
          ) : null}
        </div>

        {/* Surface */}
        <div
          ref={wrapRef}
          data-testid="canvas-surface"
          role="application"
          aria-label="System design canvas"
          onMouseDown={onSurfaceMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endInteraction}
          onMouseLeave={endInteraction}
          className={cn(
            "relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:24px_24px]",
            tool === "pan" && "cursor-grab",
            tool === "draw" && "cursor-crosshair",
            tool === "connect" && "cursor-cell",
          )}
        >
          <svg className="absolute inset-0 h-full w-full">
            <g transform={`translate(${offset.x} ${offset.y}) scale(${zoom})`}>
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill="var(--color-muted-foreground)" />
                </marker>
              </defs>
              {doc.edges.map((edge) => {
                const from = doc.nodes.find((n) => n.id === edge.from);
                const to = doc.nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const { start, end } = anchorPoint(from, to);
                const mx = (start.x + end.x) / 2;
                const my = (start.y + end.y) / 2;
                return (
                  <g key={edge.id} onMouseDown={(e) => { e.stopPropagation(); setSelected(edge.id); }}>
                    <path
                      d={`M ${start.x} ${start.y} C ${mx} ${start.y}, ${mx} ${end.y}, ${end.x} ${end.y}`}
                      fill="none"
                      stroke={selected === edge.id ? "var(--color-primary)" : "var(--color-muted-foreground)"}
                      strokeWidth={selected === edge.id ? 2.5 : 1.6}
                      strokeDasharray={edge.dashed ? "6 5" : undefined}
                      markerEnd="url(#arrow)"
                    />
                    {edge.label ? (
                      <text x={mx} y={my - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                        {edge.label}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {doc.strokes.map((s) => (
                <polyline
                  key={s.id}
                  points={s.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke="var(--color-chart-2)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          </svg>

          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}
          >
            {doc.nodes.map((n) => {
              const Icon = KIND_ICON[n.kind] ?? Server;
              return (
                <div
                  key={n.id}
                  data-testid="canvas-node"
                  onMouseDown={(e) => onItemMouseDown(e, n.id, n.x, n.y)}
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                  className={cn(
                    "absolute flex select-none flex-col justify-center gap-1 rounded-lg border bg-card px-3 py-2 shadow-sm transition",
                    selected === n.id ? "border-primary ring-2 ring-primary/30" : "border-border",
                    connectFrom === n.id && "ring-2 ring-chart-2",
                    !readOnly && tool === "select" && "cursor-grab",
                  )}
                >
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
                    {n.kind}
                  </div>
                  <div className="text-sm font-medium leading-tight text-card-foreground">{n.label}</div>
                </div>
              );
            })}
            {doc.notes.map((n) => (
              <div
                key={n.id}
                onMouseDown={(e) => onItemMouseDown(e, n.id, n.x, n.y)}
                style={{ left: n.x, top: n.y, width: n.w, minHeight: n.h }}
                className={cn(
                  "absolute whitespace-pre-wrap rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100 shadow-sm",
                  selected === n.id && "ring-2 ring-amber-400/60",
                )}
              >
                {n.text}
              </div>
            ))}
          </div>

          {tool === "connect" ? (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow">
              {connectFrom ? "Now click the target component" : "Click a source component"}
            </div>
          ) : null}
        </div>
      </div>

      {/* Inspector */}
      <aside className="hidden w-64 shrink-0 flex-col gap-3 overflow-y-auto border-l border-border bg-card/60 p-4 xl:flex">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Inspector
        </p>
        {!selected ? (
          <p className="text-sm text-muted-foreground">
            Select a component, connector, or note to edit its details.
          </p>
        ) : null}
        {selectedNode ? (
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Label</span>
            <input
              value={selectedNode.label}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  ...doc,
                  nodes: doc.nodes.map((n) =>
                    n.id === selectedNode.id ? { ...n, label: e.target.value } : n,
                  ),
                })
              }
              onBlur={() => commit({})}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ) : null}
        {selectedNote ? (
          <label className="space-y-1 text-sm">
            <span className="text-xs text-muted-foreground">Note text</span>
            <textarea
              rows={6}
              value={selectedNote.text}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  ...doc,
                  notes: doc.notes.map((n) =>
                    n.id === selectedNote.id ? { ...n, text: e.target.value } : n,
                  ),
                })
              }
              onBlur={() => commit({})}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        ) : null}
        {selectedEdge ? (
          <div className="space-y-3">
            <label className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">Connector label</span>
              <input
                value={selectedEdge.label}
                disabled={readOnly}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    edges: doc.edges.map((n) =>
                      n.id === selectedEdge.id ? { ...n, label: e.target.value } : n,
                    ),
                  })
                }
                onBlur={() => commit({})}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedEdge.dashed}
                disabled={readOnly}
                onChange={(e) =>
                  commit({
                    edges: doc.edges.map((n) =>
                      n.id === selectedEdge.id ? { ...n, dashed: e.target.checked } : n,
                    ),
                  })
                }
              />
              Async / dashed
            </label>
          </div>
        ) : null}
        <div className="mt-auto space-y-1 text-xs text-muted-foreground">
          <p>{doc.nodes.length} components · {doc.edges.length} connectors</p>
          <p>Revision {doc.revision}</p>
        </div>
      </aside>
    </div>
  );
}
