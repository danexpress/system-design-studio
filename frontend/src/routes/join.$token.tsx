import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { api, type Session } from "@/services";
import { TopBar } from "@/components/app/Shell";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [
      { title: "Join interview — WhiteboardIQ" },
      { name: "description", content: "Join your scheduled system design interview via invite link." },
      { property: "og:title", content: "Join interview — WhiteboardIQ" },
      { property: "og:description", content: "Join your scheduled system design interview via invite link." },
    ],
  }),
  component: JoinPage,
});

function JoinPage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSessionByToken(token)
      .then(setSession)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <main className="mx-auto max-w-md px-4 py-20 text-center">
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">Link unavailable</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Link to="/" className="mt-6 inline-block text-sm text-primary hover:underline">
              Go to dashboard
            </Link>
          </>
        ) : !session ? (
          <p className="text-sm text-muted-foreground">Checking your invite…</p>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">{session.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Welcome {session.candidateName}. You're joining as the candidate.
            </p>
            <button
              onClick={() =>
                navigate({
                  to: "/sessions/$sessionId",
                  params: { sessionId: session.id },
                  search: { role: "candidate" },
                })
              }
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Enter lobby
            </button>
          </>
        )}
      </main>
    </div>
  );
}
