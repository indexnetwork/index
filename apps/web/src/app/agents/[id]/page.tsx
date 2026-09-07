import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Loader2, ArrowLeft, Bot } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
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
    <div className="p-4 rounded-md border border-gray-100 bg-white">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          Notifications
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
            <span className="block text-sm font-medium text-gray-900">Notify me about new opportunities</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              Only applies when your personal agent is polling.
            </span>
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
            <span className="block text-sm font-medium text-gray-900">Send a daily summary</span>
            <span className="block text-xs text-gray-400 mt-0.5">
              Once per 24 hours, through the same channel.
            </span>
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
      <div className="p-4 rounded-md border border-gray-100 bg-white">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
            Agent Info
          </h3>
        </div>
        <dl className="space-y-3">
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Name</dt>
            <dd className="text-sm font-medium text-gray-900">{agent.name}</dd>
          </div>
          {agent.description && (
            <div>
              <dt className="text-xs text-gray-400 uppercase tracking-wide">Description</dt>
              <dd className="text-sm text-gray-700">{agent.description}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Type</dt>
            <dd>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                agent.type === "system" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
              }`}>
                {agent.type}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400 uppercase tracking-wide">Status</dt>
            <dd>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                agent.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {agent.status}
              </span>
            </dd>
          </div>
        </dl>
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
        <div className="px-6 lg:px-8 py-6">
          <ContentContainer>
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">Agent not found.</p>
            </div>
          </ContentContainer>
        </div>
      </ClientLayout>
    );
  }

  const isNegotiator = agent.id === SYSTEM_AGENT_IDS.negotiator;

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer>
          <button
            onClick={() => navigate("/agents")}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Agents
          </button>

          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">
              {agent.name}
            </h1>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              agent.type === "system" ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-600"
            }`}>
              {agent.type}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${
              agent.status === "active" ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
            }`}>
              {agent.status}
            </span>
          </div>

          <AgentOverview agent={agent} userId={user?.id ?? ""} onPatch={handlePatch} isSaving={isSaving} />
        </ContentContainer>
      </div>

      {isNegotiator && (
        <div className="sticky bottom-0 z-20">
          <div className="px-6 lg:px-8">
            <ContentContainer>
              <NegotiationHistory userId={user?.id ?? ""} />
            </ContentContainer>
          </div>
        </div>
      )}
    </ClientLayout>
  );
}

export const Component = AgentDetailPage;
