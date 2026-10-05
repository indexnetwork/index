import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { Segmented, Stage, Window } from "@/components/workbench/Workbench";
import { NegoClosedLine, NegoOpenLine, NegoThreadRow, NegoTurnLine, negoResult } from "@/components/workbench/mac-blocks";
import { useNegotiations } from "@/contexts/APIContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useConversation } from "@/contexts/ConversationContext";
import { EmptyState } from "@/components/ui/EmptyState";
import type { NegotiationSummary, NegotiationTurn } from "@/services/negotiations";
import { useCompact } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";

const emptyBox = { borderColor: "#000", padding: "18px 16px" } as const;

type HistoryFilter = "all" | "won" | "lost" | "open";
type HistoryMode = "stream" | "grouped";

export default function NegotiationsPage() {
  const navigate = useNavigate();
  const compact = useCompact();
  const back = useBack("/");
  const { isAuthenticated, isLoading, user } = useAuthContext();
  const { negotiations, negotiationsStatus, refreshNegotiations } = useConversation();
  const negotiationsService = useNegotiations();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [mode, setMode] = useState<HistoryMode>("stream");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [turnsById, setTurnsById] = useState<Record<string, NegotiationTurn[]>>({});

  useEffect(() => {
    if (!isLoading && !isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, isLoading, navigate]);

  const threads = negotiations;
  const counts = useMemo(() => ({
    won: threads.filter((th) => negoResult(th) === "won").length,
    lost: threads.filter((th) => negoResult(th) === "lost").length,
    open: threads.filter((th) => negoResult(th) === "open").length,
  }), [threads]);
  const filtered = filter === "all" ? threads : threads.filter((th) => negoResult(th) === filter);
  const selected = filtered.find((th) => th.id === selectedId) || filtered[0] || null;
  const loadKey = (mode === "stream" ? filtered : selected ? [selected] : []).map((th) => th.opportunityId).join(",");

  useEffect(() => {
    const ids = loadKey.split(",").filter(Boolean);
    if (ids.length === 0) return;
    let active = true;
    void Promise.all(ids.map(async (id) => {
      try {
        const detail = await negotiationsService.getNegotiation(id);
        return [id, detail.turns] as const;
      } catch {
        return [id, [] as NegotiationTurn[]] as const;
      }
    })).then((rows) => {
      if (!active) return;
      setTurnsById((current) => ({ ...current, ...Object.fromEntries(rows) }));
    });
    return () => { active = false; };
  }, [loadKey, negotiationsService]);

  const events = useMemo(() => {
    const src = mode === "grouped" ? (selected ? [selected] : []) : filtered;
    const evs: Array<{ kind: "turn" | "closed" | "open"; t: number; th: NegotiationSummary; turn?: NegotiationTurn }> = [];
    for (const th of src) {
      for (const turn of turnsById[th.opportunityId] ?? []) {
        evs.push({ kind: "turn", t: Date.parse(turn.createdAt) || 0, th, turn });
      }
      if (th.outcome) evs.push({ kind: "closed", t: Date.parse(th.settledAt || th.updatedAt) || 0, th });
      else evs.push({ kind: "open", t: Date.parse(th.updatedAt) || 0, th });
    }
    return evs.sort((a, b) => a.t - b.t);
  }, [filtered, mode, selected, turnsById]);

  const openGrouped = (th: NegotiationSummary) => { setMode("grouped"); setSelectedId(th.id); };
  const log = (
    <div className="mac-scroll" style={{ overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column" }}>
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        {events.length === 0 ? (
          threads.length === 0 && negotiationsStatus === "loading" ? (
            <EmptyState tone="loading" align="start" framed style={emptyBox} />
          ) : threads.length === 0 && negotiationsStatus === "error" ? (
            <EmptyState
              tone="error"
              align="start"
              framed
              style={emptyBox}
              message="couldn't load negotiations."
              action={{ label: "try again", onClick: () => void refreshNegotiations() }}
            />
          ) : threads.length === 0 ? (
            <EmptyState
              align="start"
              framed
              style={emptyBox}
              message="nothing on the wire yet. your agent logs every negotiation here as it happens."
            />
          ) : (
            <EmptyState
              align="start"
              framed
              style={emptyBox}
              message="no sessions match this filter."
              action={filter !== "all" ? { label: "clear filter", onClick: () => { setFilter("all"); setSelectedId(null); } } : undefined}
            />
          )
        ) : events.map((ev, i) =>
          ev.kind === "closed"
            ? <NegoClosedLine key={`c-${ev.th.id}-${i}`} th={ev.th} withTag={mode === "stream"} />
            : ev.kind === "open"
              ? <NegoOpenLine key={`o-${ev.th.id}-${i}`} th={ev.th} withTag={mode === "stream"} />
              : <NegoTurnLine key={`t-${ev.th.id}-${ev.turn?.turnIndex}-${i}`} th={ev.th} turn={ev.turn!} you={ev.turn?.seatUserId === user?.id} withTag={mode === "stream"} onTag={openGrouped} />
        )}
        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 12, color: "#FF8A00", animation: "mac-blink 1s steps(2) infinite" }}>▌</span>
      </div>
    </div>
  );

  if (isLoading || !isAuthenticated) return null;
  return (
    <Stage width={1000} height="calc(100vh - 112px)">
      <Window title="negotiation history" onClose={compact ? back : () => navigate("/")} style={{ height: "100%" }}>
        <div style={{ display: "grid", gridTemplateRows: "auto 1fr", flex: 1, minHeight: 0 }}>
          <div style={{
            padding: "10px 16px", borderBottom: "2px solid #000", background: "#fff",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000" }}>
              <b>{threads.length}</b> sessions · <b>{counts.won}</b> ✓ · <b>{counts.lost}</b> ✕ · <b>{counts.open}</b> open
            </span>
            <div style={{ flex: 1 }} />
            <Segmented value={mode} onChange={setMode} options={[{ value: "stream", label: "stream" }, { value: "grouped", label: "grouped" }]} />
            <Segmented value={filter} onChange={(f) => { setFilter(f); setSelectedId(null); }} options={[
              { value: "all", label: "all" }, { value: "won", label: "won" }, { value: "lost", label: "lost" }, { value: "open", label: "open" },
            ]} />
          </div>
          {mode === "stream" ? log : compact ? (
            // One pane: the session list until a session is picked, then its log.
            selectedId && selected ? (
              <div style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
                <button type="button" onClick={() => setSelectedId(null)} style={{
                  padding: "10px 16px", border: "none", borderBottom: "1px solid #000", background: "#F2F0EC",
                  textAlign: "left", fontFamily: "var(--mac-mono)", fontSize: 12, color: "#000", cursor: "pointer",
                }}>← all sessions</button>
                {log}
              </div>
            ) : (
              <div className="mac-scroll" style={{ overflowY: "auto", padding: "12px 10px", background: "#F2F0EC", display: "flex", flexDirection: "column", gap: 6 }}>
                {filtered.length === 0 ? log : filtered.map((th) => (
                  <NegoThreadRow key={th.id} th={th} active={false} onPick={() => setSelectedId(th.id)} />
                ))}
              </div>
            )
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", minHeight: 0 }}>
              <div className="mac-scroll" style={{
                overflowY: "auto", padding: "12px 10px", borderRight: "2px solid #000", background: "#F2F0EC",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                {filtered.map((th) => (
                  <NegoThreadRow key={th.id} th={th} active={!!selected && selected.id === th.id} onPick={() => setSelectedId(th.id)} />
                ))}
                {/* An empty list stays blank here: the log pane beside it carries the empty state. */}
              </div>
              {log}
            </div>
          )}
        </div>
      </Window>
    </Stage>
  );
}

export const Component = NegotiationsPage;
