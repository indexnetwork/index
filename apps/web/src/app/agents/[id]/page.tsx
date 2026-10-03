import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import ClientLayout from "@/components/ClientLayout";
import { Stage, Window } from "@/components/workbench/Workbench";
import NegotiationHistory from "@/components/NegotiationHistory";
import type { Agent } from "@/services/agents";

const SYSTEM_AGENT_IDS = {
  negotiator: "00000000-0000-0000-0000-000000000002",
} as const;

function AgentOverview({
  agent,
  userId,
}: {
  agent: Agent;
  userId: string;
}) {
  const isNegotiator = agent.id === SYSTEM_AGENT_IDS.negotiator;

  if (isNegotiator) {
    return <NegotiationHistory userId={userId} />;
  }

  return (
    <div className="space-y-6">
      <div style={{ border: "1px solid #000", padding: 16, background: "#fff" }}>
        <p style={{ margin: "0 0 8px", fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>agent</p>
        <p style={{ margin: 0, fontFamily: "var(--mac-sans)", fontSize: 14 }}>{agent.name}</p>
        <p style={{ margin: "4px 0 0", fontFamily: "var(--mac-mono)", fontSize: 11 }}>{agent.type} · {agent.status}</p>
      </div>
    </div>
  );
}

export default function AgentDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading, user } = useAuthContext();
  const agentsService = useAgents();
  const { error } = useNotifications();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/");
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;

    agentsService
      .get(id)
      .then((result) => {
        if (!cancelled) setAgent(result);
      })
      .catch((err) => {
        if (!cancelled) {
          error("Failed to load agent", err instanceof Error ? err.message : undefined);
          navigate("/agents");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, agentsService, isAuthenticated, error, navigate]);

  if (authLoading || !isAuthenticated || loading) {
    return (
      <ClientLayout>
        <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
      </ClientLayout>
    );
  }

  if (!agent) {
    return (
      <ClientLayout>
        <Stage>
          <Window title="agents" onClose={() => navigate("/agents")}>
            <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>agent not found.</p>
          </Window>
        </Stage>
      </ClientLayout>
    );
  }

  const isNegotiator = agent.id === SYSTEM_AGENT_IDS.negotiator;

  return (
    <ClientLayout>
      <Stage width={860} height="min(720px, calc(100vh - 112px))">
        <Window title="agents" onClose={() => navigate("/agents")} style={{ height: "100%" }}>
          <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 18, fontWeight: 700 }}>{agent.name}</h1>
            <p style={{ margin: "6px 0 16px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {agent.type === "system" ? "hosted by index" : agent.status}
            </p>
            <AgentOverview agent={agent} userId={user?.id ?? ""} />
            {isNegotiator && <NegotiationHistory userId={user?.id ?? ""} />}
          </div>
        </Window>
      </Stage>
    </ClientLayout>
  );
}

export const Component = AgentDetailPage;
