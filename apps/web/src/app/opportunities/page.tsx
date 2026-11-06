import { Navigate } from "react-router";

import OpportunitiesPage from "@/components/intents-home/OpportunitiesPage";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";

/** Desktop only: phones keep their own home. */
function Page() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const compact = useCompact();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} replace />;
  if (compact) return <Navigate to="/" replace />;
  return <OpportunitiesPage />;
}

export default Page;
export const Component = Page;
