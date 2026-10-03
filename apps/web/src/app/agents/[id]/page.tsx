import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2 } from "lucide-react";
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

function NotificationsSection({
  agent,
  onChange,
  disabled,
}: {
  agent: Agent;
  onChange: (patch: Partial<Pick<Agent, "notifyOnOpportunity" | "dailySummaryEnabled">>) => void;
  disabled: boolean;
}) {
  if (agent.type !== "external") return null;

  return (
    <div style={{ border: "1px solid #000", padding: 16, background: "#fff" }}>
      <div className="flex items-center gap-2 mb-3">
        <h3 style={{ fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
          notifications
        </h3>
      </div>
      <div className="space-y-4">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agent.notifyOnOpportunity}
            disabled={disabled}
            onChange={(e) => onChange({ notifyOnOpportunity: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-gray-900 disabled:opacity-50"
          />
          <span>
            <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700 }}>connection updates</span>
            <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>tells this agent when an opportunity is accepted or someone reaches out.</span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={agent.dailySummaryEnabled}
            disabled={disabled}
            onChange={(e) => onChange({ dailySummaryEnabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-gray-900 disabled:opacity-50"
          />
          <span>
            <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 700 }}>daily brief</span>
            <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, color: "var(--ink-2)" }}>one message at 08:00 with new overlaps and anything waiting on you.</span>
          </span>
        </label>

      </div>
    </div>
  );
}

function AgentOverview({
  agent,
  userId,
  onPatch,
  isSaving,
}: {
  agent: Agent;
  userId: string;
  onPatch: (patch: Partial<Pick<Agent, "notifyOnOpportunity" | "dailySummaryEnabled">>) => void;
  isSaving: boolean;
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

      <NotificationsSection agent={agent} onChange={onPatch} disabled={isSaving} />
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
  const [isSaving, setIsSaving] = useState(false);

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

  async function handlePatch(
    patch: Partial<Pick<Agent, "notifyOnOpportunity" | "dailySummaryEnabled">>,
  ) {
    if (!agent) return;
    setIsSaving(true);
    try {
      const updated = await agentsService.update(agent.id, patch);
      setAgent(updated);
    } catch (err) {
      error("Failed to save setting", err instanceof Error ? err.message : undefined);
    } finally {
      setIsSaving(false);
    }
  }

  if (authLoading || !isAuthenticated || loading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
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
            <AgentOverview agent={agent} userId={user?.id ?? ""} onPatch={handlePatch} isSaving={isSaving} />
            {isNegotiator && <NegotiationHistory userId={user?.id ?? ""} />}
          </div>
        </Window>
      </Stage>
    </ClientLayout>
  );
}

export const Component = AgentDetailPage;
