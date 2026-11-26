import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router';

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
import { Placeholder } from "@/components/ui/Placeholder";
import ChoiceCard from "@/components/ui/ChoiceCard";
import { shortDay } from "@/lib/short-day";
import { settingsPath } from "@/lib/settings-tabs";

const logger = log.page.from("agents");

function NegotiatorMark() {
  return <span title="speaks for you" style={{ flex: "0 0 auto", fontSize: 13, lineHeight: 1, color: "#ff8a00", fontWeight: 700 }}>*</span>;
}

function LineButton({ children, onClick, disabled, primary, "aria-busy": busy }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean; "aria-busy"?: boolean }) {
  // Grey outline .wb-btn; `primary` is the orange one for the screen's single main action.
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-busy={busy} className={primary ? "wb-btn primary" : "wb-btn"} style={{
      cursor: disabled ? "default" : "pointer",
    }}>{children}</button>
  );
}

function BandHead({ label }: { label: string }) {
  return <h2 className="st-h">{label}</h2>;
}
function CopyId({ id, label }: { id: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "copied" : id}
      aria-label="copy agent id"
      className="pl-plain-btn st-copy"
      onClick={(e) => {
        e.stopPropagation();
        const write = navigator.clipboard?.writeText(id);
        if (!write) return;
        write.then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}>
      {copied ? "copied" : label ?? `${id.slice(0, 8)}…`}
    </button>
  );
}

function RosterRow({
  name, badge, detail, aside, last, onClick, expanded, onToggle,
}: {
  name: string;
  badge?: ReactNode;
  detail: string;
  aside?: ReactNode;
  last?: boolean;
  onClick?: () => void;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [hover, setHover] = useState(false);
  const opens = !!(onClick || onToggle);
  // Like every settings list: the name over its detail line, then what you can do on the right.
  const row: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box",
    margin: 0, padding: "14px 0", textAlign: "left", borderRadius: 0,
    border: "none", background: "transparent",
    cursor: opens ? "pointer" : "default",
    font: "inherit", color: "inherit",
  };
  const body = (
    <>
      <span className="st-item-text">
        <span className="st-item-head">
          <span className={`st-name${opens && hover ? " hot" : ""}`}>{name}</span>
          {badge}
        </span>
        <span className="st-detail">{detail}</span>
      </span>
      {onToggle ? (
        // A text toggle, not a box: it opens the agent's tray under the row.
        <span className="ag-link" aria-hidden="true">settings {expanded ? "▴" : "▾"}</span>
      ) : aside != null && aside !== "" && (
        <span style={{ flex: "none", display: "flex", alignItems: "center", fontSize: 12, color: "var(--ink-3)" }}>{aside}</span>
      )}
    </>
  );
  const hoverProps = { onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) };
  const line: React.CSSProperties = { borderBottom: last || expanded ? "none" : "1px solid #e6e6e6" };
  if (onToggle) {
    return (
      <div style={line}>
        <div onClick={onToggle} role="button" tabIndex={0} aria-expanded={!!expanded} aria-label={`${name} settings`} onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        }} {...hoverProps} style={row}>{body}</div>
      </div>
    );
  }
  if (!onClick) return <div style={line}><div style={row}>{body}</div></div>;
  return <div style={line}><button type="button" className="pl-plain-btn" onClick={onClick} {...hoverProps} style={row}>{body}</button></div>;
}

/** Remove as red text: the first click arms it, the second removes. */
function RemoveLink({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      className="pl-plain-btn ag-link ag-danger"
      disabled={disabled}
      onBlur={() => setArmed(false)}
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    >{armed ? "click again to remove" : label}</button>
  );
}

/** What opens under an agent's row: its settings, then its id and remove. */
function AgentTray({ last, id, children, onRemove, disabled }: { last: boolean; id?: string; children?: ReactNode; onRemove: () => void; disabled?: boolean }) {
  return (
    <div style={{ padding: "0 0 12px", borderBottom: last ? "none" : "1px solid #e6e6e6" }}>
      <div className="ag-tray">
        {children}
        <div className="ag-tray-foot">
          {id ? <span>id {id.slice(0, 13)}… <CopyId id={id} label="copy" /></span> : <span />}
          <RemoveLink label="remove this agent" onConfirm={onRemove} disabled={disabled} />
        </div>
      </div>
    </div>
  );
}

function OptionToggle({ on, title, blurb, onClick }: { on: boolean; title: string; blurb: string; onClick: () => void }) {
  return (
    <label className="ag-opt">
      <input type="checkbox" checked={on} onChange={onClick} />
      <span>
        <b>{title}</b>
        <small>{blurb}</small>
      </span>
    </label>
  );
}

/** `embedded`: drawn inside Settings' "agents" tab, without its own head or window. */
export default function AgentsPage({ embedded = false }: { embedded?: boolean } = {}) {
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
      success(`${connection.name || 'agent'} disconnected`);
    } catch (err) {
      error('Failed to disconnect agent', err instanceof Error ? err.message : undefined);
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
      success('agent created');
    } catch (err) {
      error('Failed to create agent', err instanceof Error ? err.message : undefined);
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
      success(agent ? `${agent.name} handles negotiations` : 'Index Negotiator handles negotiations');
    } catch (err) {
      error('Failed to set the negotiator', err instanceof Error ? err.message : undefined);
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
      success('agent deleted');
    } catch (err) {
      error('Failed to delete agent', err instanceof Error ? err.message : undefined);
    }
  }

  async function toggleSetting(agent: Agent, key: "notifyOnOpportunity") {
    const next = !agent[key];
    setAgents((list) => list.map((item) => item.id === agent.id ? { ...item, [key]: next } : item));
    try {
      await agentsService.update(agent.id, { [key]: next });
    } catch (err) {
      error('Failed to save setting', err instanceof Error ? err.message : undefined);
      await refreshAgents();
    }
  }

  if (authLoading || !isAuthenticated) {
    return (
      <Placeholder.Window rows={3} label="loading your agents" style={{ padding: 24 }} />
    );
  }

  const kind = selectedNegotiator ? "registered manually" : "hosted by index";

  const content = (
    <>
          {loading ? (
            <Placeholder.Window rows={3} label="loading your agents" style={{ padding: 28 }} />
          ) : loadFailed ? (
            <EmptyState
              tone="error"
              style={{ padding: 28 }}
              message="couldn't load your agents."
              action={{ label: "try again", onClick: () => { setLoading(true); setReloadKey((k) => k + 1); } }}
            />
          ) : (
            <>
              <BandHead label="which agent speaks for you" />
              <p className="st-note">
                one agent speaks for you in the network. index takes over if it&apos;s offline.
              </p>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0 14px" }}>
                  <MyAgentAvatar size={48} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="st-name">{selectedNegotiator?.name || "Index"}</div>
                    <div className="st-detail" style={{ marginTop: 3 }}>{kind}</div>
                  </div>
                  <button type="button" className="pl-plain-btn ag-link" disabled={selecting} aria-expanded={picking} onClick={() => setPicking((open) => !open)}>change {picking ? "▴" : "▾"}</button>
                </div>
                {/* The same tray as an agent's settings: pick one, like a radio. */}
                {picking && (
                  <div className="ag-tray">
                    <div className="ag-pick" role="radiogroup" aria-label="which agent speaks for you">
                      <ChoiceCard title="Index" sub="hosted by index" selected={selectedNegotiator === null} disabled={selecting} onClick={() => void handleSelectNegotiator(null)} />
                      {personalAgents.map((agent) => (
                        <ChoiceCard key={agent.id} title={agent.name} sub="registered manually" selected={selectedNegotiator?.id === agent.id} disabled={selecting} onClick={() => void handleSelectNegotiator(agent)} />
                      ))}
                    </div>
                    {personalAgents.length === 0 && <p className="ag-tray-note">add your own agent below and it can speak for you here.</p>}
                  </div>
                )}
              </div>

              <BandHead label="connected agents" />
              <p className="st-note">
                everything that can act for you, from any device.
              </p>
              <div className="ag-roster">
                <RosterRow name="Index" badge={!selectedNegotiator ? <NegotiatorMark /> : null} detail="hosted by index" aside="always on" last={personalAgents.length === 0 && connections.length === 0} />
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
                        detail="registered manually"
                      />
                      {open && (
                        <AgentTray last={last} id={agent.id} disabled={selecting} onRemove={() => void handleDeleteAgent(agent)}>
                          <OptionToggle on={agent.notifyOnOpportunity} onClick={() => void toggleSetting(agent, "notifyOnOpportunity")} title="connection updates" blurb="tells this agent when an opportunity is accepted or someone reaches out." />
                        </AgentTray>
                      )}
                    </div>
                  );
                })}
                {connections.map((connection, i) => {
                  const key = `mcp:${connection.clientId}`;
                  const open = expanded === key;
                  const last = i === connections.length - 1;
                  return (
                    <div key={connection.clientId}>
                      <RosterRow
                        last={last}
                        expanded={open}
                        onToggle={() => setExpanded((id) => id === key ? null : key)}
                        name={connection.name || "mcp agent"}
                        detail={`connected over mcp · active ${shortDay(connection.lastActiveAt, "unknown")}`}
                      />
                      {open && <AgentTray last={last} onRemove={() => void handleRevokeConnection(connection)} />}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 22 }}>
                <AddYourAgent
                  linkToPage={false}
                  onRegister={() => setRegisterOpen(true)}
                  registerForm={registerOpen ? (
                    <div style={{ display: "grid", gap: 10, padding: "14px 0", borderTop: "1px solid #e6e6e6" }}>
                      <label style={{ display: "block", maxWidth: 420 }}>
                        <span className="st-label">name your agent<span className="st-req">*</span></span>
                        <span className="st-well">
                        <input
                          autoFocus
                          value={newAgentName}
                          disabled={creating}
                          placeholder="agent name"
                          onChange={(e) => setNewAgentName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleCreateAgent(); }}
                        />
                        </span>
                      </label>
                      <div style={{ display: "flex", gap: 8 }}>
                        <LineButton aria-busy={creating} primary disabled={creating || !newAgentName.trim()} onClick={() => void handleCreateAgent()}>{creating ? "creating" : "create"}</LineButton>
                        <LineButton disabled={creating} onClick={() => { setRegisterOpen(false); setNewAgentName(""); }}>cancel</LineButton>
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
  if (plain) return <Navigate to={settingsPath("agents")} replace />;

  return (
    <Stage width={860} height="min(880px, calc(100vh - 96px))">
      <Window title="agents" onClose={compact ? undefined : () => navigate('/')} style={{ height: '100%' }}>
        <div className="mac-scroll" style={{ flex: 1, overflowY: 'auto', padding: compact ? '14px 16px 22px' : '18px 24px 22px' }}>
          <div className="pl-agents">{content}</div>
        </div>
      </Window>
    </Stage>
  );
}

export const Component = AgentsPage;
