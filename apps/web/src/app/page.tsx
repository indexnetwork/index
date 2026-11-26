import { useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { needsOnboarding } from "@/services/onboarding";
import { takePendingPairRedirect } from "@/lib/pending-pair";
import { clearAfterFirstRun, readAfterFirstRun } from "@/lib/after-first-run";
import DiscoverHome from "@/components/DiscoverHome";
import HomeDashboard from "@/components/intents-home/HomeDashboard";
import { showsDashboard } from "@/components/intents-home/personal-questions";
import { useCompact } from "@/hooks/useCompact";
import LandingPage from "@/app/landing/page";

/**
 * Root route. Renders the chat/discovery app for authenticated users and the
 * public landing page (landing) for guests.
 *
 * AuthContext only mounts route children once auth has settled (it shows a
 * loading screen while pending).
 */
function RootPage() {
  const { isAuthenticated, user } = useAuthContext();
  const compact = useCompact();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  // First run ends here. Where the account was headed before it (a network it
  // joined, a chat a link opened) comes next.
  const [afterFirstRun] = useState(() => (isAuthenticated && !needsOnboarding(user) ? readAfterFirstRun() : null));
  useEffect(() => {
    if (!afterFirstRun) return;
    clearAfterFirstRun();
    navigate(afterFirstRun, { replace: true });
  }, [afterFirstRun, navigate]);

  if (isAuthenticated) {
    // Same durable gate as the Mac app: an unconfirmed profile reviews it first.
    if (needsOnboarding(user)) return <Navigate to="/onboarding" replace />;
    // Onboarding ends here. Someone who signed up from a profile's "pair agents"
    // goes back to that profile, which finishes the pair.
    const pendingPairPath = takePendingPairRedirect();
    if (pendingPairPath) return <Navigate to={pendingPairPath} replace />;
    if (afterFirstRun) return null;
    // Desktop: the dashboard beside the sidebar. Phones keep the shelf,
    // except when a /q/<id> link brought them to a question.
    return showsDashboard(compact, params.get("q")) ? <HomeDashboard /> : <DiscoverHome />;
  }

  return <LandingPage />;
}

export default RootPage;
export const Component = RootPage;
