import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { apiClient } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import IntentList from "@/components/IntentList";
import { RuleLabel, Stage, Window } from "@/components/workbench/Workbench";
import { log } from "@/lib/logger";

const logger = log.ui.from("DiscoverHome");

interface HomeIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType?: "integration" | "discovery_form" | "enrichment";
  waitingOpportunityCount?: number;
  status?: string;
  warming?: boolean;
}

const SHELF_ROW_GAP = 0;

export default function DiscoverHome() {
  const navigate = useNavigate();
  const { error: showError } = useNotifications();
  const [intents, setIntents] = useState<HomeIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [intentsError, setIntentsError] = useState(false);
  const mountedRef = useRef(true);

  const fetchIntents = useCallback(async () => {
    try {
      const res = await apiClient.post<{ intents?: HomeIntent[] }>("/intents/list", { page: 1, limit: 100 });
      if (mountedRef.current) {
        setIntents(res.intents ?? []);
        setIntentsError(false);
      }
    } catch (err) {
      logger.error("Failed to load intents", { error: err });
      if (mountedRef.current) setIntentsError(true);
    }
  }, []);

  const retryIntents = useCallback(() => {
    setLoading(true);
    fetchIntents().finally(() => {
      if (mountedRef.current) setLoading(false);
    });
  }, [fetchIntents]);

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

  const handleArchive = useCallback(async (intent: HomeIntent) => {
    setIntents((prev) => prev.filter((i) => i.id !== intent.id));
    try {
      await apiClient.patch(`/intents/${intent.id}/archive`);
    } catch {
      showError("Failed to archive intent");
    }
  }, [showError]);

  const visible = intents.filter((intent) => intent.status !== "archived");

  const newIntentButton = (
    <button type="button" className="wb-new-intent" onClick={() => navigate("/i/new")}>
      <span aria-hidden style={{
        width: 16,
        display: "grid",
        placeItems: "center",
        color: "var(--ink)",
        fontFamily: "var(--mac-sans)",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1,
      }}>+</span>
      <span style={{ fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: 500 }}>new intent</span>
    </button>
  );

  // Phones only (desktop renders IntentsHome): intents are the whole screen.
  // Conversations, agents and the profile menu sit in the tab bar; networks and
  // settings in its "you" sheet.
  return (
    <Stage>
      <Window title="index">
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px 16px 12px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 style={{ fontFamily: "var(--amiga-sans)", fontWeight: 500, fontSize: 16, lineHeight: 1.4, margin: 0, color: "var(--ink)" }}>
                find your others
              </h1>
              <p style={{ margin: "6px 0 0", color: "var(--ink-2)", fontSize: 13, lineHeight: 1.5, fontFamily: "var(--mac-sans)" }}>
                start an intent by talking to your agent. it negotiates with other agents and makes an intro when both sides are interested.
              </p>
            </div>
          </div>
          <RuleLabel>your intents</RuleLabel>
          <IntentList
            intents={visible}
            isLoading={loading}
            loadError={intentsError}
            onRetry={retryIntents}
            shelf
            className="mac-scroll"
            style={{ flex: "1 1 auto", gap: SHELF_ROW_GAP }}
            onIntentClick={(intent) => navigate(`/i/${intent.id}`)}
            onArchiveIntent={handleArchive}
          />
          <div style={{ flex: "0 0 auto" }}>{newIntentButton}</div>
        </div>
      </Window>
    </Stage>
  );
}
