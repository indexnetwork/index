import { createBrowserRouter, Navigate, Outlet, ScrollRestoration } from "react-router";

import { AuthProvider } from "@/contexts/AuthContext";
import { APIProvider } from "@/contexts/APIContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DiscoveryFilterProvider } from "@/contexts/DiscoveryFilterContext";
import { AIChatSessionsProvider } from "@/contexts/AIChatSessionsContext";
import { AIChatProvider } from "@/contexts/AIChatContext";
import { QuestionsProvider } from "@/contexts/QuestionsContext";

import ClientWrapper from "@/components/ClientWrapper";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { lazyRoute } from "@/lib/lazy-route-recovery";

/**
 * Root layout that wraps all routes with the provider tree and app shell.
 * Mirrors the provider nesting from the original Next.js layout.tsx.
 */
function RootLayout() {
  return (
    <AuthProvider>
      <APIProvider>
        <NotificationProvider>
          <DiscoveryFilterProvider>
            <AIChatSessionsProvider>
              <AIChatProvider>
                <QuestionsProvider>
                  <ClientWrapper>
                    <ScrollRestoration />
                    <Outlet />
                  </ClientWrapper>
                </QuestionsProvider>
              </AIChatProvider>
            </AIChatSessionsProvider>
          </DiscoveryFilterProvider>
        </NotificationProvider>
      </APIProvider>
    </AuthProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: "/",
        lazy: lazyRoute("/", () => import("@/app/page")),
      },
      {
        path: "/about",
        lazy: lazyRoute("/about", () => import("@/app/about/page")),
      },
      {
        path: "/waitlist",
        lazy: lazyRoute("/waitlist", () => import("@/app/waitlist/page")),
      },
      {
        path: "/found-in-translation",
        lazy: lazyRoute("/found-in-translation", () => import("@/app/found-in-translation/page")),
      },
      {
        path: "/overview",
        lazy: lazyRoute("/overview", () => import("@/app/overview/page")),
      },
      {
        path: "/protocol",
        lazy: lazyRoute("/protocol", () => import("@/app/protocol/page")),
      },
      {
        path: "/blog",
        lazy: lazyRoute("/blog", () => import("@/app/blog/page")),
      },
      {
        path: "/blog/:slug",
        lazy: lazyRoute("/blog/:slug", () => import("@/app/blog/[slug]/page")),
      },
      {
        path: "/chat",
        lazy: lazyRoute("/chat", () => import("@/app/chat/page")),
      },
      {
        path: "/chat/:conversationId",
        lazy: lazyRoute("/chat/:conversationId", () => import("@/app/chat/[conversationId]/page")),
      },
      {
        path: "/negotiations",
        lazy: lazyRoute("/negotiations", () => import("@/app/negotiations/page")),
      },
      {
        path: "/d/:id",
        lazy: lazyRoute("/d/:id", () => import("@/app/d/[id]/page")),
      },
      {
        path: "/i/new",
        lazy: lazyRoute("/i/new", () => import("@/app/i/new/page")),
      },
      {
        path: "/i/:intentId",
        lazy: lazyRoute("/i/:intentId", () => import("@/app/i/[intentId]/page")),
      },
      {
        path: "/c/:code",
        lazy: lazyRoute("/c/:code", () => import("@/app/c/[code]/page")),
      },
      {
        path: "/o/:id",
        lazy: lazyRoute("/o/:id", () => import("@/app/o/[id]/page")),
      },
      {
        path: "/download",
        lazy: lazyRoute("/download", () => import("@/app/download/page")),
      },
      {
        path: "/l/:code",
        lazy: lazyRoute("/l/:code", () => import("@/app/l/[code]/page")),
      },
      {
        path: "/agents",
        lazy: lazyRoute("/agents", () => import("@/app/agents/page")),
      },
      {
        path: "/agents/:id",
        lazy: lazyRoute("/agents/:id", () => import("@/app/agents/[id]/page")),
      },
      {
        path: "/networks",
        lazy: lazyRoute("/networks", () => import("@/app/networks/page")),
      },
      {
        path: "/networks/:id/*",
        lazy: lazyRoute("/networks/:id/*", () => import("@/app/networks/[id]/page")),
      },
      {
        path: "/mynetwork/*",
        lazy: lazyRoute("/mynetwork/*", () => import("@/app/mynetwork/page")),
      },
      {
        path: "/pages/privacy-policy",
        lazy: lazyRoute("/pages/privacy-policy", () => import("@/app/pages/privacy-policy/page")),
      },
      {
        path: "/pages/terms-of-use",
        lazy: lazyRoute("/pages/terms-of-use", () => import("@/app/pages/terms-of-use/page")),
      },
      {
        path: "/settings",
        lazy: lazyRoute("/settings", () => import("@/app/settings/page")),
      },
      {
        path: "/questions",
        lazy: lazyRoute("/questions", () => import("@/app/questions/page")),
      },
      {
        path: "/profile",
        element: <Navigate to="/settings" replace />,
      },
      {
        path: "/s/:token",
        lazy: lazyRoute("/s/:token", () => import("@/app/s/[token]/page")),
      },
      {
        path: "/u/:id",
        lazy: lazyRoute("/u/:id", () => import("@/app/u/[id]/page")),
      },
      {
        path: "/u/:id/chat",
        lazy: lazyRoute("/u/:id/chat", () => import("@/app/u/[id]/chat/page")),
      },
      {
        path: "/opportunities/:id/skip",
        lazy: lazyRoute("/opportunities/:id/skip", () => import("@/app/opportunities/[id]/skip/page")),
      },
      {
        path: "/oauth/callback",
        lazy: lazyRoute("/oauth/callback", () => import("@/app/oauth/callback/page")),
      },
      {
        path: "/cli-auth",
        lazy: lazyRoute("/cli-auth", () => import("@/app/cli-auth/page")),
      },
      {
        path: "/login",
        lazy: lazyRoute("/login", () => import("@/app/login/page")),
      },
      {
        path: "/dev/intent-proposal",
        lazy: lazyRoute("/dev/intent-proposal", () => import("@/app/dev/intent-proposal/page")),
      },
      {
        path: "/agent/:tab?",
        lazy: lazyRoute("/agent/:tab?", () => import("@/app/agent/page")),
      },
      {
        path: "*",
        lazy: lazyRoute("*", () => import("@/app/not-found")),
      },
    ],
  },
]);
