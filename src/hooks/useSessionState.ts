import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ConnectionState, type Session } from "@/services";

export type SaveState = "idle" | "saving" | "saved" | "error";

export function useSessionState(sessionId: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getSession(sessionId)
      .then((s) => alive && setSession(s))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    const unsub = api.subscribe(sessionId, (s) => alive && setSession(s));
    return () => {
      alive = false;
      unsub();
    };
  }, [sessionId]);

  return { session, setSession, loading, error, setError };
}

export function useConnection() {
  const [state, setState] = useState<ConnectionState>("online");
  useEffect(() => api.onConnectionChange(setState), []);
  return state;
}

/** Debounced autosave with explicit save-state feedback. */
export function useAutosave<T>(value: T, save: (v: T) => Promise<unknown>, delay = 700) {
  const [state, setState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    const t = setTimeout(() => {
      saveRef
        .current(value)
        .then(() => {
          setState("saved");
          setMessage(null);
        })
        .catch((e: Error) => {
          setState("error");
          setMessage(e.message);
        });
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  const flush = useCallback(() => setState("idle"), []);
  return { state, message, flush };
}
