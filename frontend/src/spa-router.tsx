import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { Dashboard } from "./routes/index";
import { JoinPage } from "./routes/join.$token";
import { SessionPage } from "./routes/sessions.$sessionId";
import { NewSession } from "./routes/sessions.new";
import type { Role } from "./services";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
  notFoundComponent: NotFound,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const newSessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/new",
  component: NewSession,
});

const joinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/join/$token",
  component: JoinPage,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$sessionId",
  validateSearch: (search: Record<string, unknown>): { role: Role } => ({
    role: search["role"] === "candidate" ? "candidate" : "interviewer",
  }),
  component: SessionPage,
});

const routeTree = rootRoute.addChildren([indexRoute, newSessionRoute, joinRoute, sessionRoute]);

export function getSpaRouter() {
  const queryClient = new QueryClient();
  return createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });
}

function RootComponent() {
  const { queryClient } = rootRoute.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}

function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center">
        <h1 className="text-4xl font-semibold text-foreground">Page not found</h1>
        <Link to="/" className="mt-4 inline-block text-primary hover:underline">
          Go home
        </Link>
      </div>
    </main>
  );
}
