import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";

import { useAuthContext } from "@/contexts/AuthContext";
import ClientLayout from "@/components/ClientLayout";
import ChatContent from "@/components/ChatContent";
import NegotiatorMemoryPanel from "@/components/NegotiatorMemoryPanel";
import { ContentContainer } from "@/components/layout";

/**
 * Agent page — the general agent chat. Renders the orchestrator conversation
 * (composer + streaming answers). Past conversations are reached via the
 * AgentSessionsPanel in the shell aside; a specific conversation opens at
 * /d/:sessionId (also ChatContent). The previous negotiation-stats content
 * (Overview / Negotiations tabs) was removed. The /agent/memory route is kept
 * so the intent-page Memory shortcut keeps working.
 */
export default function AgentPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const { user, isAuthenticated, isLoading: authLoading } = useAuthContext();

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

  if (tab === "memory") {
    return (
      <ClientLayout>
        <div className="flex-1 px-6 py-6 lg:px-8">
          <ContentContainer>
            <h1 className="mb-6 text-2xl font-bold text-black font-ibm-plex-mono">
              Personal Agent memory
            </h1>
            <NegotiatorMemoryPanel userId={user?.id ?? ""} />
          </ContentContainer>
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
