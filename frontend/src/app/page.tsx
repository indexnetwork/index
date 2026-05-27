import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";
import LandingPage from "@/app/landing/page";

/**
 * Root route. Renders the chat/discovery app for authenticated users and the
 * public landing page (landing) for guests.
 *
 * AuthContext only mounts route children once auth has settled (it shows a
 * loading screen while pending) and already redirects authenticated-but-not-
 * onboarded users to /onboarding, so `isAuthenticated` is reliable here.
 */
function RootPage() {
  const { isAuthenticated } = useAuthContext();

  if (isAuthenticated) {
    return (
      <ClientLayout>
        <ChatContent />
      </ClientLayout>
    );
  }

  return <LandingPage />;
}

export default RootPage;
export const Component = RootPage;
