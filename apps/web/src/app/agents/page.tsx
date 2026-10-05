import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { MyAgentAvatar } from '@/components/workbench/agent-avatar';
import { Stage, Window } from '@/components/workbench/Workbench';
import { useAgents } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Agent } from '@/services/agents';
import { EmptyState } from "@/components/ui/EmptyState";
import { log } from "@/lib/logger";
import { useCompact } from "@/hooks/useCompact";

const logger = log.page.from("agents");

function NegotiatorBadge() {
  return (
    <span style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 10, fontWeight: 700, letterSpacing: 0.4, background: "#FF8A00", color: "#000", padding: "2px 6px", border: "1px solid #000" }}>NEGOTIATOR</span>
  );
}

function NegotiatorMark() {
  return <span title="negotiator" style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 13, lineHeight: 1, color: "#000" }}>*</span>;
}

function RegisterLink({ open, disabled, onClick }: { open: boolean; disabled?: boolean; onClick: () => void }) {
  const [focus, setFocus] = useState(false);
  const marked = open || focus;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={{
        boxSizing: "border-box",
        border: "1px solid " + (marked ? "#000" : "transparent"),
        background: open ? "#000" : "transparent",
        color: disabled ? "var(--ink-3)" : (open ? "#fff" : "#000"),
        padding: "1px 6px",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--mac-mono)", fontSize: 12,
        textDecoration: marked ? "none" : "underline",
        textUnderlineOffset: 3,
        outline: "none",
      }}>+ register manually</button>
  );
}

function LineButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      fontFamily: "var(--mac-mono)", fontSize: 12, padding: "5px 12px",
      border: "1px solid #000",
      background: disabled ? "#F2F0EC" : "#fff",
      color: disabled ? "var(--ink-2)" : "#000",
      boxShadow: disabled ? "none" : "1px 1px 0 rgba(0,0,0,0.2)",
      cursor: disabled ? "default" : "pointer",
    }}>{children}</button>
  );
}

function RemoveButton({ onRemove, disabled }: { onRemove: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (armed) onRemove(); else setArmed(true); }}
      onBlur={() => setArmed(false)}
      style={{
        boxSizing: "border-box", height: 18, padding: "0 8px",
        fontFamily: "var(--mac-mono)", fontSize: 11, lineHeight: 1,
        border: "1px solid #000",
        background: armed ? "var(--ink-warn)" : "#fff",
        color: armed ? "#fff" : "#000",
        cursor: disabled ? "default" : "pointer",
      }}>{armed ? "confirm" : "remove"}</button>
  );
}

function BandHead({ label, first, action }: { label: string; first?: boolean; action?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: first ? "0 0 8px" : "26px 0 8px", fontFamily: "var(--mac-mono)", fontSize: 13, letterSpacing: 1.4, textTransform: "uppercase", fontWeight: 700, color: "#000" }}>
      <span>{label}</span>
      <div style={{ flex: 1, height: 2, background: "linear-gradient(#000, #000) top/100% 1px no-repeat, linear-gradient(#fff, #fff) bottom/100% 1px no-repeat" }} />
      {action && <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>{action}</span>}
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={copied ? "copied" : id}
      aria-label="copy agent id"
      onClick={(e) => {
        e.stopPropagation();
        const write = navigator.clipboard?.writeText(id);
        if (!write) return;
        write.then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }).catch(() => {});
      }}
      style={{ border: "none", background: "none", padding: 0, cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-4)", letterSpacing: 0.2, whiteSpace: "nowrap" }}>
      {copied ? "copied" : `${id.slice(0, 8)}…`}
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
    gridTemplateColumns: stacked ? "minmax(0,1fr) auto 18px" : columns ? "minmax(0,1fr) 168px 84px 140px 18px" : undefined,
    alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box",
    padding: "10px 12px", textAlign: "left",
    border: "none", borderBottom: last && !expanded ? "none" : "1px solid #000",
    background: (opens && (hover || expanded)) ? "#F2EFE6" : "#fff",
    cursor: opens ? "pointer" : "default",
    font: "inherit", color: "inherit",
  };
  const nameDetail = (
    <span style={{ minWidth: 0, display: "grid", gap: 3 }}>
      <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 700, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {badge}
      </span>
      <span style={{ minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
    </span>
  );
  const body = stacked ? (
    <>
      {nameDetail}
      <span onClick={onToggle ? (e) => e.stopPropagation() : undefined} style={{ minWidth: 0, display: "flex", justifyContent: "flex-end", alignItems: "center", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>{aside}</span>
      <span aria-hidden="true" style={{ width: 18, textAlign: "center", fontFamily: "var(--mac-mono)", fontSize: 12, color: "#000" }}>{onToggle ? (expanded ? "▾" : "›") : ""}</span>
    </>
  ) : (
    <>
      <span style={{ flex: columns ? undefined : "1 1 34%", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: 700, color: "#000", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {badge}
      </span>
      <span style={{ flex: columns ? undefined : "1 1 40%", minWidth: 0, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail}</span>
      {columns && <span style={{ minWidth: 0 }}>{id ? <CopyId id={id} /> : null}</span>}
      {aside != null && aside !== "" && (
        <span onClick={onToggle ? (e) => e.stopPropagation() : undefined} style={{ minWidth: columns ? 0 : 108, display: "flex", justifyContent: "flex-end", alignItems: "center", overflow: "hidden", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>{aside}</span>
      )}
      {(onToggle || columns) && (
        <span aria-hidden="true" style={{ width: 18, textAlign: "center", fontFamily: "var(--mac-mono)", fontSize: 12, color: "#000" }}>{onToggle ? (expanded ? "▾" : "›") : ""}</span>
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
  return <button type="button" onClick={onClick} {...hoverProps} style={row}>{body}</button>;
}

function OptionToggle({ on, title, blurb, onClick }: { on: boolean; title: string; blurb: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on} style={{ display: "flex", gap: 11, alignItems: "flex-start", textAlign: "left", width: "100%", padding: "10px 12px", cursor: "pointer", border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)" }}>
      <span style={{ flex: "0 0 auto", width: 16, height: 16, marginTop: 1, border: "1px solid #000", background: on ? "#FF8A00" : "#EDEAE1", boxShadow: on ? "inset 1px 1px 0 #8A4500, inset -1px -1px 0 #FFD7A0" : "inset 1px 1px 0 #FFF, inset -1px -1px 0 var(--ink-3)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 700, color: "#000" }}>{on ? "✓" : ""}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 12, fontWeight: 600, color: "#000" }}>{title}</span>
        <span style={{ display: "block", marginTop: 3, fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.45, color: "var(--ink-2)" }}>{blurb}</span>
      </span>
    </button>
  );
}

export default function AgentsPage() {
  const navigate = useNavigate();
  const compact = useCompact();
  const { isAuthenticated, isLoading: authLoading, user } = useAuthContext();
  const agentsService = useAgents();
  const { success, error } = useNotifications();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [nameFocus, setNameFocus] = useState(false);

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
  const first = String(user?.name || "").trim().split(/\s+/)[0].toLowerCase();
  const who = first ? `${first}'s agent` : "your agent";

  async function refreshAgents() {
    setAgents(await agentsService.list());
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
      <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
    );
  }

  const kind = selectedNegotiator ? "registered manually" : "hosted by index";

  return (
    <>
      <Stage width={860} height="min(880px, calc(100vh - 96px))">
      <Window title="agents" onClose={compact ? undefined : () => navigate('/')} style={{ height: '100%' }}>
      <div className="mac-scroll" style={{ flex: 1, overflowY: 'auto', padding: compact ? '14px 16px 22px' : '18px 24px 22px' }}>
          {loading ? (
            <EmptyState tone="loading" style={{ padding: 28 }} />
          ) : loadFailed ? (
            <EmptyState
              tone="error"
              style={{ padding: 28 }}
              message="couldn't load your agents."
              action={{ label: "try again", onClick: () => { setLoading(true); setReloadKey((k) => k + 1); } }}
            />
          ) : (
            <>
              <BandHead label="your negotiator" first />
              <p style={{ margin: "0 0 12px", fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
                one agent speaks for {who} in the network. index takes over if it&apos;s offline.
              </p>
              <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderBottom: picking ? "1px solid #000" : "none" }}>
                  <MyAgentAvatar size={48} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontFamily: "var(--mac-mono)", fontSize: 16, fontWeight: 700 }}>{selectedNegotiator?.name || "Index"}</div>
                    <div style={{ marginTop: 2, fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>{kind}</div>
                  </div>
                  <LineButton disabled={selecting} onClick={() => setPicking((open) => !open)}>{picking ? "cancel" : "change"}</LineButton>
                </div>
                {picking && (
                  <>
                    <RosterRow name="Index" badge={selectedNegotiator === null ? <NegotiatorBadge /> : null} detail="hosted by index" last={personalAgents.length === 0} onClick={() => void handleSelectNegotiator(null)} />
                    {personalAgents.map((agent, i) => (
                      <RosterRow key={agent.id} name={agent.name} badge={agent.handleNegotiations ? <NegotiatorBadge /> : null} detail="registered manually" last={i === personalAgents.length - 1} onClick={() => void handleSelectNegotiator(agent)} />
                    ))}
                  </>
                )}
              </div>

              <BandHead label="connected agents" action={
                <RegisterLink open={registerOpen} disabled={creating || selecting} onClick={() => setRegisterOpen((open) => !open)} />
              } />
              <p style={{ margin: "0 0 12px", fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)" }}>
                everything that can act for you, from any device.
              </p>
              {registerOpen && (
                <div style={{ display: "grid", gap: 10, maxWidth: 420, marginBottom: 12 }}>
                  <label style={{ display: "block" }}>
                    <span style={{ display: "block", marginBottom: 5, fontFamily: "var(--mac-mono)", fontSize: 11, fontWeight: 600, color: "#000" }}>name<span style={{ color: "#FF8A00", marginLeft: 4 }}>*</span></span>
                    <input
                      autoFocus
                      value={newAgentName}
                      disabled={creating}
                      placeholder="agent name"
                      onChange={(e) => setNewAgentName(e.target.value)}
                      onFocus={() => setNameFocus(true)}
                      onBlur={() => setNameFocus(false)}
                      onKeyDown={(e) => { if (e.key === "Enter") void handleCreateAgent(); }}
                      style={{ display: "block", width: "100%", boxSizing: "border-box", border: "1px solid #000", background: creating ? "#EDEAE1" : "#fff", boxShadow: nameFocus ? "inset 2px 2px 0 #000" : "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff", padding: "7px 10px", fontFamily: "var(--mac-mono)", fontSize: 13, outline: "none" }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <LineButton disabled={creating || !newAgentName.trim()} onClick={() => void handleCreateAgent()}>{creating ? "creating…" : "create"}</LineButton>
                    <LineButton disabled={creating} onClick={() => setRegisterOpen(false)}>cancel</LineButton>
                  </div>
                </div>
              )}
              <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)" }}>
                <RosterRow name="Index" badge={!selectedNegotiator ? <NegotiatorMark /> : null} detail="hosted by index" id="" aside="always on" last={personalAgents.length === 0} />
                {personalAgents.map((agent, i) => {
                  const open = expanded === agent.id;
                  const last = i === personalAgents.length - 1;
                  return (
                    <div key={agent.id}>
                      <RosterRow
                        last={last}
                        expanded={open}
                        onToggle={() => setExpanded((id) => id === agent.id ? null : agent.id)}
                        name={agent.name}
                        badge={selectedNegotiator?.id === agent.id ? <NegotiatorMark /> : null}
                        detail="registered manually"
                        id={agent.id}
                        aside={<RemoveButton disabled={selecting} onRemove={() => void handleDeleteAgent(agent)} />}
                      />
                      {open && (
                        <div style={{ background: "#F2F0EC", borderBottom: last ? "none" : "1px solid #000", padding: "11px 12px 12px" }}>
                          <div style={{ display: "grid", gap: 8 }}>
                            <OptionToggle on={agent.notifyOnOpportunity} onClick={() => void toggleSetting(agent, "notifyOnOpportunity")} title="connection updates" blurb="tells this agent when an opportunity is accepted or someone reaches out." />
                            {compact && <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>id <CopyId id={agent.id} /></div>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {personalAgents.length === 0 && !registerOpen && (
                <EmptyState
                  align="start"
                  style={{ padding: "12px 0 0" }}
                  message="no agents of your own yet. connect one with the index CLI or MCP, or register it by hand."
                  action={{ label: "register manually", onClick: () => setRegisterOpen(true) }}
                />
              )}
            </>
          )}
        </div>
      </Window>
      </Stage>
    </>
  );
}

export const Component = AgentsPage;
