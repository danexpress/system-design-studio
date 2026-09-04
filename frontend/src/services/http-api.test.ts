import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http-api";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("HTTP backend client", () => {
  it("logs in once and reuses the interviewer bearer token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ accessToken: "interviewer-token", tokenType: "bearer" }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json([]));
    const api = createHttpApi({ baseUrl: "http://api.test/api", fetch: fetcher });

    await api.listSessions();
    await api.listSessions();

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://api.test/api/auth/token");
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      email: "interviewer@example.com",
      password: "interviewer-password",
    });
    const firstRequestHeaders = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    const secondRequestHeaders = new Headers(fetcher.mock.calls[2]?.[1]?.headers);
    expect(firstRequestHeaders.get("Authorization")).toBe("Bearer interviewer-token");
    expect(secondRequestHeaders.get("Authorization")).toBe("Bearer interviewer-token");
  });

  it("uses candidate credentials for candidate session requests", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ accessToken: "candidate-token", tokenType: "bearer" }))
      .mockResolvedValueOnce(json({ id: "s_live_feed" }));
    const api = createHttpApi({ baseUrl: "http://api.test/api", fetch: fetcher });

    await api.getSession("s_live_feed", "candidate");

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      email: "candidate@example.com",
      password: "candidate-password",
    });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer candidate-token",
    );
  });

  it("does not authenticate public invite lookups", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ id: "s_live_feed" }));
    const api = createHttpApi({ baseUrl: "http://api.test/api", fetch: fetcher });

    await api.getSessionByToken("invite/token");

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://api.test/api/invites/invite%2Ftoken");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Authorization")).toBe(false);
  });

  it("refreshes a rejected token once", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ accessToken: "expired", tokenType: "bearer" }))
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockResolvedValueOnce(json({ accessToken: "fresh", tokenType: "bearer" }))
      .mockResolvedValueOnce(json([]));
    const api = createHttpApi({ baseUrl: "http://api.test/api", fetch: fetcher });

    await expect(api.listSessions()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(new Headers(fetcher.mock.calls[3]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer fresh",
    );
  });

  it("decodes full session snapshots from the event stream", async () => {
    const encoded = new TextEncoder().encode(
      'event: session:updated\ndata: {"type":"session:updated","session":{"id":"s_live_feed"}}\n\n',
    );
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ accessToken: "token", tokenType: "bearer" }))
      .mockResolvedValueOnce(
        new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      );
    const api = createHttpApi({
      baseUrl: "http://api.test/api",
      fetch: fetcher,
      reconnectDelayMs: 60_000,
    });

    let unsubscribe = () => {};
    const received = new Promise<string>((resolve) => {
      unsubscribe = api.subscribe("s_live_feed", (session) => resolve(session.id));
    });

    await expect(received).resolves.toBe("s_live_feed");
    unsubscribe();
  });
});
