import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { Stage, Window } from "@/components/workbench/Workbench";
import NegotiationHistory from "@/components/NegotiationHistory";
import type { Agent } from "@/services/agents";
import { EmptyState } from "@/components/ui/EmptyState";
import { isNotFoundError } from "@/lib/api";
import { log } from "@/lib/logger";

const logger = log.page.from("agents/[id]");

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
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
        if (!cancelled) {
          setAgent(result);
          setFailed(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error("Failed to load agent", { error: err });
        setAgent(null);
        // A 404 falls through to the "doesn't exist" state below; anything else is retryable.
        setFailed(!isNotFoundError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, agentsService, isAuthenticated, reloadKey]);

  if (authLoading || !isAuthenticated || loading || !agent) {
    return (
      <Stage width={520}>
        <Window title="agents" onClose={() => navigate("/agents")}>
          <div style={{ padding: 28 }}>
            {authLoading || !isAuthenticated || loading ? (
              <EmptyState tone="loading" />
            ) : failed ? (
              <EmptyState
                tone="error"
                message="couldn't load this agent."
                action={{ label: "try again", onClick: () => { setLoading(true); setFailed(false); setReloadKey((k) => k + 1); } }}
              />
            ) : (
              <EmptyState message="this agent doesn't exist or was removed." action={{ label: "back to agents", to: "/agents" }} />
            )}
          </div>
        </Window>
      </Stage>
    );
  }

  return (
    <>
      <Stage width={860} height="min(720px, calc(100vh - 112px))">
        <Window title="agents" onClose={() => navigate("/agents")} style={{ height: "100%" }}>
          <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
            <h1 style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 18, fontWeight: 700 }}>{agent.name}</h1>
            <p style={{ margin: "6px 0 16px", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
              {agent.type === "system" ? "hosted by index" : agent.status}
            </p>
            <AgentOverview agent={agent} userId={user?.id ?? ""} />
          </div>
        </Window>
      </Stage>
    </>
  );
}

export const Component = AgentDetailPage;
