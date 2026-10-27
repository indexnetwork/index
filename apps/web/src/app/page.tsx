import { Navigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { needsOnboarding } from "@/services/onboarding";
import { takePendingPairRedirect } from "@/lib/pending-pair";
import DiscoverHome from "@/components/DiscoverHome";
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

  if (isAuthenticated) {
    // Same durable gate as the Mac app: an unconfirmed profile reviews it first.
    if (needsOnboarding(user)) return <Navigate to="/onboarding" replace />;
    // Onboarding ends here. Someone who signed up from a profile's "pair agents"
    // goes back to that profile, which finishes the pair.
    const pendingPairPath = takePendingPairRedirect();
    if (pendingPairPath) return <Navigate to={pendingPairPath} replace />;
    return <DiscoverHome />;
  }

  return <LandingPage />;
}

export default RootPage;
export const Component = RootPage;
