import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";

/**
 * Agent page — the general agent chat. Renders the orchestrator conversation
 * (composer + streaming answers). Past conversations are reached via the
 * AgentSessionsPanel in the shell aside; a specific conversation opens at
 * /d/:sessionId (also ChatContent). The previous negotiation-stats content
 * (Overview / Negotiations tabs) was removed.
 */
export default function AgentPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  if (authLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <ChatContent />
    </ClientLayout>
  );
}

export const Component = AgentPage;
