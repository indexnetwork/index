// Agents: the runtimes on this Mac, and which one speaks for you.
// Reached from the agents row on the hub's sidebar footer, same as networks.

// On/off switch. A sliding knob rather than a checkmark: these rows are states
// a runtime is in, not items you tick, and the knob's position reads at a
// glance down a column. Squared off, since a rounded pill would be the only
// round thing in the app.
function MiniSwitch({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      style={{
        flex:"0 0 auto", width:34, height:18, padding:0, cursor:"pointer",
        border:"1px solid #000",
        background: on ? "#FF8A00" : "#EDEAE1",
        boxShadow: on
          ? "inset 1px 1px 0 #8A4500"
          : "inset 1px 1px 0 var(--ink-3)",
        display:"flex", alignItems:"center",
        justifyContent: on ? "flex-end" : "flex-start",
      }}>
      <span style={{
        width:14, height:14, margin:1,
        background:"#fff", border:"1px solid #000",
        boxShadow:"inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
      }}/>
    </button>
  );
}

// Status dot + word. Connected is live (accent); detected is present but idle.
function AgentState({ state, negotiator }) {
  const live = state === "connected";
  return (
    <span style={{
      display:"flex", alignItems:"center", gap:6, minWidth:0,
      fontFamily:"var(--mac-mono)", fontSize:11,
      color: live ? "#000" : "var(--ink-3)",
    }}>
      <span style={{
        flex:"0 0 auto", width:6, height:6,
        background: live ? "#1FA95B" : "var(--ink-4)",
      }}/>
      {state}{negotiator && " · negotiates for you"}
    </span>
  );
}

function AgentRow({ agent, expanded, onToggleExpand, onToggleOn, perms, onTogglePerm, isNegotiator, last }) {
  const connected = agent.state === "connected";
  const [hover, setHover] = useState(false);

  // The whole row opens the row. A div rather than a button, because the switch
  // inside is itself a button and buttons can't nest; the switch stops the
  // click from bubbling so toggling an agent never also expands it.
  const open = () => { if (connected) onToggleExpand(agent.id); };

  return (
    // the container draws the outer frame, so the last row skips its divider
    <div style={{ borderBottom: last ? "none" : "1px solid #000" }}>
      <div
        onClick={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        role={connected ? "button" : undefined}
        tabIndex={connected ? 0 : undefined}
        aria-expanded={connected ? expanded : undefined}
        onKeyDown={e => {
          if (!connected) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
        }}
        title={connected ? "permissions" : "connect this agent to configure it"}
        style={{
          display:"flex", alignItems:"center", gap:11,
          padding:"9px 12px",
          background: (connected && (hover || expanded)) ? "#F2EFE6" : "#fff",
        }}>
        {/* no picture here. a runtime is a process on this mac, not somebody.
            the only thing in the app with a face is your negotiator, above */}
        <span style={{
          flex:"0 0 auto", minWidth:140,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{agent.name}</span>
        <span style={{ flex:1, minWidth:0 }}>
          <AgentState state={agent.state} negotiator={isNegotiator}/>
        </span>
        {/* the one thing in the row that isn't "open the row" */}
        <span
          onClick={e => e.stopPropagation()}
          style={{ flex:"0 0 auto", display:"flex" }}>
          <MiniSwitch on={agent.on} onClick={() => onToggleOn(agent.id)}
            label={`${agent.name} on`}/>
        </span>
        {/* indicator now, not a control, the row carries the click */}
        <span aria-hidden="true" style={{
          flex:"0 0 auto", width:18, textAlign:"center",
          fontFamily:"var(--mac-mono)", fontSize:12,
          color: connected ? "#000" : "var(--ink-4)",
        }}>{expanded ? "▾" : "›"}</span>
      </div>

      {expanded && connected && (
        <div style={{
          background:"#F2F0EC", borderTop:"1px solid #000",
          padding:"11px 12px 12px",
        }}>
          <div style={{
            display:"flex", alignItems:"center", justifyContent:"space-between",
            gap:12, flexWrap:"wrap", marginBottom:11,
          }}>
            <span style={{
              fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
            }}>{agent.connectedAs} · heartbeat {agent.heartbeat}</span>
            <span style={{ display:"flex", gap:8, flex:"0 0 auto" }}>
              <button style={{
                fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
                border:"1px solid #000", background:"#fff", color:"#000",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>test</button>
              <button style={{
                fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
                border:"1px solid #000", background:"#fff", color:"var(--ink-warn)",
                boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
              }}>disconnect</button>
            </span>
          </div>

          {/* Permissions are checkboxes, not switches. Two different kinds of
              thing: the runtime switch turns an agent on, these tick what it's
              allowed to do. Reuses the same Toggle as the notifications pane,
              so a checkbox looks the same everywhere in the app, and the
              switch stays the only right-hand control. */}
          <div style={{ display:"grid", gap:8 }}>
            {AGENT_PERMISSIONS.map(p => (
              <Toggle
                key={p.id}
                on={!!perms[p.id]}
                onClick={() => onTogglePerm(agent.id, p.id)}
                title={p.title}
                blurb={p.blurb}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Your negotiator's identity, the one agent that speaks for you, and the only
// thing on this page with a face. Laid out like the profile block in settings
// (picture on the left as the control, name beside it) because it is the same
// kind of thing: who you are to the network, and who your agent is.
//
// Shuffle is the primary move, a generated avatar's whole point is that a new
// one is one click away, and the kit has 3,600 draws behind it. Uploading is
// second because a picture you chose is the rarer case, and it can be dropped
// again to fall back to the generated face.
function NegotiatorProfile({ agent, onShuffle, onPick, onClear,
                            runtimeOptions, runtime, onChangeRuntime }) {
  const [err, setErr] = useState("");
  const btn = {
    fontFamily:"var(--mac-mono)", fontSize:11, padding:"5px 12px",
    border:"1px solid #000", background:"#fff", color:"#000",
    boxShadow:"1px 1px 0 rgba(0,0,0,0.2)", cursor:"pointer",
  };
  return (
    <div style={{ display:"grid", gap:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
        <PicturePicker size={54} label="change your agent's picture"
          onPick={(d) => { setErr(""); onPick(d); }} onError={setErr}>
          <MyAgentAvatar size={54}/>
        </PicturePicker>

        <div style={{ display:"grid", gap:6, minWidth:0 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000",
          }}>{agent.name}</div>
          <div style={{ display:"flex", alignItems:"center", gap:9, flexWrap:"wrap" }}>
            <button style={btn} onClick={() => { setErr(""); onShuffle(); }}>⟳ shuffle</button>
            {agent.photo
              ? <button style={btn} onClick={() => { setErr(""); onClear(); }}>use generated</button>
              : <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)" }}>
                  generated · {agentFaceFor(agent.seed).face.name}
                </span>}
          </div>
          {err && (
            <div style={{ fontFamily:"var(--mac-sans)", fontSize:11, color:"var(--ink-warn)" }}>{err}</div>
          )}
        </div>
      </div>

      {/* Which runtime carries it. This used to be its own section, but "who
          your agent is" and "what it runs on" are two facts about one agent.
          split across two headings they read as two different settings. */}
      <div style={{ display:"grid", gap:7 }}>
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:1,
          textTransform:"uppercase", color:"var(--ink-2)",
        }}>runs on</span>
        <NegotiatorSelect
          options={runtimeOptions}
          value={runtime}
          onChange={onChangeRuntime}
        />
        <span style={{
          fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
        }}>index takes over if it's unavailable.</span>
      </div>
    </div>
  );
}

// Negotiator picker. A dropdown rather than a card per runtime: the list is
// short, only one can be chosen, and the cards repeated the same three lines
// four times over. Only runtimes that are switched on appear, so there's no
// disabled state to explain.
function NegotiatorSelect({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find(o => o.id === value) || options[0];
  const rowHover = (on) => (e) => {
    e.currentTarget.style.background = on ? "#000" : "transparent";
    e.currentTarget.style.color = on ? "#FF8A00" : "#000";
  };

  return (
    <div ref={wrapRef} style={{ position:"relative", maxWidth:360 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display:"flex", alignItems:"center", gap:10, width:"100%",
          padding:"8px 11px", textAlign:"left", cursor:"pointer",
          border:"1px solid #000", background: open ? "#F2EFE6" : "#fff",
          boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
        }}>
        <span style={{
          flex:1, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
        }}>{current.label}</span>
        <span style={{
          flex:"0 0 auto",
          fontFamily:"var(--mac-mono)", fontSize:12, color:"#000",
          transform: open ? "rotate(180deg)" : "none",
        }}>▾</span>
      </button>

      {open && (
        <div role="listbox" className="fade-up" style={{
          position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:40,
          width:"100%", background:"#fff",
          border:"1px solid #000", boxShadow:"3px 3px 0 rgba(0,0,0,0.22)",
          padding:"4px 0",
        }}>
          {options.map(o => (
            <button
              key={o.id}
              role="option"
              aria-selected={o.id === value}
              onClick={() => { onChange(o.id); setOpen(false); }}
              onMouseEnter={rowHover(true)}
              onMouseLeave={rowHover(false)}
              style={{
                display:"flex", alignItems:"center", gap:8,
                width:"100%", textAlign:"left",
                padding:"6px 11px", border:"none", background:"transparent",
                fontFamily:"var(--mac-mono)", fontSize:12, cursor:"pointer", color:"#000",
              }}>
              <span style={{ flex:"0 0 auto", width:8 }}>{o.id === value ? "•" : ""}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Screen shell mirrors Networks: same 860 x min(660px) frame, same header band
// with a title and a right-hand action, so moving between the two shelf
// destinations doesn't resize or restyle the window.
// Map one GET /agents entity into the row shape used here. Read-only: agent
// management writes are session-only and unreachable with an API key.
function mapLiveAgent(a) {
  const TINTS = ["#4C6FD4", "#B4553F", "#3E8E7E", "#C64B8C", "#7B5EA7", "#E8A317"];
  const name = a.name || "agent";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const seen = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
  const connected = !!seen && (Date.now() - seen) < 90000;
  const rel = (iso) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "unknown";
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  };
  return {
    id: a.id,
    name,
    initial: (name[0] || "a").toLowerCase(),
    tint: TINTS[h % TINTS.length],
    state: connected ? "connected" : "detected",
    on: a.status ? a.status === "active" : true,
    connectedAs: a.description || "personal agent",
    heartbeat: a.lastSeenAt ? rel(a.lastSeenAt) : "no heartbeat",
  };
}

function Agents({ onClose }) {
  const { AGENTS } = window.INDEX_DATA;
  const [agents, setAgents] = useState(AGENTS);
  const [expanded, setExpanded] = useState(null);

  // Live agents are read-only, fetch and display, but toggles stay local.
  useEffect(() => {
    if (!window.IndexApp || !window.IndexApp.isAuthed()) return;
    const client = window.IndexApp.getClient();
    if (!client) return;
    let cancelled = false;
    client.agents.list()
      .then((res) => {
        if (cancelled) return;
        const list = window.IndexApp.normalizeList(res, "agents").map(mapLiveAgent);
        if (list.length) setAgents(list);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [perms, setPerms] = useState(() => ({
    hermes: { updates:true, indexing:true, brief:true },
    claude: { updates:true, indexing:false, brief:false },
  }));
  const [negotiator, setNegotiator] = useState("hermes");

  // "check again" re-scans for runtimes. Nothing changes in the prototype, but
  // the button has to show it did something, so it spins for a beat and locks
  // out re-clicks while it does.
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef(null);
  useEffect(() => () => clearTimeout(checkTimer.current), []);
  const check = () => {
    if (checking) return;
    setChecking(true);
    checkTimer.current = setTimeout(() => setChecking(false), 1400);
  };

  const toggleOn = (id) => setAgents(list => list.map(a => {
    if (a.id !== id) return a;
    const on = !a.on;
    // switching a runtime off can't leave it as your negotiator
    if (!on && negotiator === id) setNegotiator("index");
    return { ...a, on };
  }));

  const togglePerm = (agentId, permId) => setPerms(p => ({
    ...p,
    [agentId]: { ...p[agentId], [permId]: !(p[agentId] || {})[permId] },
  }));

  // Your negotiator's picture. Written straight onto the shared ME record the
  // way settings commits a profile edit, so every other surface, the feed, a
  // question card, onboarding, picks it up the next time it renders. `bump`
  // only exists to re-render this pane, since ME is a plain object.
  const [, bump] = useState(0);
  const myNegotiator = myAgent();
  const commitFace = (patch) => { Object.assign(ME, patch); bump(n => n + 1); };
  // any distinct string moves the hash; the counter stops two shuffles in the
  // same millisecond from landing on the same draw
  const shuffleCount = useRef(0);
  const shuffleFace = () => {
    shuffleCount.current += 1;
    commitFace({
      agentFaceSeed: `${ME.name}#${shuffleCount.current}-${Math.floor(performance.now())}`,
      agentPhoto: null,
    });
  };
  const pickPhoto = (photo) => commitFace({ agentPhoto: photo });
  const clearPhoto = () => commitFace({ agentPhoto: null });

  // Only runtimes you've switched on can speak for you, so only those are
  // offered. Index is always available as the fallback.
  const negotiatorOptions = [
    { id:"index", label:"index · system default" },
    ...agents.filter(a => a.on).map(a => ({ id:a.id, label:`${a.name} · on this mac` })),
  ];

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* Back to the shared networks/detail frame: the negotiator cards were
          what overflowed 660px, and the dropdown that replaced them is one row. */}
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(660px, calc(100vh - 112px))",
      }}>
        <MacWindow
          title="index · agents"
          onClose={onClose}
          style={{ height:"100%", minHeight:0 }}>

          <div style={{ padding:"18px 24px 14px", borderBottom:"2px solid #000" }}>
            <div style={{
              display:"flex", alignItems:"center", justifyContent:"space-between", gap:12,
            }}>
              <h2 style={{
                margin:0,
                fontFamily:"var(--mac-mono)", fontSize:19, fontWeight:700, color:"#000",
              }}>agents</h2>
              <ActionButton
                title="look for agent runtimes again"
                onClick={check}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}>
                  <span style={{
                    display:"inline-block",
                    animation: checking ? "mac-orbit 0.7s linear infinite" : "none",
                  }}>↻</span>
                  {checking ? "checking" : "check again"}
                </span>
              </ActionButton>
            </div>
            <p style={{
              margin:"10px 0 0", maxWidth:560,
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
            }}>
              agents on this mac can act for you. what each one is allowed to
              do is set here.
            </p>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"18px 24px 22px",
          }}>
            {/* What's on the machine first, then who speaks for you out of it.
                the inventory is the concrete thing, the negotiator is the choice
                you make from it. */}
            <RuleLabel>runtimes</RuleLabel>
            <p style={{
              margin:"8px 0 10px", maxWidth:560,
              fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
            }}>
              connected agents can create signals and negotiate for you.
            </p>

            {/* one framed block; rows divide it, so it reads as a single
                inventory of this machine rather than four loose cards */}
            <div style={{
              border:"1px solid #000", background:"#fff",
              boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
              opacity: checking ? 0.5 : 1,
              transition:"opacity 140ms linear",
            }}>
              {agents.map((a, i) => (
                <AgentRow
                  key={a.id}
                  last={i === agents.length - 1}
                  agent={a}
                  expanded={expanded === a.id}
                  onToggleExpand={(id) => setExpanded(e => e === id ? null : id)}
                  onToggleOn={toggleOn}
                  perms={perms[a.id] || {}}
                  onTogglePerm={togglePerm}
                  isNegotiator={negotiator === a.id}
                />
              ))}
            </div>

            <SectionRule>negotiator agent</SectionRule>
            <p style={{
              margin:"8px 0 12px", maxWidth:560,
              fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
            }}>
              this is how your agent appears wherever it speaks for you, asking
              you a question, sending an update, negotiating with someone else's.
            </p>

            <NegotiatorProfile
              agent={myNegotiator}
              onShuffle={shuffleFace}
              onPick={pickPhoto}
              onClear={clearPhoto}
              runtimeOptions={negotiatorOptions}
              runtime={negotiator}
              onChangeRuntime={setNegotiator}
            />
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
