import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";

import { apiClient } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import IntentList from "@/components/IntentList";
import { ContentContainer } from "@/components/layout";
import { DebugCopyButton } from "@/components/DebugCopyButton";
import { log } from "@/lib/logger";

const logger = log.ui.from("DiscoverHome");

/** Signal list item shown on Discover (from POST /intents/list). */
interface HomeIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: "file" | "link" | "integration" | "discovery_form" | "enrichment";
  waitingOpportunityCount?: number;
  pendingQuestionCount?: number;
  status?: string;
  warming?: boolean;
}

/**
 * Discover home — signal-first. Renders the user's signals with a "New signal"
 * entry card on top; no agent composer (that lives in the Agent chat). The New
 * signal card routes to the dedicated New Signal page (/i/new).
 */
export default function DiscoverHome() {
  const navigate = useNavigate();
  const { error: showError } = useNotifications();
  const [intents, setIntents] = useState<HomeIntent[]>([]);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const fetchIntents = useCallback(async () => {
    try {
      const res = await apiClient.post<{ intents?: HomeIntent[] }>("/intents/list", { page: 1, limit: 100 });
      if (mountedRef.current) setIntents(res.intents ?? []);
    } catch (err) {
      logger.error("Failed to load signals", { error: err });
      if (mountedRef.current) setIntents([]);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    fetchIntents().finally(() => {
      if (mountedRef.current) setLoading(false);
    });
    return () => {
      mountedRef.current = false;
    };
  }, [fetchIntents]);

  useEffect(() => {
    if (!intents.some((intent) => intent.warming)) return;
    const interval = setInterval(fetchIntents, 30_000);
    return () => clearInterval(interval);
  }, [fetchIntents, intents]);

  const handleArchive = useCallback(
    async (intent: HomeIntent) => {
      setIntents((prev) => prev.filter((i) => i.id !== intent.id));
      try {
        await apiClient.patch(`/intents/${intent.id}/archive`);
      } catch {
        showError("Failed to archive signal");
      }
    },
    [showError],
  );

  return (
    <div className="px-6 lg:px-8 pb-12">
      <ContentContainer className="text-left">
        <div className="mt-12 mb-6 flex items-center justify-center gap-2">
          <h1 className="text-[28px] font-bold text-black font-ibm-plex-mono text-center">
            Find your others
          </h1>
          <DebugCopyButton fetchPath="/debug/home" title="Copy home debug JSON" iconSize="w-5 h-5" />
        </div>
        <p className="mb-6 text-center text-xs text-gray-400 font-ibm-plex-mono">
          {intents.length} signals · {intents.reduce((total, intent) => total + (intent.waitingOpportunityCount ?? 0), 0)} opportunities
        </p>

        {/* New signal entry — styled to match IntentList rows */}
        <button
          type="button"
          onClick={() => navigate("/i/new")}
          className="group w-full flex items-center gap-3 p-4 rounded-lg border border-dashed border-gray-300 bg-white hover:border-[#4091BB] hover:shadow-sm transition-all mb-6"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4091BB] text-white group-hover:bg-[#35799C] transition-colors">
            <Plus className="w-4 h-4" strokeWidth={2.5} />
          </span>
          <span className="text-sm font-medium text-gray-900 group-hover:text-black">
            who are you trying to meet?
          </span>
        </button>

        <IntentList
          intents={intents}
          isLoading={loading}
          emptyMessage="No signals yet"
          onIntentClick={(intent) => navigate(`/i/${intent.id}`)}
          onArchiveIntent={handleArchive}
        />
      </ContentContainer>
    </div>
  );
}
