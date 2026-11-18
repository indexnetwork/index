import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import { MyAgentAvatar } from '@/components/workbench/agent-avatar';
import { Stage, Window } from '@/components/workbench/Workbench';
import { useAgents } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Agent, AgentConnection } from '@/services/agents';
import { AddYourAgent } from "@/components/AddYourAgent";
import { EmptyState } from "@/components/ui/EmptyState";
import { log } from "@/lib/logger";
import { useCompact } from "@/hooks/useCompact";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import "@/styles/plain.css";
import i18n from "@/lib/i18n";

const logger = log.page.from("agents");

function NegotiatorBadge() {
  const { t } = useTranslation();
  return (
    <span className="ih-badge" style={{ flex: "0 0 auto" }}>{t("speaks for you")}</span>
  );
}

function NegotiatorMark() {
  const { t } = useTranslation();
  return <span title={t("speaks for you")} style={{ flex: "0 0 auto", fontSize: 13, lineHeight: 1, color: "#ff8a00", fontWeight: 700 }}>*</span>;
}

function LineButton({ children, onClick, disabled, primary }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  // Grey outline .wb-btn; `primary` is the orange one for the screen's single main action.
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={primary ? "wb-btn primary" : "wb-btn"} style={{
      cursor: disabled ? "default" : "pointer",
    }}>{children}</button>
  );
}

function RemoveButton({ onRemove, disabled }: { onRemove: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (armed) onRemove(); else setArmed(true); }}
      onBlur={() => setArmed(false)}
      className={`wb-btn danger${armed ? " on" : ""}`}>{armed ? t("confirm") : t("remove")}</button>
  );
}

function activeDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? i18n.t("unknown")
    : date.toLocaleDateString(i18n.resolvedLanguage ?? "en-US", { month: "short", day: "numeric", year: "numeric" });
}

function BandHead({ label, first }: { label: string; first?: boolean }) {
  return <h2 className="st-h" style={{ marginTop: first ? 0 : 30 }}>{label}</h2>;
}
function CopyId({ id }: { id: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? t("copied") : id}
      aria-label={t("copy agent id")}
      className="pl-plain-btn"
      onClick={(e) => {
        e.stopPropagation();
        const write = navigator.clipboard?.writeText(id);
        if (!write) return;
        write.then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, color: "#8a8578", whiteSpace: "nowrap" }}>
      {copied ? t("copied") : `${id.slice(0, 8)}…`}
    </button>
  );
}

function RosterRow({
  name, badge, detail, id, aside, last, onClick, expanded, onToggle,
}: {
  name: string;
  badge?: ReactNode;
  detail: string;
  id?: string;
  aside?: ReactNode;
  last?: boolean;
  onClick?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const compact = useCompact();
  const opens = !!(onClick || onToggle);
  const columns = id != null;
  // Compact: name over detail, the id column drops, aside and chevron stay.
  const stacked = compact && columns;
  const row: React.CSSProperties = {
    display: columns ? "grid" : "flex",
    gridTemplateColumns: stacked ? "minmax(0,1fr) auto 18px" : columns ? "minmax(0,1fr) 290px 84px 90px 18px" : undefined,
    alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box",
    padding: "14px 12px", textAlign: "left", borderRadius: 0,
    border: "none", borderBottom: last && !expanded ? "none" : "1px solid #e6e6e6",
    background: (opens && (hover || expanded)) ? "#f7f7f5" : "transparent",
    cursor: opens ? "pointer" : "default",
    font: "inherit", color: "inherit",
  };
  const nameDetail = (
    <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 600, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {badge}
      </span>
      <span style={{ minWidth: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: "0.5px", color: "#8a8578", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
    </span>
  );
  const body = stacked ? (
    <>
      {nameDetail}
      <span onClick={onToggle ? (e) => e.stopPropagation() : undefined} style={{ minWidth: 0, display: "flex", justifyContent: "flex-end", alignItems: "center", fontSize: 12, color: "var(--ink-3)" }}>{aside}</span>
      <span aria-hidden="true" style={{ width: 18, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>{onToggle ? (expanded ? "▾" : "›") : ""}</span>
    </>
  ) : (
    <>
      <span style={{ flex: columns ? undefined : "1 1 34%", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 600, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {badge}
      </span>
      <span style={{ flex: columns ? undefined : "1 1 40%", minWidth: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: "0.5px", color: "#8a8578", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      {columns && <span style={{ minWidth: 0 }}>{id ? <CopyId id={id} /> : null}</span>}
      {aside != null && aside !== "" && (
        <span onClick={onToggle ? (e) => e.stopPropagation() : undefined} style={{ minWidth: columns ? 0 : 108, display: "flex", justifyContent: "flex-end", alignItems: "center", overflow: "hidden", fontSize: 12, color: "var(--ink-3)" }}>{aside}</span>
      )}
      {(onToggle || columns) && (
        <span aria-hidden="true" style={{ width: 18, textAlign: "center", fontSize: 12, color: "var(--ink-3)" }}>{onToggle ? (expanded ? "▾" : "›") : ""}</span>
      )}
    </>
  );
  const hoverProps = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  if (onToggle) {
    return (
      <div onClick={onToggle} role="button" tabIndex={0} aria-expanded={!!expanded} onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
      }} {...hoverProps} style={row}>{body}</div>
    );
  }
  if (!onClick) return <div style={row}>{body}</div>;
  return <button type="button" className="pl-plain-btn" onClick={onClick} {...hoverProps} style={row}>{body}</button>;
}

function OptionToggle({ on, title, blurb, onClick }: { on: boolean; title: string; blurb: string; onClick: () => void }) {
  return (
    <label className="st-row" style={{ margin: 0 }}>
      <span className="st-row-text">
        <b style={{ fontSize: 14 }}>{title}</b>
        <span>{blurb}</span>
      </span>
      <input type="checkbox" checked={on} onChange={onClick} />
    </label>
  );
}

/** `embedded`: drawn inside Settings' "agents" tab, without its own head or window. */
export default function AgentsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const compact = useCompact();
  const plain = useInAppFrame();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const agentsService = useAgents();
  const { success, error } = useNotifications();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    agentsService.list()
      .then((result) => {
        if (!cancelled) {
          setAgents(result);
          setLoadFailed(false);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          logger.error('Failed to load agents', { error: err });
          setLoadFailed(true);
          setLoading(false);
        }
      });
    // A failed read only hides the MCP rows; the roster still loads.
    agentsService.listConnections()
      .then((result) => { if (!cancelled) setConnections(result); })
      .catch((err) => { logger.error('Failed to load agent connections', { error: err }); });
    return () => { cancelled = true; };
  }, [agentsService, isAuthenticated, reloadKey]);

  const personalAgents = useMemo(
    () => agents.filter((agent) => agent.type === 'external'),
    [agents],
  );
  const selectedNegotiator = useMemo(
    () => personalAgents.find((agent) => agent.handleNegotiations) ?? null,
    [personalAgents],
  );

  async function refreshAgents() {
    setAgents(await agentsService.list());
  }

  async function handleRevokeConnection(connection: AgentConnection) {
    try {
      await agentsService.revokeConnection(connection.clientId);
      setConnections((current) => current.filter((item) => item.clientId !== connection.clientId));
      success(t('{{name}} disconnected', { name: connection.name || t('agent') }));
    } catch (err) {
      error(t('Failed to disconnect agent'), err instanceof Error ? err.message : undefined);
    }
  }

  async function handleCreateAgent() {
    if (!newAgentName.trim()) return;
    setCreating(true);
    try {
      await agentsService.create(newAgentName.trim());
      setNewAgentName('');
      setRegisterOpen(false);
      await refreshAgents();
      success(t('agent created'));
    } catch (err) {
      error(t('Failed to create agent'), err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleSelectNegotiator(agent: Agent | null) {
    if (!agent) {
      if (!selectedNegotiator) { setPicking(false); return; }
    } else if (selectedNegotiator?.id === agent.id) {
      setPicking(false);
      return;
    }
    const target = agent ?? selectedNegotiator;
    if (!target) return;
    setSelecting(true);
    try {
      await agentsService.update(target.id, { handleNegotiations: agent !== null });
      await refreshAgents();
      setPicking(false);
      success(agent ? t('{{name}} handles negotiations', { name: agent.name }) : t('Index Negotiator handles negotiations'));
    } catch (err) {
      error(t('Failed to set the negotiator'), err instanceof Error ? err.message : undefined);
    } finally {
      setSelecting(false);
    }
  }

  async function handleDeleteAgent(agent: Agent) {
    try {
      if (agent.handleNegotiations) {
        await agentsService.update(agent.id, { handleNegotiations: false });
      }
      await agentsService.delete(agent.id);
      if (expanded === agent.id) setExpanded(null);
      await refreshAgents();
      success(t('agent deleted'));
    } catch (err) {
      error(t('Failed to delete agent'), err instanceof Error ? err.message : undefined);
    }
  }

  async function toggleSetting(agent: Agent, key: "notifyOnOpportunity") {
    const next = !agent[key];
    setAgents((list) => list.map((item) => item.id === agent.id ? { ...item, [key]: next } : item));
    try {
      await agentsService.update(agent.id, { [key]: next });
    } catch (err) {
      error(t('Failed to save setting'), err instanceof Error ? err.message : undefined);
      await refreshAgents();
    }
  }

  if (authLoading || !isAuthenticated) {
    return (
      <p style={{ padding: 24, fontSize: 12, color: "var(--ink-3)" }}>{t("loading…")}</p>
    );
  }

  const kind = selectedNegotiator ? t("registered manually") : t("hosted by index");

  const content = (
    <>
          {loading ? (
            <EmptyState tone="loading" style={{ padding: 28 }} />
          ) : loadFailed ? (
            <EmptyState
              tone="error"
              style={{ padding: 28 }}
              message={t("couldn't load your agents.")}
              action={{ label: t("try again"), onClick: () => { setLoading(true); setReloadKey((k) => k + 1); } }}
            />
          ) : (
            <>
              <BandHead label={t("which agent speaks for you")} first />
              <p className="st-note" style={{ marginBottom: 12 }}>
                {t("one agent speaks for you in the network. index takes over if it's offline.")}
              </p>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0 14px", borderBottom: picking ? "1px solid #e6e6e6" : "none" }}>
                  <MyAgentAvatar size={48} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 16, fontWeight: 600, color: "#000" }}>{selectedNegotiator?.name || "Index"}</div>
                    <div style={{ marginTop: 2, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, letterSpacing: "0.5px", color: "#8a8578" }}>{kind}</div>
                  </div>
                  <LineButton disabled={selecting} onClick={() => setPicking((open) => !open)}>{picking ? t("cancel") : t("change")}</LineButton>
                </div>
                {picking && (
                  <>
                    <RosterRow name="Index" badge={selectedNegotiator === null ? <NegotiatorBadge /> : null} detail={t("hosted by index")} last={personalAgents.length === 0} onClick={() => void handleSelectNegotiator(null)} />
                    {personalAgents.map((agent, i) => (
                      <RosterRow key={agent.id} name={agent.name} badge={agent.handleNegotiations ? <NegotiatorBadge /> : null} detail={t("registered manually")} last={i === personalAgents.length - 1} onClick={() => void handleSelectNegotiator(agent)} />
                    ))}
                  </>
                )}
              </div>

              <BandHead label={t("connected agents")} />
              <p className="st-note" style={{ marginBottom: 12 }}>
                {t("everything that can act for you, from any device.")}
              </p>
              <div className="ag-roster">
                <RosterRow name="Index" badge={!selectedNegotiator ? <NegotiatorMark /> : null} detail={t("hosted by index")} id="" aside={t("always on")} last={personalAgents.length === 0 && connections.length === 0} />
                {personalAgents.map((agent, i) => {
                  const open = expanded === agent.id;
                  const last = i === personalAgents.length - 1 && connections.length === 0;
                  return (
                    <div key={agent.id}>
                      <RosterRow
                        last={last}
                        expanded={open}
                        onToggle={() => setExpanded((id) => id === agent.id ? null : agent.id)}
                        name={agent.name}
                        badge={selectedNegotiator?.id === agent.id ? <NegotiatorMark /> : null}
                        detail={t("registered manually")}
                        id={agent.id}
                        aside={<RemoveButton disabled={selecting} onRemove={() => void handleDeleteAgent(agent)} />}
                      />
                      {open && (
                        <div style={{ background: "#f7f7f5", borderBottom: last ? "none" : "1px solid #e6e6e6", padding: "0 12px 4px" }}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <OptionToggle on={agent.notifyOnOpportunity} onClick={() => void toggleSetting(agent, "notifyOnOpportunity")} title={t("connection updates")} blurb={t("tells this agent when an opportunity is accepted or someone reaches out.")} />
                            {compact && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--ink-3)" }}>{t("id")} <CopyId id={agent.id} /></div>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {connections.map((connection, i) => (
                  <RosterRow
                    key={connection.clientId}
                    name={connection.name || t("mcp agent")}
                    detail={t("connected over mcp · active {{date}}", { date: activeDay(connection.lastActiveAt) })}
                    id=""
                    last={i === connections.length - 1}
                    aside={<RemoveButton onRemove={() => void handleRevokeConnection(connection)} />}
                  />
                ))}
              </div>
              <div style={{ marginTop: 30 }}>
                <AddYourAgent
                  linkToPage={false}
                  onRegister={() => setRegisterOpen(true)}
                  registerForm={registerOpen ? (
                    <div style={{ display: "grid", gap: 10, padding: "14px 0", borderTop: "1px solid #e6e6e6" }}>
                      <label style={{ display: "block", maxWidth: 420 }}>
                        <span className="st-label">{t("name your agent")}<span style={{ color: "#8a8578", marginLeft: 4 }}>*</span></span>
                        <span className="st-well">
                        <input
                          autoFocus
                          value={newAgentName}
                          disabled={creating}
                          placeholder={t("agent name")}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleCreateAgent(); }}
                        />
                        </span>
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <LineButton primary disabled={creating || !newAgentName.trim()} onClick={() => void handleCreateAgent()}>{creating ? t("creating…") : t("create")}</LineButton>
                        <LineButton disabled={creating} onClick={() => { setRegisterOpen(false); setNewAgentName(""); }}>{t("cancel")}</LineButton>
                      </div>
                    </div>
                  ) : undefined}
                />
              </div>
            </>
          )}
    </>
  );

  if (embedded) return <div className="pl-agents">{content}</div>;

  // Signed in on desktop, agents live in Settings as their own tab.
  if (plain) return <Navigate to="/settings?tab=agents" replace />;

  return (
    <Stage width={860} height="min(880px, calc(100vh - 96px))">
      <Window title={t("agents")} onClose={compact ? undefined : () => navigate('/')} style={{ height: '100%' }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: 'auto', padding: compact ? '14px 16px 22px' : '18px 24px 22px' }}>
          {content}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = AgentsPage;
