import { Navigate } from "react-router";

import DiscoverHome from "@/components/DiscoverHome";
import IntentsIndex from "@/components/intents-home/IntentsIndex";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";

/** Every intent. Desktop: cards beside the sidebar. Phones keep the intents shelf. */
export default function IntentsPage() {
  const { isAuthenticated } = useAuthContext();
  const compact = useCompact();
  if (!isAuthenticated) return <Navigate to={`/login?next=${encodeURIComponent("/intents")}`} replace />;
  return compact ? <DiscoverHome /> : <IntentsIndex />;
}

export const Component = IntentsPage;
