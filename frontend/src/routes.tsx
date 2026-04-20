import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useParams } from "react-router";

import { AuthProvider } from "@/contexts/AuthContext";
import { APIProvider } from "@/contexts/APIContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DiscoveryFilterProvider } from "@/contexts/DiscoveryFilterContext";
import { AIChatSessionsProvider } from "@/contexts/AIChatSessionsContext";
import { AIChatProvider } from "@/contexts/AIChatContext";

import ClientWrapper from "@/components/ClientWrapper";

/** Redirect legacy `/index/:id` URLs to `/network/:id`. */
function LegacyIndexRedirect() {
  const { indexId } = useParams();
  return <Navigate to={`/network/${indexId ?? ""}`} replace />;
}

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
                <ClientWrapper>
                  <ScrollRestoration />
                  <Outlet />
                </ClientWrapper>
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
    children: [
      {
        path: "/",
        lazy: () => import("@/app/page"),
      },
      {
        path: "/about",
        lazy: () => import("@/app/about/page"),
      },
      {
        path: "/found-in-translation",
        lazy: () => import("@/app/found-in-translation/page"),
      },
      {
        path: "/blog",
        lazy: () => import("@/app/blog/page"),
      },
      {
        path: "/blog/:slug",
        lazy: () => import("@/app/blog/[slug]/page"),
      },
      {
        path: "/chat",
        lazy: () => import("@/app/chat/page"),
      },
      {
        path: "/chat/:conversationId",
        lazy: () => import("@/app/chat/[conversationId]/page"),
      },
      {
        path: "/d/:id",
        lazy: () => import("@/app/d/[id]/page"),
      },
      {
        path: "/index/:indexId",
        element: <LegacyIndexRedirect />,
      },
      {
        path: "/network/:networkId",
        lazy: () => import("@/app/network/[networkId]/page"),
      },
      {
        path: "/l/:code",
        lazy: () => import("@/app/l/[code]/page"),
      },
      {
        path: "/agents",
        lazy: () => import("@/app/agents/page"),
      },
      {
        path: "/agents/:id",
        lazy: () => import("@/app/agents/[id]/page"),
      },
      {
        path: "/library/:tab?",
        lazy: () => import("@/app/library/page"),
      },
      {
        path: "/networks",
        lazy: () => import("@/app/networks/page"),
      },
      {
        path: "/networks/:id/*",
        lazy: () => import("@/app/networks/[id]/page"),
      },
      {
        path: "/mynetwork/*",
        lazy: () => import("@/app/mynetwork/page"),
      },
      {
        path: "/pages/privacy-policy",
        lazy: () => import("@/app/pages/privacy-policy/page"),
      },
      {
        path: "/pages/terms-of-use",
        lazy: () => import("@/app/pages/terms-of-use/page"),
      },
      {
        path: "/profile",
        lazy: () => import("@/app/profile/page"),
      },
      
      {
        path: "/s/:token",
        lazy: () => import("@/app/s/[token]/page"),
      },
      {
        path: "/u/:id",
        lazy: () => import("@/app/u/[id]/page"),
      },
      {
        path: "/u/:id/chat",
        lazy: () => import("@/app/u/[id]/chat/page"),
      },
      {
        path: "/onboarding",
        lazy: () => import("@/app/onboarding/page"),
      },
      {
        path: "/oauth/callback",
        lazy: () => import("@/app/oauth/callback/page"),
      },
      {
        path: "/cli-auth",
        lazy: () => import("@/app/cli-auth/page"),
      },
      {
        path: "/login",
        lazy: () => import("@/app/login/page"),
      },
      {
        path: "/dev/intent-proposal",
        lazy: () => import("@/app/dev/intent-proposal/page"),
      },
      {
        path: "/agent/:tab?",
        lazy: () => import("@/app/agent/page"),
      },
      {
        path: "/settings",
        element: <Navigate to="/agents" replace />,
      },
      {
        path: "*",
        lazy: () => import("@/app/not-found"),
      },
    ],
  },
]);
