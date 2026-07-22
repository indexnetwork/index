import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import DiscoverHome from "@/components/DiscoverHome";
import LandingPage from "@/app/landing/page";

/**
 * Root route. Renders the chat/discovery app for authenticated users and the
 * public landing page (landing) for guests.
 *
 * AuthContext only mounts route children once auth has settled (it shows a
 * loading screen while pending). The root route is the automatic onboarding
 * redirect entry point for authenticated users who have not finished setup.
 */
function RootPage() {
  const { isAuthenticated } = useAuthContext();

  if (isAuthenticated) {
    return (
      <ClientLayout>
        <DiscoverHome />
      </ClientLayout>
    );
  }

  return <LandingPage />;
}

export default RootPage;
export const Component = RootPage;
