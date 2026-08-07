// Agents: the runtimes on this Mac, and which one speaks for you.
// Reached from the agents row on the hub's sidebar footer, same as networks.

// Per-agent permissions, shown when a connected runtime is expanded.
const AGENT_PERMISSIONS = [
  { id:"updates", title:"connection updates",
    blurb:"tells this agent when an opportunity is accepted or someone reaches out." },
  { id:"indexing", title:"nightly indexing",
    blurb:"turns what this agent learned today into signals, overnight. off means "
        + "discovery only knows what you've told it." },
  { id:"brief", title:"daily brief",
    blurb:"one message at 08:00 with new overlaps and anything waiting on you." },
];

// On/off switch. A sliding knob rather than a checkmark: these rows are states
// a runtime is in, not items you tick, and the knob's position reads at a
// glance down a column. Squared off, since a rounded pill would be the only
// round thing in the app.
function MiniSwitch({ on, onClick, label, fixed }) {
  return (
    <button
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

// Status dot + word. Connected is live (accent); detected is present but idle.
function AgentState({ state }) {
  // "detected" is the only idle state; "connected" and "system default" are live
  const live = state !== "detected";
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
      {state}
    </span>
  );
}

function AgentRow({ agent, expanded, onToggleExpand, onToggleOn, perms, onTogglePerm, last }) {
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
        title={agent.builtin ? "index is built in and always on"
          : connected ? "permissions" : "connect this agent to configure it"}
        style={{
          display:"flex", alignItems:"center", gap:11,
          padding:"9px 12px",
          background: (connected && (hover || expanded)) ? "#F2EFE6" : "#fff",
        }}>
        {/* no picture here. a runtime is a process on this mac, not somebody.
            the only thing in the app with a face is your negotiator, above */}
        <span style={{
          flex:"0 0 auto", minWidth:146,
          fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:600, color:"#000",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{agent.name}</span>
        <span style={{ flex:1, minWidth:0 }}>
          <AgentState state={agent.state}/>
        </span>
        {/* the one thing in the row that isn't "open the row" */}
        <span
          onClick={e => e.stopPropagation()}
          style={{ flex:"0 0 auto", display:"flex" }}>
          <MiniSwitch on={agent.on} onClick={() => onToggleOn(agent.id)}
            fixed={agent.builtin} label={`${agent.name} on`}/>
        </span>
        {/* indicator now, not a control, the row carries the click.
            the builtin row never opens, so it carries no chevron */}
        <span aria-hidden="true" style={{
          flex:"0 0 auto", width:18, textAlign:"center",
          fontFamily:"var(--mac-mono)", fontSize:12,
          color: connected ? "#000" : "var(--ink-4)",
        }}>{agent.builtin ? "" : expanded ? "▾" : "›"}</span>
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
            }}>
              connected as {agent.connectedAs}
              {agent.heartbeat ? ` · last heartbeat ${agent.heartbeat}` : " · no heartbeat yet"}
            </span>
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
// (picture on the left, name beside it) because it is the same kind of thing:
// who you are to the network, and who your agent is. The face is derived from
// your account id, so it is persistent and needs no control surface.
function NegotiatorProfile({ agent, runtimeOptions, runtime, onChangeRuntime }) {
  return (
    <div style={{ display:"grid", gap:16 }}>
      {/* Pick the runtime first, then dress it. Which one carries your
          negotiator is the decision on this page; the face and the name are
          how it shows up once that's settled, so they follow it rather than
          lead it. */}
      <div style={{ display:"grid", gap:7 }}>
        <NegotiatorSelect
          options={runtimeOptions}
          value={runtime}
          onChange={onChangeRuntime}
        />
        <span style={{
          fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
        }}>index takes over if it's unavailable.</span>
      </div>

      <div style={{ display:"grid", gap:2 }}>
        <RuleLabel size={13}>your agent</RuleLabel>
        <p style={{
          margin:"0 0 8px", maxWidth:560,
          fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
        }}>
          this is how your agent appears wherever it speaks for you, asking you
          a question, sending an update, negotiating with someone else's.
        </p>
        <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <MyAgentAvatar size={54}/>

          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:17, fontWeight:700, color:"#000",
          }}>{agent.name}</div>
        </div>
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
    // capture + preventDefault so the open dropdown takes the Escape before the
    // window-closing handler in primitives sees it
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
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
  const rel = (iso) => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
  };
  // An agent registered against your account is connected, whether or not it
  // has checked in lately. `lastSeenAt` is null on every agent the API has
  // handed back so far, and reading that as "detected" left every row shut:
  // only a connected row opens, so the permissions behind it were unreachable.
  // The heartbeat is a separate fact and says for itself when there isn't one.
  const active = a.status ? a.status === "active" : true;
  const owner = String((currentMe() || {}).name || "").trim().split(/\s+/)[0];
  return {
    id: a.id,
    name,
    live: true,
    initial: (name[0] || "a").toLowerCase(),
    tint: TINTS[h % TINTS.length],
    state: active ? "connected" : "detected",
    on: active,
    // the one agent the API says carries negotiations
    negotiates: !!a.handleNegotiations,
    connectedAs: a.description || (owner ? `${owner}'s ${name.toLowerCase()}` : name.toLowerCase()),
    heartbeat: a.lastSeenAt ? rel(a.lastSeenAt) : "",
    // What this agent is actually allowed to do, off the record rather than
    // off a demo id. Nightly indexing has no field behind it yet, so it starts
    // off rather than claiming something the API never said.
    perms: {
      updates: !!a.notifyOnOpportunity,
      brief: !!a.dailySummaryEnabled,
      indexing: false,
    },
  };
}

function Agents({ onClose }) {
  // Live-only: no demo runtimes. The list is populated by fetchRegistered (the
  // account's registered agents) and the local harness scan below.
  const [agents, setAgents] = useState([]);
  const [expanded, setExpanded] = useState(null);
  // Filled from the live agent list; "index" is the builtin negotiator fallback.
  const [perms, setPerms] = useState({});
  const [negotiator, setNegotiator] = useState("index");

  // Which local runtimes are already registered on the account: personal
  // agents matched by name (lowercased). Server-side system agents never map
  // to runtime rows — the Index row in the list is the local builtin, pinned
  // on, and it doubles as the negotiator fallback in the picker below.
  const [registered, setRegistered] = useState({});
  const noteRegistered = (a) => {
    const row = mapLiveAgent(a);
    setRegistered(r => ({ ...r, [row.name.toLowerCase()]: row }));
    setPerms(p => ({ ...p, [row.id]: p[row.id] || row.perms }));
  };
  const fetchRegistered = () => {
    if (!window.IndexApp || !window.IndexApp.isAuthed()) return Promise.resolve();
    const client = window.IndexApp.getClient();
    if (!client) return Promise.resolve();
    return client.agents.list()
      .then((res) => {
        const list = window.IndexApp.normalizeList(res, "agents")
          .filter(a => a.type !== "system");
        // Rebuild from scratch so agents deactivated or deleted elsewhere
        // (e.g. on the web) drop their stale state here.
        const next = {};
        const nextPerms = {};
        list.forEach((a) => {
          const row = mapLiveAgent(a);
          next[row.name.toLowerCase()] = row;
          nextPerms[row.id] = row.perms;
        });
        setRegistered(next);
        setPerms(p => ({ ...nextPerms, ...p }));
        const carries = list.find(a => a.handleNegotiations && a.status !== "inactive");
        setNegotiator(carries ? carries.id : "index");
      })
      .catch(() => {});
  };
  useEffect(() => { fetchRegistered(); }, []);

  // Real inventory: the Swift shell scans the login-shell PATH for known
  // agent CLIs (claude, codex, goose, …). Until the first scan answers, or
  // when there is no bridge (browser preview), the demo list stands in.
  const [detected, setDetected] = useState(null);
  const scan = () => (window.IndexApp && window.IndexApp.detectHarnesses)
    ? window.IndexApp.detectHarnesses().then((list) => {
        if (list) setDetected(list.map(h => ({
          id: `local-${h.id}`, name: h.label, path: h.path,
        })));
      })
    : Promise.resolve();
  useEffect(() => { scan(); }, []);

  // "check again" re-scans local binaries AND re-fetches registration status
  // from the API; the spin holds long enough to read.
  const [checking, setChecking] = useState(false);
  const checkTimer = useRef(null);
  useEffect(() => () => clearTimeout(checkTimer.current), []);
  const check = () => {
    if (checking) return;
    setChecking(true);
    Promise.all([scan(), fetchRegistered()]).then(() => {
      checkTimer.current = setTimeout(() => setChecking(false), 700);
    });
  };

  // Activating a detected runtime registers it as a personal agent (MCP
  // register_agent) and mints it an api key; deactivating deletes the agent
  // (revoking its keys) and tears down any local plugin wiring.
  const busy = useRef(new Set());
  const toggleOn = (id) => {
    // browser preview: the demo rows keep their local flip
    if (detected === null) {
      setAgents(list => list.map(a => {
        if (a.id !== id) return a;
        const on = !a.on;
        if (!on && negotiator === id) setNegotiator("index");
        return { ...a, on };
      }));
      return;
    }
    if (!window.IndexApp || !window.IndexApp.isAuthed()) {
      alert("sign in first — registering an agent needs your account.");
      return;
    }
    const row = rows.find(a => a.id === id);
    if (!row) return;
    if (busy.current.has(id)) return;
    busy.current.add(id);
    const done = () => busy.current.delete(id);
    if (row.live) {
      // Toggling off deregisters: delete the agent server-side (which also
      // revokes its api keys) and, for hermes, uninstall the local plugin.
      window.IndexApp.getClient().agents.remove(row.id)
        .then(() => {
          setRegistered(r => {
            const next = { ...r };
            delete next[row.name.toLowerCase()];
            return next;
          });
          if (negotiator === row.id) setNegotiator("index");
          if (row.name.toLowerCase() === "hermes") {
            return window.IndexApp.teardownHermes().then((r) => {
              if (!(r && r.ok)) alert(`deregistered, but plugin removal failed: ${(r && r.error) || "unknown error"}`);
            });
          }
        })
        .catch((err) => alert(`could not deregister ${row.name}: ${err && err.message || err}`))
        .then(done, done);
      return;
    }
    window.IndexApp.mcpCall("register_agent", {
        name: row.name,
        description: `${row.name} on this mac (${row.path})`,
      })
      .then((res) => {
        // tool results arrive wrapped: { success, data: { message, agent } }
        const payload = (res && res.data) || res || {};
        if (res && res.success === false) throw new Error(res.error || "registration failed");
        if (!payload.agent) throw new Error("no agent in response");
        noteRegistered(payload.agent);
        return payload.agent;
      })
      .then((agent) =>
        // Mint an api key for the agent so the local runtime can act as it.
        window.IndexApp.getClient().agents.createToken(agent.id).then((res) => {
          const key = res && res.token && res.token.key;
          if (!key) throw new Error("no key in bootstrap response");
          if (row.id === "local-hermes") {
            // Hand the key to the Swift shell: it writes ~/.hermes/.env and
            // installs/enables the indexnetwork/hermes-plugin.
            return window.IndexApp.setupHermes(key).then((r) => {
              if (r && r.ok) alert("Hermes agent registered and its Index plugin is configured.");
              else alert(`Hermes agent registered, but plugin setup failed: ${(r && r.error) || "unknown error"}`);
            });
          }
          alert(`${row.name} registered. its api key (shown once):\n\n${key}`);
        })
      )
      .catch((err) => alert(`could not activate ${row.name}: ${err && err.message || err}`))
      .then(done, done);
  };

  const togglePerm = (agentId, permId) => setPerms(p => ({
    ...p,
    [agentId]: { ...p[agentId], [permId]: !(p[agentId] || {})[permId] },
  }));

  // Your negotiator's picture is derived from your account id (see myAgent in
  // primitives), so it is the same everywhere with nothing to configure here.
  const myNegotiator = myAgent();

  // Rows are the builtin Index runtime plus the detected local runtimes.
  // Index leads the list: always on, not switchable — it is the system
  // default that carries negotiations when nothing else does. A local
  // runtime already registered on the account (matched by name) wears its
  // live record: connected state, real id, on = active. Everything else is
  // detected and off until the switch registers it.
  const indexRow = {
    id:"index", name:"Index", state:"system default", on:true, builtin:true,
  };
  const rows = [indexRow, ...(detected === null ? agents : detected.map(d => {
    const live = registered[d.name.toLowerCase()];
    return live
      ? { ...live, path: d.path }
      : { id: d.id, name: d.name, state: "detected", on: false,
          connectedAs: "", heartbeat: "", path: d.path };
  }))];

  // Only runtimes you've switched on can speak for you, so only those are
  // offered. Index is always available as the fallback.
  const negotiatorOptions = [
    { id:"index", label:"Index · system default" },
    ...rows.filter(a => a.on && !a.builtin)
      .map(a => ({ id:a.id, label:`${a.name} · on this mac` })),
  ];

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      {/* Takes the screen it is given: tall enough that the runtimes and the
          negotiator both sit above the fold on a laptop, and it still gives way
          to the desktop margin on a short one. */}
      <div style={{
        width:860, maxWidth:"100%",
        height:"min(880px, calc(100vh - 96px))",
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
                fontFamily:"var(--mac-mono)", fontSize:22, fontWeight:700, color:"#000",
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
            <RuleLabel size={13}>runtimes</RuleLabel>
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
              {rows.map((a, i) => (
                <AgentRow
                  key={a.id}
                  last={i === rows.length - 1}
                  agent={a}
                  expanded={expanded === a.id}
                  onToggleExpand={(id) => setExpanded(e => e === id ? null : id)}
                  onToggleOn={toggleOn}
                  perms={perms[a.id] || {}}
                  onTogglePerm={togglePerm}
                />
              ))}
              {/* index is always here, so "empty" means no local runtimes */}
              {rows.length === 1 && (
                <div style={{
                  padding:"12px", borderTop:"1px solid #000",
                  fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)",
                }}>no other agent runtimes found on this mac</div>
              )}
            </div>

            <SectionRule size={13}>negotiator agent</SectionRule>
            {/* no measure cap on this one: it is one sentence and it should
                stay one line, so it gets the full width of the pane */}
            <p style={{
              margin:"8px 0 12px",
              fontFamily:"var(--mac-sans)", fontSize:12, lineHeight:1.5, color:"var(--ink-2)",
            }}>
              one agent speaks for you in the network. pick which runtime carries it.
            </p>

            <NegotiatorProfile
              agent={myNegotiator}
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
