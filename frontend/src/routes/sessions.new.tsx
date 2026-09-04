import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, type Difficulty } from "@/services";
import { TopBar } from "@/components/app/Shell";

export const Route = createFileRoute("/sessions/new")({
  head: () => ({
    meta: [
      { title: "Create interview session — WhiteboardIQ" },
      {
        name: "description",
        content: "Schedule a new system design interview with a prompt, difficulty, and candidate.",
      },
      { property: "og:title", content: "Create interview session — WhiteboardIQ" },
      {
        property: "og:description",
        content: "Schedule a new system design interview with a prompt, difficulty, and candidate.",
      },
    ],
  }),
  component: NewSession,
});

const PRESETS = [
  { title: "Design a social feed", prompt: "Design the read and write path for a social feed serving 50M DAU." },
  { title: "Design a URL shortener", prompt: "Design a URL shortener with analytics and custom aliases." },
  { title: "Design a chat system", prompt: "Design 1:1 and group messaging with delivery receipts and presence." },
];

type Errors = Partial<Record<string, string>>;

function NewSession() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    prompt: "",
    difficulty: "senior" as Difficulty,
    durationMinutes: 60,
    candidateName: "",
    candidateEmail: "",
    scheduledFor: new Date(Date.now() + 3600_000).toISOString().slice(0, 16),
  });
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (form.title.trim().length < 4) e['title'] = "Give the session a descriptive title";
    if (form.prompt.trim().length < 12) e['prompt'] = "Add a prompt of at least 12 characters";
    if (form.candidateName.trim().length < 2) e['candidateName'] = "Candidate name is required";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.candidateEmail)) e['candidateEmail'] = "Enter a valid email";
    if (form.durationMinutes < 15 || form.durationMinutes > 180) e['durationMinutes'] = "Between 15 and 180 minutes";
    return e;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    setSubmitting(true);
    try {
      const session = await api.createSession({
        ...form,
        scheduledFor: new Date(form.scheduledFor).toISOString(),
      });
      const withLink = await api.createShareLink(session.id);
      navigate({
        to: "/sessions/$sessionId",
        params: { sessionId: withLink.id },
        search: { role: "interviewer" },
      });
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">New interview session</h1>

        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.title}
              type="button"
              onClick={() => setForm((f) => ({ ...f, title: p.title, prompt: p.prompt }))}
              className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
            >
              {p.title}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate className="mt-6 space-y-5 rounded-lg border border-border bg-card p-6">
          <Field label="Session title" error={errors['title']} id="title">
            <input id="title" className={field} value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>

          <Field label="Prompt given to the candidate" error={errors['prompt']} id="prompt">
            <textarea
              id="prompt"
              rows={4}
              className={field}
              value={form.prompt}
              onChange={(e) => set("prompt", e.target.value)}
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Difficulty" id="difficulty">
              <select
                id="difficulty"
                className={field}
                value={form.difficulty}
                onChange={(e) => set("difficulty", e.target.value as Difficulty)}
              >
                {(["junior", "mid", "senior", "staff"] as const).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Duration (minutes)" error={errors['durationMinutes']} id="duration">
              <input
                id="duration"
                type="number"
                className={field}
                value={form.durationMinutes}
                onChange={(e) => set("durationMinutes", Number(e.target.value))}
              />
            </Field>
            <Field label="Candidate name" error={errors['candidateName']} id="cname">
              <input id="cname" className={field} value={form.candidateName} onChange={(e) => set("candidateName", e.target.value)} />
            </Field>
            <Field label="Candidate email" error={errors['candidateEmail']} id="cemail">
              <input id="cemail" type="email" className={field} value={form.candidateEmail} onChange={(e) => set("candidateEmail", e.target.value)} />
            </Field>
            <Field label="Scheduled for" id="when">
              <input
                id="when"
                type="datetime-local"
                className={field}
                value={form.scheduledFor}
                onChange={(e) => set("scheduledFor", e.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Creating…" : "Create session & invite link"}
            </button>
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
              Cancel
            </Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
