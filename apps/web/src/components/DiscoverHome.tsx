import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { apiClient } from "@/lib/api";
import UserAvatar from "@/components/UserAvatar";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAgents } from "@/contexts/APIContext";
import { useNetworksState } from "@/contexts/NetworksContext";
import { useNotifications } from "@/contexts/NotificationContext";
import IntentList from "@/components/IntentList";
import InviteNetworksModal from "@/components/modals/InviteNetworksModal";
import { QCount, RuleLabel, Stage, Window } from "@/components/workbench/Workbench";
import { AgentGlyph, ChatGlyph, NetworksGlyph } from "@/components/workbench/nav-glyphs";
import { useCompact } from "@/hooks/useCompact";
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

const SHELF_ROW_H = 72;
const SHELF_ROW_GAP = 8;
const SHELF_VISIBLE_ROWS = 6;

function ShelfCount({ n }: { n: number }) {
  return <span style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 500, color: "#000" }}>{n}</span>;
}

function ShelfRow({ icon, label, aside, rule, onClick }: { icon: ReactNode; label: string; aside?: ReactNode; rule?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8.4, width: "100%",
      padding: "3px 0", cursor: "pointer", textAlign: "left",
      border: "none", borderTop: rule ? "1px solid #DAD8D4" : "none", background: "transparent", color: "#000",
    }}>
      <span style={{ flex: "0 0 auto", width: 20.8, height: 34, display: "grid", placeItems: "center start" }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 500, color: "#000" }}>{label}</span>
      {aside}
    </button>
  );
}

export default function DiscoverHome() {
  const navigate = useNavigate();
  const compact = useCompact();
  const { error: showError } = useNotifications();
  const { user, signOut } = useAuthContext();
  const agentsService = useAgents();
  const { networks } = useNetworksState();
  const [intents, setIntents] = useState<HomeIntent[]>([]);
  const [loading, setLoading] = useState(true);
  const [intentsError, setIntentsError] = useState(false);
  const [agentCount, setAgentCount] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  const joinedCount = networks.length;
  const pendingJoins = networks.reduce(
    (total, network) => total + ((network as { pendingJoinCount?: number }).pendingJoinCount ?? 0),
    0,
  );

  const fetchIntents = useCallback(async () => {
    try {
      const res = await apiClient.post<{ intents?: HomeIntent[] }>("/intents/list", { page: 1, limit: 100 });
      if (mountedRef.current) {
        setIntents(res.intents ?? []);
        setIntentsError(false);
      }
    } catch (err) {
      logger.error("Failed to load signals", { error: err });
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
    agentsService.list().then((agents) => {
      const active = agents.filter((agent) => agent.status === "active").length;
      if (mountedRef.current) setAgentCount(Math.max(1, active));
    }).catch(() => {});
    return () => {
      mountedRef.current = false;
    };
  }, [agentsService, fetchIntents]);

  useEffect(() => {
    if (!intents.some((intent) => intent.warming)) return;
    const interval = setInterval(fetchIntents, 30_000);
    return () => clearInterval(interval);
  }, [fetchIntents, intents]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  const handleArchive = useCallback(async (intent: HomeIntent) => {
    setIntents((prev) => prev.filter((i) => i.id !== intent.id));
    try {
      await apiClient.patch(`/intents/${intent.id}/archive`);
    } catch {
      showError("Failed to archive signal");
    }
  }, [showError]);

  const visible = intents.filter((intent) => intent.status !== "archived");
  const shelfMax = SHELF_VISIBLE_ROWS * SHELF_ROW_H + (SHELF_VISIBLE_ROWS - 1) * SHELF_ROW_GAP;

  if (inviteOpen) {
    return <InviteNetworksModal onClose={() => setInviteOpen(false)} />;
  }

  const newSignalButton = (
    <button type="button" className="wb-new-signal" onClick={() => navigate("/i/new")}>
      <span style={{
        width: 24,
        height: 24,
        display: "grid",
        placeItems: "center",
        background: "#fff",
        color: "#000",
        border: "1px solid #000",
        fontFamily: "var(--mac-mono)",
        fontSize: 16,
        fontWeight: 700,
      }}>+</span>
      <span style={{ fontFamily: "var(--mac-sans)", fontSize: 15, fontWeight: 700 }}>new signal</span>
    </button>
  );

  // Compact: signals are the whole screen. Conversations, agents and the
  // profile menu move to the tab bar; networks and settings sit in its "you" sheet.
  if (compact) {
    return (
      <Stage>
        <Window title="index">
          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px 16px 12px" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1 style={{ fontFamily: "var(--amiga-mono)", fontWeight: 700, fontSize: 24, lineHeight: 1.1, letterSpacing: -0.4, margin: 0, color: "#000" }}>
                  find your others
                </h1>
                <p style={{ margin: "8px 0 0", color: "#000", fontSize: 13, lineHeight: 1.45, fontFamily: "var(--mac-sans)" }}>
                  start a signal by talking to your agent. it negotiates with other agents and makes an intro when both sides are interested.
                </p>
              </div>
            </div>
            <RuleLabel>your signals</RuleLabel>
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
            <div style={{ flex: "0 0 auto" }}>{newSignalButton}</div>
          </div>
        </Window>
      </Stage>
    );
  }

  return (
    <Stage width={980} height="min(560px, calc(100vh - 112px))">
      <Window title="index" style={{ maxHeight: "calc(100vh - 112px)", minHeight: "min(560px, calc(100vh - 112px))" }}>
        <div style={{
          padding: "22px 28px 20px",
          display: "grid",
          gridTemplateColumns: "minmax(0, 0.85fr) minmax(0, 1.15fr)",
          gap: 24,
          flex: 1,
          minHeight: 0,
        }}>
          <div style={{
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            paddingRight: 22,
            borderRight: "2px solid #000",
          }}>
            <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <h1 style={{
                fontFamily: "var(--amiga-mono)",
                fontWeight: 700,
                fontSize: 34,
                lineHeight: 1.05,
                letterSpacing: -0.6,
                margin: 0,
                color: "#000",
              }}>
                find your others
              </h1>
              <p style={{
                marginTop: 12,
                color: "#000",
                fontSize: 13,
                lineHeight: 1.5,
                maxWidth: 540,
                fontFamily: "var(--mac-sans)",
              }}>
                start a signal by talking to your agent. it negotiates it with the
                other agents and makes an intro when both sides are interested.
              </p>
              <button type="button" className="wb-invite" onClick={() => setInviteOpen(true)}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#24583A" strokeWidth="2" strokeLinejoin="round">
                  <path d="M6 3h12l4 6-10 12L2 9z" />
                  <path d="M2 9h20M12 21 8 9l4-6 4 6-4 12" />
                </svg>
                invite friends
              </button>
            </div>

            <div style={{ display: "grid", gap: 9 }}>
              <div>
                <ShelfRow
                  onClick={() => navigate("/chat")}
                  label="conversations"
                  icon={<ChatGlyph />}
                />
                <ShelfRow
                  rule
                  onClick={() => navigate("/networks")}
                  label="networks"
                  aside={
                    <>
                      <QCount n={pendingJoins} title={`${pendingJoins} waiting on you: people asking to join`} />
                      <ShelfCount n={joinedCount} />
                    </>
                  }
                  icon={<NetworksGlyph />}
                />
                <ShelfRow rule onClick={() => navigate("/agents")} label="agents" aside={<ShelfCount n={agentCount} />} icon={<AgentGlyph />} />
              </div>
              <div ref={menuRef} style={{ position: "relative", width: "100%" }}>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, width: "100%",
                    padding: "7px 11px", textAlign: "left", cursor: "pointer",
                    border: "1px solid #000", background: menuOpen ? "#F2EFE6" : "#fff",
                  }}>
                  <UserAvatar id={user?.id} name={user?.name} avatar={user?.avatar} size={34} />
                  <span style={{ flex: 1, minWidth: 0, display: "block", fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 700, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user?.name || "you"}
                  </span>
                  <span style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 12, color: "#000", transform: menuOpen ? "rotate(180deg)" : "none" }}>▲</span>
                </button>
                {menuOpen && (
                  <div role="menu" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 40, minWidth: 200, width: "100%", background: "#fff", border: "1px solid #000", boxShadow: "3px 3px 0 rgba(0,0,0,0.22)", padding: "4px 0" }}>
                    {([
                      { id: "settings", label: "settings", danger: false },
                      { id: "notifications", label: "notifications", danger: false },
                      { id: "history", label: "negotiation history", danger: false },
                      { id: "signout", label: "sign out", danger: true },
                    ] as const).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          if (item.id === "settings") navigate("/settings");
                          if (item.id === "notifications") navigate("/settings?tab=notifications");
                          if (item.id === "history") navigate("/negotiations");
                          if (item.id === "signout") void signOut();
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = item.danger ? "#FFF3F3" : "#000";
                          e.currentTarget.style.color = item.danger ? "var(--ink-warn)" : "#FF8A00";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = item.danger ? "var(--ink-warn)" : "#000";
                        }}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "6px 12px", border: "none", background: "transparent",
                          fontFamily: "var(--mac-sans)", fontSize: 12, cursor: "pointer",
                          color: item.danger ? "var(--ink-warn)" : "#000",
                          fontWeight: item.danger ? 600 : 400,
                          borderTop: item.danger ? "1px solid #000" : "none",
                          marginTop: item.danger ? 4 : 0,
                        }}>{item.label}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <RuleLabel>your signals</RuleLabel>
            <div style={{ height: 8 }} />
            <IntentList
              intents={visible}
              isLoading={loading}
              loadError={intentsError}
              onRetry={retryIntents}
              shelf
              className="mac-scroll"
              style={{ maxHeight: shelfMax, gap: SHELF_ROW_GAP }}
              onIntentClick={(intent) => navigate(`/i/${intent.id}`)}
              onArchiveIntent={handleArchive}
            />
            {newSignalButton}
          </div>
        </div>
      </Window>
    </Stage>
  );
}
