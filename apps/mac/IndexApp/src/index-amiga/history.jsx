// Negotiation history — the wire log of everything your agent has negotiated
// on your behalf. Reached from the account menu on the hub.
//
// Two modes. "stream" is the default: every turn from every thread merged into
// one chronological tail -f, so you see the agent juggling several
// counterparties at once. "grouped" slides in a thread drawer on the left and
// narrows the log to the selected thread — the master/detail view.
//
// Live data comes from GET /users/:id/negotiations (threads with counterparty,
// outcome, and per-turn agent reasoning). No demo fallback — signed out the
// wire is simply empty.

// A thread's result bucket: won (opportunity), lost, or still open.
function negoResult(th) {
  if (!th.outcome) return "open";
  return th.outcome.hasOpportunity ? "won" : "lost";
}
function negoFirstName(th) {
  return ((th.counterparty && th.counterparty.name) || "unknown").split(/\s+/)[0].toLowerCase();
}
function negoClock(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "--:--:--";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function negoRoles(suggestedRoles) {
  if (!Array.isArray(suggestedRoles) || suggestedRoles.length === 0) return null;
  return suggestedRoles.map((r) => (r && r.role) || r).filter(Boolean).join(" / ");
}

const NEGO_RESULT_GLYPH = {
  won:  { g: "✓", color: "#000" },
  lost: { g: "✕", color: "var(--ink-warn)" },
  open: { g: "●", color: "#FF8A00" },
};

/* ---------- log lines ---------- */

// One turn in the wire log. `withTag` is on in stream mode, off in a
// single-thread transcript where the counterparty is already the context.
function NegoTurnLine({ th, turn, you, withTag, onTag }) {
  const roles = negoRoles(turn.suggestedRoles);
  return (
    <div className="fade-up" style={{ display:"grid", gap:2 }}>
      <div style={{
        display:"flex", alignItems:"baseline", gap:8,
        fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
      }}>
        <span style={{ color:"var(--ink-3)", flex:"0 0 auto" }}>{negoClock(turn.createdAt)}</span>
        {withTag && (
          <button onClick={() => onTag && onTag(th)} style={{
            flex:"0 0 auto", fontFamily:"var(--mac-mono)", fontSize:10,
            border:"1px solid #000", background:"#fff", color:"#000",
            padding:"0 5px", cursor:"pointer", width:76, textAlign:"left",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#000"; e.currentTarget.style.color = "#FF8A00"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.color = "#000"; }}
          >{negoFirstName(th)}</button>
        )}
        <span style={{ fontWeight:700, flex:"0 0 auto" }}>
          {you ? "you.agent" : `${negoFirstName(th)}.agent`}
        </span>
        <span style={{ flex:"0 0 auto" }}>{you ? "→" : "←"}</span>
        <span style={{
          flex:"0 0 auto", textTransform:"uppercase", letterSpacing:1,
          background: you ? "#000" : "#fff", color: you ? "#fff" : "#000",
          border:"1px solid #000", padding:"0 6px", fontSize:10,
        }}>{turn.action || "unknown"}</span>
        {roles && <span style={{ color:"var(--ink-2)", fontSize:10 }}>roles: {roles}</span>}
      </div>
      {turn.reasoning && (
        <div style={{
          marginLeft: withTag ? 156 : 72,
          fontFamily:"var(--mac-mono)", fontSize:11, lineHeight:1.45,
          color:"var(--ink-2)", maxWidth:560,
        }}>"{turn.reasoning}"</div>
      )}
    </div>
  );
}

// Outcome as an event in the stream — the moment a thread closed.
function NegoClosedLine({ th, withTag }) {
  const r = negoResult(th);
  const { g } = NEGO_RESULT_GLYPH[r];
  const detail = r === "won"
    ? `opportunity${th.outcome.role ? ` · ${th.outcome.role}` : ""}`
    : (th.outcome && th.outcome.reason) || "no opportunity";
  return (
    <div className="fade-up" style={{
      display:"flex", alignItems:"center", gap:8,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.5,
      color: r === "won" ? "#000" : "var(--ink-2)",
    }}>
      <span style={{ color:"var(--ink-4)" }}>{negoClock(th.statusTimestamp || th.updatedAt)}</span>
      <span style={{ flex:"0 0 auto" }}>───</span>
      <span style={{ fontWeight:700 }}>
        {withTag ? `${negoFirstName(th)} · ` : ""}closed {g} {detail}
      </span>
      <span style={{ flex:1, borderTop:"1px dashed var(--ink-4)" }}/>
    </div>
  );
}

/* ---------- grouped drawer ---------- */

function NegoThreadRow({ th, active, onPick }) {
  const r = negoResult(th);
  const { g, color } = NEGO_RESULT_GLYPH[r];
  return (
    <button onClick={onPick} style={{
      display:"grid", gridTemplateColumns:"1fr auto auto", gap:8,
      alignItems:"center", width:"100%", textAlign:"left",
      padding:"7px 10px", cursor:"pointer",
      border:"1px solid #000",
      background: active ? "#000" : "#fff",
      color: active ? "#FF8A00" : "#000",
      fontFamily:"var(--mac-mono)", fontSize:11,
    }}>
      <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontWeight:700 }}>
        {negoFirstName(th)}
      </span>
      <span style={{ color: active ? "#FF8A00" : "var(--ink-3)", fontSize:10 }}>
        {th.turns.length}t
      </span>
      <span style={{ color: active ? "#FF8A00" : color, fontWeight:700 }}>{g}</span>
    </button>
  );
}

/* ---------- the screen ---------- */

function NegotiationHistory({ onClose }) {
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const myId = (window.INDEX_DATA && window.INDEX_DATA.ME && window.INDEX_DATA.ME.id) || null;
  const [threads, setThreads] = useState(null);   // null = loading
  const [mode, setMode] = useState("stream");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let dead = false;
    const load = async () => {
      if (live && myId && window.IndexApp.getClient) {
        try {
          const res = await window.IndexApp.getClient().users.negotiations(myId, { limit: 50 });
          if (!dead) setThreads(res.negotiations || []);
          return;
        } catch (e) { /* keep whatever is shown; empty state below covers first load */ }
      }
      if (!dead) setThreads((prev) => prev || []);
    };
    load();
    const t = setInterval(load, 45000);   // same cadence as the radar
    return () => { dead = true; clearInterval(t); };
  }, [live, myId]);

  const all = threads || [];
  const counts = useMemo(() => ({
    won:  all.filter((t) => negoResult(t) === "won").length,
    lost: all.filter((t) => negoResult(t) === "lost").length,
    open: all.filter((t) => negoResult(t) === "open").length,
  }), [all]);
  const filtered = useMemo(
    () => filter === "all" ? all : all.filter((t) => negoResult(t) === filter),
    [all, filter],
  );
  const selected = filtered.find((t) => t.id === selectedId) || filtered[0] || null;

  // Stream: flatten every turn + every close into one time-ordered log.
  const events = useMemo(() => {
    const src = mode === "grouped" ? (selected ? [selected] : []) : filtered;
    const evs = [];
    for (const th of src) {
      for (const turn of (th.turns || [])) {
        evs.push({ kind:"turn", t: Date.parse(turn.createdAt) || 0, th, turn });
      }
      if (th.outcome) {
        evs.push({ kind:"closed", t: Date.parse(th.statusTimestamp || th.updatedAt) || 0, th });
      }
    }
    return evs.sort((a, b) => a.t - b.t);
  }, [filtered, mode, selected]);

  // tail -f scroll: pinned to bottom unless the user scrolls up.
  const scrollRef = useRef(null);
  const pinned = useRef(true);
  const [away, setAway] = useState(false);
  React.useLayoutEffect(() => {
    if (pinned.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, mode]);
  const onScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    pinned.current = atBottom;
    setAway(!atBottom);
  };
  const jumpLive = () => {
    pinned.current = true; setAway(false);
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };

  const isYou = (turn) => !!turn.speaker && (turn.speaker.id === myId || turn.speaker.id === "me");
  const openGrouped = (th) => { setMode("grouped"); setSelectedId(th.id); };

  const log = (
    <div style={{ position:"relative", display:"grid", minHeight:0 }}>
      <div ref={scrollRef} onScroll={onScroll} className="mac-scroll" style={{
        overflowY:"auto", padding:"14px 18px",
        display:"flex", flexDirection:"column",
      }}>
        <div style={{ marginTop:"auto", display:"flex", flexDirection:"column", gap:10 }}>
          {threads === null ? (
            <div style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>
              reading the wire<span className="mac-caret"/>
            </div>
          ) : events.length === 0 ? (
            <div style={{
              border:"1px dashed #000", padding:"18px 16px",
              fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
            }}>
              nothing on the wire yet — your agent logs every negotiation here
              as it happens.
            </div>
          ) : events.map((ev, i) =>
            ev.kind === "closed"
              ? <NegoClosedLine key={`c-${ev.th.id}-${i}`} th={ev.th} withTag={mode === "stream"}/>
              : <NegoTurnLine key={`t-${ev.th.id}-${i}`} th={ev.th} turn={ev.turn}
                  you={isYou(ev.turn)} withTag={mode === "stream"} onTag={openGrouped}/>
          )}
          {/* live cursor — the wire stays open */}
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:12, color:"#FF8A00",
            animation:"mac-blink 1s steps(2) infinite",
          }}>▌</span>
        </div>
      </div>
      {away && (
        <button onClick={jumpLive} style={{
          position:"absolute", left:"50%", transform:"translateX(-50%)", bottom:10,
          fontFamily:"var(--mac-mono)", fontSize:11, padding:"3px 12px",
          border:"1px solid #000", background:"#000", color:"#FF8A00",
          cursor:"pointer", boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
        }}>↓ jump to live</button>
      )}
    </div>
  );

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      padding:"32px 40px", overflow:"auto",
    }}>
      <div style={{ width:1000, maxWidth:"100%", height:"calc(100vh - 64px)" }}>
        <MacWindow title="index · negotiation history" onClose={onClose} style={{ height:"100%" }}>
          <div style={{ display:"grid", gridTemplateRows:"auto 1fr auto", flex:1, minHeight:0 }}>

            {/* header: lifetime counters + mode/filter controls */}
            <div style={{
              padding:"10px 16px", borderBottom:"2px solid #000", background:"#fff",
              display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
            }}>
              <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#000" }}>
                <b>{all.length}</b> sessions · <b>{counts.won}</b> ✓ · <b>{counts.lost}</b> ✕ · <b>{counts.open}</b> open
              </span>
              <div style={{ flex:1 }}/>
              <MacSegmented value={mode} onChange={setMode} options={[
                { value:"stream", label:"stream" }, { value:"grouped", label:"grouped" },
              ]}/>
              <MacSegmented value={filter} onChange={(f) => { setFilter(f); setSelectedId(null); }} options={[
                { value:"all", label:"all" }, { value:"won", label:"won" },
                { value:"lost", label:"lost" }, { value:"open", label:"open" },
              ]}/>
            </div>

            {/* body: bare stream, or drawer + single-thread transcript */}
            {mode === "stream" ? log : (
              <div style={{
                display:"grid", gridTemplateColumns:"220px 1fr", minHeight:0,
              }}>
                <div className="mac-scroll" style={{
                  overflowY:"auto", padding:"12px 10px",
                  borderRight:"2px solid #000", background:"#F2F0EC",
                  display:"flex", flexDirection:"column", gap:6, alignContent:"start",
                }}>
                  {filtered.map((th) => (
                    <NegoThreadRow key={th.id} th={th}
                      active={selected && selected.id === th.id}
                      onPick={() => setSelectedId(th.id)}/>
                  ))}
                  {filtered.length === 0 && (
                    <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)", padding:6 }}>
                      no sessions here.
                    </span>
                  )}
                </div>
                {log}
              </div>
            )}

            {/* footer status line */}
            <div style={{
              borderTop:"1px solid #000", padding:"7px 16px", background:"#fff",
              display:"flex", alignItems:"center", gap:10,
              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)", letterSpacing:0.4,
            }}>
              <LiveDot size={6}/>
              <span>{away ? "paused · scrolled into history" : "following"}</span>
              <span>·</span>
              <span>{counts.open} open session{counts.open === 1 ? "" : "s"}</span>
              {mode === "grouped" && selected && (
                <React.Fragment>
                  <span>·</span>
                  <span>viewing {negoFirstName(selected)} · {selected.turns.length} turns</span>
                </React.Fragment>
              )}
              <div style={{ flex:1 }}/>
              <span>{live ? "live wire" : "offline"}</span>
            </div>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

window.NegotiationHistory = NegotiationHistory;
