// Intents — Workbench shelf of saved searches. This is the app's hub:
// brand promise, active signals, and the entry point for a new signal.

/* ---------- account shelf ---------- */

// Your photo if you've set one, otherwise a solid accent tile with lowercase
// initials — deliberately not the photo Avatar used on the radar, so "you"
// reads differently from "them".
function InitialsTile({ name, size = 46, photo }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        style={{
          flex:"0 0 auto", width:size, height:size,
          objectFit:"cover", display:"block",
          border:"1px solid #000",
          // matches Avatar and the settings preview
          filter:"grayscale(1) contrast(1.05)",
        }}/>
    );
  }
  const initials = (name || "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join("").toLowerCase();
  return (
    <span style={{
      flex:"0 0 auto", width:size, height:size,
      border:"1px solid #000", background:"#FF8A00",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"var(--mac-mono)", fontSize: size * 0.4,
      fontWeight:700, color:"#000", letterSpacing:0.5,
    }}>{initials}</span>
  );
}

// The communities you belong to. Intentionally quiet — no border or shadow, so
// it reads as a shelf item rather than competing with the account row below it.
// The glyph occupies the same 34px block as the account tile and the label uses
// the same size and weight, so the two rows line up even though their fills
// differ on purpose.
function NetworksRow({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display:"flex", alignItems:"center", gap:12, width:"100%",
        padding:"5px 13px", cursor:"pointer", textAlign:"left",
        border:"none", background:"#F2F0EC",
      }}>
      <span style={{
        flex:"0 0 auto", width:34, height:34,
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center", gap:5,
      }}>
        {[0, 1].map(r => (
          <span key={r} style={{ display:"flex", gap:4, alignItems:"center" }}>
            <span style={{ width:4, height:4, background:"#000" }}/>
            <span style={{ width:13, height:4, background:"#000" }}/>
          </span>
        ))}
      </span>
      <span style={{
        flex:1, minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
      }}>networks ({count})</span>
    </button>
  );
}

// The agent runtimes on this Mac. Same quiet shelf treatment as the networks
// row above it: both are destinations, not settings. The glyph is a head with
// an antenna, which reads as "an agent" at a glance. The chip it replaced read
// as hardware, and nothing about a chip says something is acting for you.
function AgentsRow({ count, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display:"flex", alignItems:"center", gap:12, width:"100%",
        padding:"5px 13px", cursor:"pointer", textAlign:"left",
        border:"none", background:"#F2F0EC",
      }}>
      <span style={{
        flex:"0 0 auto", width:34, height:34,
        display:"flex", flexDirection:"column",
        alignItems:"center", justifyContent:"center",
      }}>
        {/* antenna: tip, then stem */}
        <span style={{ width:4, height:4, background:"#000" }}/>
        <span style={{ width:2, height:3, background:"#000" }}/>
        {/* head, with two eyes */}
        <span style={{
          width:22, height:15, border:"2px solid #000",
          display:"flex", alignItems:"center", justifyContent:"center", gap:5,
        }}>
          <span style={{ width:3, height:3, background:"#000" }}/>
          <span style={{ width:3, height:3, background:"#000" }}/>
        </span>
      </span>
      <span style={{
        flex:1, minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
      }}>agents ({count})</span>
    </button>
  );
}

// The account row. Click it for the account menu — closes on outside click or
// Escape, like a real menubar menu. Opens upward: it's the last thing in the
// column, so there's headroom above and none below.
function UserMenu({ me, onSelect }) {
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

  // "your network" moved out to its own shelf row above.
  const ITEMS = [
    { id: "profile",  label: "your profile" },
    { id: "settings", label: "preferences" },
    { id: "signout",  label: "sign out", danger: true },
  ];

  const pick = (item) => { setOpen(false); onSelect && onSelect(item.id); };
  const rowHover = (on) => (e) => {
    e.currentTarget.style.background = on ? "#000" : "transparent";
    e.currentTarget.style.color = on ? "#FF8A00" : "#000";
  };

  return (
    <div ref={wrapRef} style={{ position:"relative", width:"100%" }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          display:"flex", alignItems:"center", gap:11, width:"100%",
          padding:"7px 11px", textAlign:"left", cursor:"pointer",
          border:"1px solid #000", background: open ? "#F2EFE6" : "#fff",
        }}>
        <InitialsTile name={me.name} size={34} photo={me.photo}/>
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{
            display:"block",
            fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
          }}>{me.name}</span>
        </span>
        <span style={{
          flex:"0 0 auto",
          fontFamily:"var(--mac-mono)", fontSize:12, color:"#000",
          transform: open ? "rotate(180deg)" : "none",
        }}>▲</span>
      </button>

      {open && (
        <div role="menu" className="fade-up" style={{
          position:"absolute", bottom:"calc(100% + 6px)", left:0, zIndex:40,
          minWidth:200, width:"100%", background:"#fff",
          border:"1px solid #000", boxShadow:"3px 3px 0 rgba(0,0,0,0.22)",
          padding:"4px 0",
        }}>
          {ITEMS.map(item => (
            <button
              key={item.id}
              role="menuitem"
              onClick={() => pick(item)}
              onMouseEnter={rowHover(true)}
              onMouseLeave={rowHover(false)}
              style={{
                display:"block", width:"100%", textAlign:"left",
                padding:"6px 12px", border:"none", background:"transparent",
                fontFamily:"var(--mac-sans)", fontSize:12, cursor:"pointer",
                color: item.danger ? "var(--ink-warn)" : "#000",
                borderTop: item.danger ? "1px solid #000" : "none",
                marginTop: item.danger ? 4 : 0,
              }}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Intents({ onPickExisting, onNew, onBack, onSignOut, fresh = false }) {
  const env = useIndexEnv();
  const demo = window.INDEX_DATA;
  // ME/NETWORKS/AGENTS prefer live data; AGENTS has no live snapshot yet.
  const ME = env.me || demo.ME;
  const NETWORKS = env.networks || demo.NETWORKS;
  const AGENTS = demo.AGENTS;
  const joinedCount = (NETWORKS || []).filter(n => n.joined !== false).length;
  const agentCount  = (AGENTS || []).filter(a => a.state === "connected").length;

  // A just-onboarded user has no signals yet — the hub opens empty.
  const [signals, setSignals] = useState(() => fresh ? [] : (env.data.INTENTS || []));
  useEffect(() => {
    setSignals(fresh ? [] : (env.data.INTENTS || []));
  }, [env.data, fresh]);

  const [hovered, setHovered] = useState(null);
  // Which settings pane the account menu asked for (null = settings closed).
  const [settingsTab, setSettingsTab] = useState(null);
  const [showNetworks, setShowNetworks] = useState(false);
  const [showAgents, setShowAgents] = useState(false);

  const onAccountSelect = (id) => {
    if (id === "profile")  setSettingsTab("profile");
    if (id === "settings") setSettingsTab("notify");
    if (id === "signout")  onSignOut && onSignOut();
  };

  // Both take over the whole surface — they're screens, not sheets.
  if (settingsTab) {
    return <Settings initialTab={settingsTab} onClose={() => setSettingsTab(null)}/>;
  }
  if (showNetworks) {
    return <Networks onClose={() => setShowNetworks(false)}/>;
  }
  if (showAgents) {
    return <Agents onClose={() => setShowAgents(false)}/>;
  }

  const visible  = signals.filter(i => i.status !== "archived");
  const active   = visible.filter(i => i.status === "active");
  const idle     = visible.filter(i => i.status === "idle");
  const paused   = visible.filter(i => i.status === "paused");
  const ordered  = [...active, ...idle, ...paused];

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      padding:"32px 40px", overflow:"auto",
    }}>
      <div style={{
        width: 980,
        maxWidth:"100%",
        maxHeight: "calc(100vh - 64px)",
      }}>
        <MacWindow title="index · your signals" onClose={onBack} style={{ maxHeight: "calc(100vh - 64px)", minHeight: "min(560px, calc(100vh - 64px))" }}>
          <div style={{
            padding:"22px 28px 20px",
            display:"grid",
            gridTemplateColumns:"minmax(260px, 0.85fr) minmax(360px, 1.15fr)",
            gap:24,
            flex:1,
            minHeight:0,
          }}>
            <div style={{
              minWidth:0,
              display:"flex",
              flexDirection:"column",
              gap:18,
              paddingRight:22,
              borderRight:"2px solid #000",
            }}>
              {/* takes the slack so the shelf below is pinned to the floor */}
              <div style={{
                flex:"1 1 auto", minHeight:0,
                display:"flex", flexDirection:"column", justifyContent:"center",
              }}>
                {onBack && (
                  <button onClick={onBack} style={{
                    fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                    background:"transparent", border:"none", padding:0, cursor:"pointer",
                    marginBottom:16,
                  }}>← back</button>
                )}
                <h1 style={{
                  fontFamily:"var(--amiga-mono)", fontWeight:500,
                  fontSize:34, lineHeight:1.05, letterSpacing:-0.6,
                  margin:0, color:"#000",
                }}>
                  meet the person index is{" "}
                  <span style={{
                    background:"#FF8A00", color:"#000",
                    padding:"0 6px", display:"inline-block",
                    border:"1px solid #000",
                    boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 2px 2px 0 rgba(0,0,0,0.22)",
                    fontWeight:700,
                  }}>already</span>{" "}
                  looking for.
                </h1>
                <p style={{
                  marginTop:12, color:"#000",
                  fontSize:13, lineHeight:1.5, maxWidth:540,
                  fontFamily:"var(--mac-sans)",
                }}>
                  tell index what you're after. it works quietly in the
                  background and tells you when there's an alignment.
                </p>
              </div>

              {/* sidebar footer — sits on the pane's floor, not under the copy */}
              <div style={{ display:"grid", gap:9 }}>
                <NetworksRow count={joinedCount} onClick={() => setShowNetworks(true)}/>
                <AgentsRow count={agentCount} onClick={() => setShowAgents(true)}/>
                <UserMenu me={ME} onSelect={onAccountSelect}/>
              </div>
            </div>

            <div style={{
              minWidth:0,
              minHeight:0,
              display:"flex",
              flexDirection:"column",
            }}>
              <RuleLabel>your signals</RuleLabel>

              <p style={{
                margin:"6px 0 14px",
                fontFamily:"var(--mac-sans)",
                fontSize:13,
                lineHeight:1.5,
                color:"var(--ink-2)",
                maxWidth:430,
              }}>
                each signal stays active in the background. index keeps
                looking until the right people surface, or you close it.
              </p>

              {/* sized to its content when the list is short (window hugs it),
                  but flex-shrinks and scrolls once there are too many to fit */}
              <div className="mac-scroll" style={{
                flex:"1 1 auto", minHeight:0, overflowY:"auto",
                display:"flex", flexDirection:"column", gap:8,
                paddingRight: 6,
              }}>
                {/* No empty state: the blurb above already says what a signal
                    does, and an empty list whose only row is "start a new
                    signal" doesn't need a second box to explain itself. */}
                {ordered.map(intent => (
                  <IntentRow
                    key={intent.id}
                    intent={intent}
                    hovered={hovered === intent.id}
                    onHover={() => setHovered(intent.id)}
                    onLeave={() => {}}
                    onPick={() => onPickExisting(intent)}
                  />
                ))}

                {/* New intent — always at the bottom of the list */}
                <NewIntentRow onClick={onNew}/>
              </div>
            </div>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

/* ---------- Single intent row ---------- */
function IntentRow({ intent, hovered, onHover, onLeave, onPick }) {
  const isPaused = intent.status === "paused";
  const isActive = intent.status === "active";
  const hasQ = intent.questions > 0;
  // Display label: active signals read as "running" in the status line.
  const statusLabel = isActive ? "running" : intent.status;

  return (
    <button
      onClick={onPick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        textAlign:"left",
        padding: "0 16px",
        height: 72,
        boxSizing: "border-box",
        border:"1px solid #000",
        background: hovered ? "#FFF6E8" : "#FFFFFF",
        boxShadow: hovered
          ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 rgba(0,0,0,0.2)"
          : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3), 1px 1px 0 rgba(0,0,0,0.2)",
        display:"flex", alignItems:"center", gap: 14,
        cursor:"pointer",
        opacity: isPaused ? 0.62 : 1,
        fontFamily: "var(--mac-sans)",
      }}>
      {/* title + tiny status */}
      <div style={{ flex:1, minWidth:0, display:"grid", gap:4 }}>
        <div style={{
          fontFamily:"var(--amiga-title)", fontSize: 15.5,
          color:"#000", fontWeight: 500, letterSpacing:-0.1,
          lineHeight: 1.2,
          whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
        }}>
          {intent.title}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          {isActive && <LiveDot size={6}/>}
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
            letterSpacing:1, textTransform:"uppercase",
          }}>{statusLabel}</span>
        </div>
      </div>

      {/* questions — the hero */}
      <QCount n={intent.questions} muted={!hasQ}/>
    </button>
  );
}

/* ---------- Inbound-questions hero count ---------- */
function QCount({ n, muted }) {
  if (muted) {
    return null;
  }
  return (
    <span style={{
      display:"flex", alignItems:"center", gap:8,
      padding:"6px 12px",
      border:"1px solid #000",
      background:"#FF8A00",
      boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500",
      flex:"0 0 auto",
    }}>
      <span style={{
        fontFamily:"var(--mac-sans)", fontSize:22, fontWeight:700,
        lineHeight:1, color:"#000", letterSpacing:-0.5,
      }}>{n}</span>
    </span>
  );
}

/* ---------- "new intent" row — bottom of the shelf ---------- */
function NewIntentRow({ onClick }) {
  const [down, setDown] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        textAlign:"left",
        padding:"11px 16px",
        border:"2px solid #000",
        background: down ? "#000" : "#FF8A00",
        color: down ? "#FF8A00" : "#000",
        cursor:"pointer",
        display:"flex", alignItems:"center", gap: 14,
        boxShadow: down
          ? "none"
          : "inset 1px 1px 0 #FFD7A0, inset -2px -2px 0 #8A4500, 3px 3px 0 rgba(0,0,0,0.22)",
        marginTop: 8,
      }}>
      <span style={{
        width: 24, height: 24,
        display:"grid", placeItems:"center",
        background: down ? "#FF8A00" : "#fff",
        color: "#000",
        border:"1px solid #000",
        boxShadow:"inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
        fontFamily:"var(--mac-mono)", fontSize:16, fontWeight:700,
        flex:"0 0 auto",
      }}>+</span>
      <div style={{ display:"grid", gap:3 }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize: 15, fontWeight: 700,
          letterSpacing:-0.2,
        }}>start a new signal</div>
      </div>
    </button>
  );
}

window.Intents = Intents;
