// Agents: who speaks for you, then every agent that can act for you. A runtime
// found on this Mac wears an "on this mac" label and a switch. On registers it;
// off removes it. Hermes also wires the local plugin.

function liveClient() {
  if (!window.IndexApp || !window.IndexApp.isAuthed()) return null;
  return window.IndexApp.getClient() || null;
}

function errText(err) {
  const msg = err && err.message ? err.message : err;
  return String(msg || "something went wrong");
}

function ownerFirst() {
  return String((currentMe() || {}).name || "").trim().split(/\s+/)[0].toLowerCase();
}

// On/off switch. A sliding knob rather than a checkmark: these rows are states
// a runtime is in, not items you tick, and the knob's position reads at a
// glance down a column. Squared off, since a rounded pill would be the only
// round thing in the app.
function MiniSwitch({ on, onClick, label, fixed }) {
  return (
    <button
      type="button"
      onClick={fixed ? undefined : onClick}
      role="switch"
      aria-checked={on}
      aria-disabled={fixed || undefined}
      aria-label={label}
      style={{
        flex:"0 0 auto", width:34, height:18, padding:0,
        cursor: fixed ? "default" : "pointer",
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

// Status dot + word. Connected is live; detected is present but idle.
function AgentState({ state }) {
  const live = state !== "detected";
  return (
    <span style={{
      display:"flex", alignItems:"center", gap:6, minWidth:0, flex:"0 1 auto", overflow:"hidden",
      fontFamily:"var(--mac-mono)", fontSize:11,
      color: live ? "#000" : "var(--ink-3)",
    }}>
      <span style={{
        flex:"0 0 auto", width:6, height:6,
        background: live ? "#1FA95B" : "var(--ink-4)",
      }}/>
      <span style={{
        minWidth:0,
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{state}</span>
    </span>
  );
}

function NegotiatorBadge() {
  return (
    <span style={{
      flex:"0 0 auto",
      fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700, letterSpacing:0.4,
      background:"#FF8A00", color:"#000", padding:"2px 6px",
      border:"1px solid #000",
    }}>NEGOTIATOR</span>
  );
}

function NegotiatorMark() {
  return <span title="negotiator" style={{
    flex:"0 0 auto",
    fontFamily:"var(--mac-mono)", fontSize:13, lineHeight:1, color:"#000",
  }}>*</span>;
}

function RegisterLink({ open, disabled, onClick }) {
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
        boxSizing:"border-box",
        border:"1px solid " + (marked ? "#000" : "transparent"),
        background: open ? "#000" : "transparent",
        color: disabled ? "var(--ink-3)" : (open ? "#fff" : "#000"),
        padding:"1px 6px",
        cursor: disabled ? "default" : "pointer",
        fontFamily:"var(--mac-mono)", fontSize:12,
        textDecoration: marked ? "none" : "underline",
        textUnderlineOffset:3,
        outline:"none",
      }}>+ register manually</button>
  );
}

function RegisterName({ value, onChange, disabled, onSubmit }) {
  const [focus, setFocus] = useState(false);
  return (
    <label style={{ display:"block" }}>
      <span style={{
        display:"block", marginBottom:5,
        fontFamily:"var(--mac-mono)", fontSize:11, fontWeight:600, color:"#000",
      }}>name<span style={{ color:"#FF8A00", marginLeft:4 }}>*</span></span>
      <input
        autoFocus
        value={value}
        disabled={disabled}
        placeholder="agent name"
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onKeyDown={e => { if (e.key === "Enter") onSubmit(); }}
        style={{
          display:"block", width:"100%", boxSizing:"border-box",
          border:"1px solid #000",
          background: disabled ? "#EDEAE1" : "#fff",
          boxShadow: focus
            ? "inset 2px 2px 0 #000"
            : "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff",
          padding:"7px 10px",
          fontFamily:"var(--mac-mono)", fontSize:13,
          color: disabled ? "var(--ink-2)" : "#000",
          outline:"none",
        }}/>
    </label>
  );
}

function LineButton({ children, onClick, disabled, warn }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily:"var(--mac-mono)", fontSize:12, padding:"5px 12px",
        border:"1px solid #000",
        background: disabled ? "#F2F0EC" : "#fff",
        color: disabled ? "var(--ink-2)" : (warn ? "var(--ink-warn)" : "#000"),
        boxShadow: disabled ? "none" : "1px 1px 0 rgba(0,0,0,0.2)",
        cursor: disabled ? "default" : "pointer",
      }}>{children}</button>
  );
}

// Asks once. This shell has no confirm(), so the second click is the confirm.
function RemoveButton({ onRemove, disabled }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (armed) onRemove(); else setArmed(true); }}
      onBlur={() => setArmed(false)}
      style={{
        boxSizing:"border-box", height:18, padding:"0 8px",
        fontFamily:"var(--mac-mono)", fontSize:11, lineHeight:1,
        border:"1px solid #000",
        background: armed ? "var(--ink-warn)" : "#fff",
        color: armed ? "#fff" : "#000",
        cursor: disabled ? "default" : "pointer",
      }}>{armed ? "confirm" : "remove"}</button>
  );
}

function BandHead({ label, action, first }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:10,
      margin: first ? "0 0 8px" : "26px 0 8px",
      fontFamily:"var(--mac-mono)", fontSize:13, letterSpacing:1.4,
      textTransform:"uppercase", fontWeight:700, color:"#000",
    }}>
      <span>{label}</span>
      <div style={{
        flex:1, height:2,
        background:"linear-gradient(#000, #000) top/100% 1px no-repeat, linear-gradient(#fff, #fff) bottom/100% 1px no-repeat",
      }}/>
      {action && (
        <span style={{ textTransform:"none", letterSpacing:0, fontWeight:400 }}>{action}</span>
      )}
    </div>
  );
}

function BandCopy({ children }) {
  return (
    <p style={{
      margin:"0 0 12px",
      fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
    }}>{children}</p>
  );
}

function FaultLine({ children }) {
  if (!children) return null;
  return (
    <p style={{
      margin:"0 0 10px",
      fontFamily:"var(--mac-mono)", fontSize:11, lineHeight:1.45, color:"var(--ink-warn)",
    }}>{children}</p>
  );
}

function Frame({ children, dim }) {
  return (
    <div style={{
      border:"1px solid #000", background:"#fff",
      boxShadow:"2px 2px 0 rgba(0,0,0,0.22)",
      opacity: dim ? 0.5 : 1,
      transition:"opacity 140ms linear",
    }}>{children}</div>
  );
}

// Shown when a connected agent is expanded. The switch turns the runtime on;
// these tick what it is allowed to do. Nightly indexing has no field yet.
const AGENT_OPTIONS = [
  { key:"notifyOnOpportunity", title:"connection updates",
    blurb:"tells this agent when an opportunity is accepted or someone reaches out." },
  { key:"indexing", title:"nightly indexing",
    blurb:"turns what this agent learned today into signals, overnight. off means discovery only knows what you've told it." },
  { key:"dailySummaryEnabled", title:"daily brief",
    blurb:"one message at 08:00 with new overlaps and anything waiting on you." },
];

function RosterRow({ name, badge, detail, id, aside, last, onClick, expanded, onToggle }) {
  const [hover, setHover] = useState(false);
  const opens = !!(onClick || onToggle);
  const columns = id != null;
  const row = {
    display: columns ? "grid" : "flex",
    gridTemplateColumns: columns ? "minmax(0,1fr) 168px 84px 140px 18px" : undefined,
    alignItems:"center", gap:12, width:"100%", boxSizing:"border-box",
    padding:"10px 12px", textAlign:"left",
    border:"none", borderBottom: last && !expanded ? "none" : "1px solid #000",
    background: (opens && (hover || expanded)) ? "#F2EFE6" : "#fff",
    cursor: opens ? "pointer" : "default",
    font:"inherit", color:"inherit",
  };
  const body = (
    <React.Fragment>
      <span style={{ flex: columns ? undefined : "1 1 34%", minWidth:0, display:"flex", alignItems:"center", gap:8 }}>
        <span style={{
          minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{name}</span>
        {badge}
      </span>
      <span style={{
        flex: columns ? undefined : "1 1 40%", minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{detail}</span>
      {columns && (
        <span style={{ minWidth:0 }}>
          {id ? <CopyId id={id}/> : null}
        </span>
      )}
      {aside != null && aside !== "" && (
        <span
          onClick={onToggle ? (e => e.stopPropagation()) : undefined}
          style={{
            minWidth: columns ? 0 : 108,
            display:"flex", justifyContent:"flex-end", alignItems:"center", overflow:"hidden",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
          }}>{aside}</span>
      )}
      {(onToggle || columns) && (
        <span aria-hidden="true" style={{
          width:18, textAlign:"center",
          fontFamily:"var(--mac-mono)", fontSize:12, color:"#000",
        }}>{onToggle ? (expanded ? "▾" : "›") : ""}</span>
      )}
    </React.Fragment>
  );
  const hoverProps = {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
  };
  if (onToggle) {
    return (
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={!!expanded}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); }
        }}
        {...hoverProps}
        style={row}>{body}</div>
    );
  }
  if (!onClick) return <div style={row}>{body}</div>;
  return (
    <button type="button" onClick={onClick} {...hoverProps} style={row}>{body}</button>
  );
}

function CopyId({ id }) {
  const [copied, setCopied] = useState(false);
  const short = String(id || "");
  const copy = () => {
    const write = navigator.clipboard && navigator.clipboard.writeText(short);
    if (!write) return;
    write.then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); copy(); }}
      title={copied ? "copied" : short}
      aria-label="copy agent id"
      style={{
        border:"none", background:"none", padding:0,
        cursor:"pointer", fontFamily:"var(--mac-mono)", fontSize:11,
        color:"var(--ink-4)", letterSpacing:0.2, whiteSpace:"nowrap",
      }}>{copied ? "copied" : `${short.slice(0, 8)}…`}</button>
  );
}

function AgentOptions({ agent, indexing, onToggle, last }) {
  return (
    <div style={{
      background:"#F2F0EC",
      borderBottom: last ? "none" : "1px solid #000",
      padding:"11px 12px 12px",
    }}>
      <div style={{ display:"grid", gap:8 }}>
        {AGENT_OPTIONS.map(option => (
          <Toggle
            key={option.key}
            on={option.key === "indexing" ? indexing : !!agent[option.key]}
            onClick={() => onToggle(agent, option.key)}
            title={option.title}
            blurb={option.blurb}/>
        ))}
      </div>
    </div>
  );
}

const KIND_DETAIL = {
  index: "hosted by index",
  runtime: "on this mac",
  manual: "registered manually",
};

function Agents({ onClose }) {
  const [agents, setAgents] = useState([]);
  const [detected, setDetected] = useState(null);
  const [picking, setPicking] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [busyOn, setBusyOn] = useState(false);
  const [busyLine, setBusyLine] = useState("");
  const [fault, setFault] = useState(null);
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [indexing, setIndexing] = useState({});
  const checkTimer = useRef(null);
  const inflight = useRef(false);

  const refresh = () => {
    const client = liveClient();
    if (!client) {
      setAgents([]);
      return Promise.resolve();
    }
    return client.agents.list()
      .then((res) => {
        setAgents(window.IndexApp.normalizeList(res, "agents").filter(a => a.type !== "system"));
      })
      .catch((err) => setFault({ scope:"connected", text: errText(err) }));
  };

  const scan = () => {
    if (!window.IndexApp || !window.IndexApp.detectHarnesses) {
      setDetected([]);
      return Promise.resolve();
    }
    return window.IndexApp.detectHarnesses().then((list) => {
      setDetected((list || []).map(h => ({ id:`local-${h.id}`, name:h.label })));
    });
  };

  useEffect(() => { refresh(); scan(); }, []);
  useEffect(() => () => clearTimeout(checkTimer.current), []);
  useEffect(() => {
    if (!window.IndexApp || !window.IndexApp.onHermesProgress) return;
    return window.IndexApp.onHermesProgress((step) => { if (step) setBusyLine(step); });
  }, []);

  const locked = !!busyId || checking;
  const runtimes = detected || [];
  const used = new Set();
  const runtimeAgents = [];
  runtimes.forEach((runtime) => {
    const hit = agents.find(a => !used.has(a.id) && String(a.name || "").trim().toLowerCase() === runtime.name.toLowerCase());
    if (!hit) return;
    used.add(hit.id);
    runtimeAgents.push(hit);
  });
  const manualAgents = agents.filter(a => !used.has(a.id));
  const carrier = agents.find(a => a.handleNegotiations && a.status !== "inactive") || null;
  const carrierKind = !carrier ? "index" : (used.has(carrier.id) ? "runtime" : "manual");
  const first = ownerFirst();
  const who = first ? `${first}'s agent` : "your agent";

  const needAccount = () => {
    alert("sign in first.");
    return null;
  };

  const fail = (scope, err) => setFault({ scope, text: errText(err) });

  const begin = () => {
    if (inflight.current || locked) return false;
    inflight.current = true;
    setFault(null);
    return true;
  };
  const finish = () => {
    inflight.current = false;
    setBusyId(null);
    setBusyLine("");
  };

  const selectCarrier = (agent) => {
    const client = liveClient() || needAccount();
    if (!client) return;
    const current = agents.find(a => a.handleNegotiations && a.status !== "inactive") || null;
    if (!agent) {
      if (!current) { setPicking(false); return; }
    } else if (current && current.id === agent.id) {
      setPicking(false);
      return;
    }
    if (!begin()) return;
    setBusyId("pick");
    const job = agent
      ? client.agents.update(agent.id, { handleNegotiations: true })
      : client.agents.update(current.id, { handleNegotiations: false });
    job
      .then(() => refresh())
      .then(() => setPicking(false))
      .catch((err) => fail("negotiator", err))
      .then(finish);
  };

  const createManual = () => {
    const name = draftName.trim();
    if (!name) return;
    const client = liveClient() || needAccount();
    if (!client || !begin()) return;
    setBusyId("register");
    client.agents.create({ name })
      .then(() => {
        setDraftName("");
        setRegisterOpen(false);
        return refresh();
      })
      .catch((err) => fail("connected", err))
      .then(finish);
  };

  const removeAgent = (agent) => {
    const client = liveClient() || needAccount();
    if (!client || !begin()) return;
    setBusyId(agent.id);
    const clear = agent.handleNegotiations
      ? client.agents.update(agent.id, { handleNegotiations: false })
      : Promise.resolve();
    clear
      .then(() => client.agents.delete(agent.id))
      .then(() => refresh())
      .catch((err) => fail("connected", err))
      .then(finish);
  };

  const toggleRuntime = (runtime) => {
    const client = liveClient() || needAccount();
    if (!client || !begin()) return;
    const existing = agents.find(a => String(a.name || "").trim().toLowerCase() === runtime.name.toLowerCase());
    const turningOn = !existing;
    const hermes = runtime.name.toLowerCase() === "hermes";
    setBusyId(runtime.id);
    setBusyOn(turningOn);
    setBusyLine(turningOn ? "adding" : "removing");
    let job = Promise.resolve();
    if (hermes) {
      job = job.then(() => {
        const fn = turningOn ? window.IndexApp.setupHermes : window.IndexApp.teardownHermes;
        if (!fn) throw new Error("no native bridge");
        return fn();
      }).then((r) => {
        if (!(r && r.ok)) throw new Error((r && r.error) || "could not update Hermes");
      });
    }
    job
      .then(() => {
        if (turningOn) return client.agents.create({ name: runtime.name });
        const clear = existing.handleNegotiations
          ? client.agents.update(existing.id, { handleNegotiations: false })
          : Promise.resolve();
        return clear.then(() => client.agents.delete(existing.id));
      })
      .then(() => refresh())
      .catch((err) => fail("connected", err))
      .then(finish);
  };

  const toggleSetting = (agent, key) => {
    if (key === "indexing") {
      setIndexing(s => ({ ...s, [agent.id]: !s[agent.id] }));
      return;
    }
    const client = liveClient() || needAccount();
    if (!client) return;
    const next = !agent[key];
    setAgents(list => list.map(a => a.id === agent.id ? { ...a, [key]: next } : a));
    client.agents.update(agent.id, { [key]: next }).catch((err) => {
      fail("connected", err);
      refresh();
    });
  };

  const check = () => {
    if (locked) return;
    setChecking(true);
    setFault(null);
    Promise.all([scan(), refresh()]).then(() => {
      checkTimer.current = setTimeout(() => setChecking(false), 700);
    });
  };

  const choices = [
    { id:"index", name:"Index", kind:"index", agent:null },
    ...runtimeAgents.map(a => ({ id:a.id, name:a.name, kind:"runtime", agent:a })),
    ...manualAgents.map(a => ({ id:a.id, name:a.name, kind:"manual", agent:a })),
  ];

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(880px, calc(100vh - 96px))",
      }}>
        <MacWindow title="agents" onClose={onClose} style={{ height:"100%", minHeight:0 }}>
          <div style={{ padding:"18px 24px 14px", borderBottom:"2px solid #000" }}>
            <h2 style={{
              margin:0,
              fontFamily:"var(--mac-mono)", fontSize:22, fontWeight:700, color:"#000",
            }}>agents</h2>
          </div>

          <div className="mac-scroll" style={{
            flex:"1 1 auto", minHeight:0, overflowY:"auto",
            padding:"18px 24px 22px",
          }}>
            <BandHead label="your negotiator" first/>
            <BandCopy>
              one agent speaks for {who} in the network. index takes over if it's offline.
            </BandCopy>
            <FaultLine>{fault && fault.scope === "negotiator" ? fault.text : null}</FaultLine>
            <Frame>
              <div style={{
                display:"flex", alignItems:"center", gap:14, padding:"12px 14px",
                borderBottom: picking ? "1px solid #000" : "none",
              }}>
                <MyAgentAvatar size={48}/>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{
                    fontFamily:"var(--mac-mono)", fontSize:16, fontWeight:700, color:"#000",
                  }}>{carrier ? carrier.name : "Index"}</div>
                  <div style={{
                    marginTop:2,
                    fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
                  }}>{KIND_DETAIL[carrierKind]}</div>
                </div>
                <LineButton onClick={() => setPicking(open => !open)} disabled={locked}>
                  {picking ? "cancel" : "change"}
                </LineButton>
              </div>
              {picking && choices.map((choice, i) => (
                <RosterRow
                  key={choice.id}
                  last={i === choices.length - 1}
                  name={choice.name}
                  badge={(!carrier && choice.kind === "index") || (carrier && choice.agent && carrier.id === choice.agent.id)
                    ? <NegotiatorBadge/> : null}
                  detail={KIND_DETAIL[choice.kind]}
                  onClick={() => selectCarrier(choice.agent)}
                />
              ))}
            </Frame>

            <BandHead
              label="connected agents"
              action={
                <span style={{ display:"inline-flex", alignItems:"center", gap:14 }}>
                  <RegisterLink
                    open={registerOpen}
                    disabled={locked}
                    onClick={() => setRegisterOpen(open => !open)}/>
                  <ActionButton title="look for agent runtimes again" disabled={locked} onClick={check}>
                    <span style={{ display:"inline-flex", alignItems:"center", gap:7 }}>
                      <span style={{
                        display:"inline-block",
                        animation: checking ? "mac-orbit 0.7s linear infinite" : "none",
                      }}>↻</span>
                      {checking ? "checking" : "check"}
                    </span>
                  </ActionButton>
                </span>
              }/>
            <BandCopy>everything that can act for you, from any device.</BandCopy>
            <FaultLine>{fault && (fault.scope === "connected" || fault.scope === "mac") ? fault.text : null}</FaultLine>
            {registerOpen && (
              <div style={{ display:"grid", gap:10, maxWidth:420, marginBottom:12 }}>
                <RegisterName
                  value={draftName}
                  onChange={setDraftName}
                  disabled={locked}
                  onSubmit={createManual}/>
                <div style={{ display:"flex", gap:8 }}>
                  <ActionButton
                    disabled={locked || !draftName.trim()}
                    onClick={createManual}>create</ActionButton>
                  <LineButton disabled={locked} onClick={() => setRegisterOpen(false)}>cancel</LineButton>
                </div>
              </div>
            )}
            <Frame dim={checking}>
              <RosterRow
                name="Index"
                badge={!carrier ? <NegotiatorMark/> : null}
                detail={KIND_DETAIL.index}
                id=""
                aside="always on"/>
              {detected === null && (
                <div style={{
                  padding:"12px",
                  borderBottom: manualAgents.length ? "1px solid #000" : "none",
                  fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)",
                }}>looking…</div>
              )}
              {detected && detected.length === 0 && (
                <div style={{
                  padding:"12px",
                  borderBottom: manualAgents.length ? "1px solid #000" : "none",
                  fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)",
                }}>no agent runtimes found on this mac</div>
              )}
              {runtimes.map((runtime, i) => {
                const match = agents.find(a => String(a.name || "").trim().toLowerCase() === runtime.name.toLowerCase());
                const on = busyId === runtime.id ? busyOn : !!match;
                const state = busyId === runtime.id
                  ? (busyLine || "working")
                  : (match ? "connected" : "detected");
                const open = !!(match && expanded === match.id);
                const last = manualAgents.length === 0 && i === runtimes.length - 1;
                return (
                  <React.Fragment key={runtime.id}>
                    <RosterRow
                      last={last}
                      expanded={open}
                      onToggle={match ? () => setExpanded(id => id === match.id ? null : match.id) : undefined}
                      name={runtime.name}
                      badge={match && carrier && carrier.id === match.id ? <NegotiatorMark/> : null}
                      detail={KIND_DETAIL.runtime}
                      id={match ? match.id : ""}
                      aside={
                        <span style={{ display:"flex", alignItems:"center", justifyContent:"flex-end", gap:10, minWidth:0, maxWidth:"100%" }}>
                          <AgentState state={state}/>
                          <MiniSwitch
                            on={on}
                            fixed={locked}
                            onClick={() => toggleRuntime(runtime)}
                            label={`${runtime.name} on`}/>
                        </span>
                      }/>
                    {open && <AgentOptions agent={match} indexing={!!indexing[match.id]} onToggle={toggleSetting} last={last}/>}
                  </React.Fragment>
                );
              })}
              {manualAgents.map((agent, i) => {
                const open = expanded === agent.id;
                const last = i === manualAgents.length - 1;
                return (
                  <React.Fragment key={agent.id}>
                    <RosterRow
                      last={last}
                      expanded={open}
                      onToggle={() => setExpanded(id => id === agent.id ? null : agent.id)}
                      name={agent.name}
                      badge={carrier && carrier.id === agent.id ? <NegotiatorMark/> : null}
                      detail={KIND_DETAIL.manual}
                      id={agent.id}
                      aside={<RemoveButton disabled={locked} onRemove={() => removeAgent(agent)}/>}/>
                    {open && <AgentOptions agent={agent} indexing={!!indexing[agent.id]} onToggle={toggleSetting} last={last}/>}
                  </React.Fragment>
                );
              })}
            </Frame>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}
