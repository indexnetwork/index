import { Navigate } from "react-router";

import IntentsPage from "@/components/intents-home/IntentsPage";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";

/** Desktop only: phones keep their own home. */
function Page() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const compact = useCompact();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} replace />;
  if (compact) return <Navigate to="/" replace />;
  return <IntentsPage />;
}

export default Page;
export const Component = Page;
