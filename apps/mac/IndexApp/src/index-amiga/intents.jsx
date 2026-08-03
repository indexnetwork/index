// Intents, Workbench shelf of saved searches. This is the app's hub:
// brand promise ("find your others"), active signals, and the entry point for
// a new signal.

/* How tall the signals shelf is allowed to get. Six rows, then it scrolls.
   IntentRow's own height and the shelf's gap live here so the cap stays
   correct if either changes; a hardcoded pixel maxHeight would quietly start
   cutting a row in half. */
const SHELF_ROW_H = 72;
const SHELF_ROW_GAP = 8;
const SHELF_VISIBLE_ROWS = 6;

/* ---------- account shelf ---------- */

// Your photo if you've set one, otherwise a solid accent tile with lowercase
// initials, deliberately not the photo Avatar used on the radar, so "you"
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

// The communities you belong to. Intentionally quiet, no border or shadow, so
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

// The agents destination. Same quiet shelf treatment as the networks row above
// it: both are destinations, not settings, so both get a plain glyph. Your
// negotiator's picture belongs where the agent is speaking, not on a row whose
// job is "take me to the agents screen", where next to the networks mark it
// read as a stray photo in an icon column.
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
        display:"grid", placeItems:"center",
      }}>
        <AgentGlyph size={26}/>
      </span>
      <span style={{
        flex:1, minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
      }}>agents ({count})</span>
    </button>
  );
}

// The account row. Click it for the account menu, closes on outside click or
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
    // capture + preventDefault so this menu takes the Escape before the
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

  // "your network" moved out to its own shelf row above.
  const ITEMS = [
    { id: "profile",  label: "your profile" },
    { id: "settings", label: "notifications" },
    { id: "history",  label: "negotiation history" },
    { id: "signout",  label: "sign out", danger: true },
  ];

  const pick = (item) => { setOpen(false); onSelect && onSelect(item.id); };
  // Destructive rows keep the app's warn treatment on hover, the same one the
  // archive gadget uses: red stays red and the row washes pink. Inverting them
  // to black-and-orange like the ordinary rows dropped the one colour that says
  // this one is different, at the exact moment the pointer is on it.
  const rowHover = (on, danger) => (e) => {
    e.currentTarget.style.background = on ? (danger ? "#FFF3F3" : "#000") : "transparent";
    e.currentTarget.style.color = danger ? "var(--ink-warn)" : (on ? "#FF8A00" : "#000");
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
              onMouseEnter={rowHover(true, item.danger)}
              onMouseLeave={rowHover(false, item.danger)}
              style={{
                display:"block", width:"100%", textAlign:"left",
                padding:"6px 12px", border:"none", background:"transparent",
                fontFamily:"var(--mac-sans)", fontSize:12, cursor:"pointer",
                color: item.danger ? "var(--ink-warn)" : "#000",
                fontWeight: item.danger ? 600 : 400,
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

  // A just-onboarded user has no signals yet, the hub opens empty.
  const [signals, setSignals] = useState(() => fresh ? [] : (env.data.INTENTS || []));
  useEffect(() => {
    setSignals(fresh ? [] : (env.data.INTENTS || []));
  }, [env.data, fresh]);

  const [hovered, setHovered] = useState(null);
  // Which settings pane the account menu asked for (null = settings closed).
  const [settingsTab, setSettingsTab] = useState(null);
  const [showNetworks, setShowNetworks] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Width the shelf's scrollbar takes when it appears, so the pinned
  // new-signal row below can line up with the rows inside. Measured rather
  // than hardcoded to 16px, it's zero whenever the list fits.
  const shelfRef = useRef(null);
  const [shelfGutter, setShelfGutter] = useState(0);
  useEffect(() => {
    const el = shelfRef.current;
    if (!el) { setShelfGutter(0); return; }
    const measure = () => setShelfGutter(el.offsetWidth - el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [signals.length, settingsTab, showNetworks, showAgents]);

  const onAccountSelect = (id) => {
    if (id === "profile")  setSettingsTab("profile");
    if (id === "history")  setShowHistory(true);
    if (id === "settings") setSettingsTab("notify");
    if (id === "signout")  onSignOut && onSignOut();
  };

  // Both take over the whole surface, they're screens, not sheets.
  if (settingsTab) {
    return <Settings initialTab={settingsTab} onClose={() => setSettingsTab(null)}/>;
  }
  if (showNetworks) {
    return <Networks onClose={() => setShowNetworks(false)}/>;
  }
  if (showAgents) {
    return <Agents onClose={() => setShowAgents(false)}/>;
  }
  if (showHistory) {
    return <NegotiationHistory onClose={() => setShowHistory(false)}/>;
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
      // an explicit track: the implicit `auto` one takes the 980px wrapper as
      // its floor, so `maxWidth:100%` below resolves against 980 rather than
      // against the room actually available and the window overhangs the desktop
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{
        width: 980,
        maxWidth:"100%",
        minWidth: 0,
        maxHeight: "calc(100vh - 112px)",
      }}>
        {/* the shelf inside already says "your signals"; the title bar only has
            to say which app the window belongs to */}
        <MacWindow title="index" onClose={onBack} style={{ maxHeight: "calc(100vh - 112px)", minHeight: "min(560px, calc(100vh - 112px))" }}>
          <div style={{
            padding:"22px 28px 20px",
            display:"grid",
            // fluid, not px floors: 260+360+gap+padding is wider than the
            // window once it's narrow, and the tracks would keep their floor
            // and push the signal list out through the right-hand frame
            gridTemplateColumns:"minmax(0, 0.85fr) minmax(0, 1.15fr)",
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
                  fontFamily:"var(--amiga-mono)", fontWeight:700,
                  fontSize:34, lineHeight:1.05, letterSpacing:-0.6,
                  margin:0, color:"#000",
                }}>
                  find your others.
                </h1>
                <p style={{
                  marginTop:12, color:"#000",
                  fontSize:13, lineHeight:1.5, maxWidth:540,
                  fontFamily:"var(--mac-sans)",
                }}>
                  start a signal. your agent takes it to other agents. when both
                  sides want it, you get the intro.
                </p>
              </div>

              {/* sidebar footer, sits on the pane's floor, not under the copy */}
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
              <div style={{ height:8 }}/>

              {/* Sized to its content when the list is short (so the new-signal
                  row sits right under the last one), and capped at six rows
                  once it is long: past that the shelf reads as a backlog rather
                  than the set of things you are running, and "start a new
                  signal" drifts further down the screen. The rest scroll. */}
              <div ref={shelfRef} className="mac-scroll" style={{
                flex:"0 1 auto", minHeight:0, overflowY:"auto",
                maxHeight: SHELF_VISIBLE_ROWS * SHELF_ROW_H
                         + (SHELF_VISIBLE_ROWS - 1) * SHELF_ROW_GAP,
                display:"flex", flexDirection:"column", gap: SHELF_ROW_GAP,
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
              </div>

              {/* Starting a signal is what this screen is for, so it sits
                  outside the shelf, a long list scrolls behind it rather than
                  pushing it out of reach. The right padding matches the rows
                  above, which sit clear of the scrollbar when one is showing. */}
              <div style={{
                flex:"0 0 auto", paddingTop:8, paddingRight: 6 + shelfGutter,
                // flex, so the row stretches the way it did as a child of the
                // shelf, a bare <button> shrinks to fit its label
                display:"flex", flexDirection:"column",
              }}>
                <NewIntentRow onClick={onNew}/>
              </div>
            </div>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

/* A signal reads as what it is after, not as a sentence about wanting it. The
   summary that comes back from the API is written as prose ("Receive feedback
   on a launch video for an AI product from designers, founders, ..."), so the
   shelf drops the opening verb, lowercases it, and cuts it at a word so no row
   ends mid-word. This is a display fix. Titles that arrive already shaped, and
   short enough to sit whole in a row, pass through untouched. */
const TITLE_MAX = 45;
const TITLE_LEAD = /^(receive|explore|find|discover|connect with|connect to|connect|meet|seeking|seek|looking for|look for|get)\s+/;

function signalTitle(raw) {
  const text = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ").replace(TITLE_LEAD, "");
  if (!text) return "untitled signal";
  if (text.length <= TITLE_MAX) return text;
  const head = text.slice(0, TITLE_MAX + 1);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > 12 ? head.slice(0, lastSpace) : text.slice(0, TITLE_MAX);
  return cut.replace(/[\s,;:.·/+-]+$/, "") + "…";
}

/* What the signal is doing, in its own words: scanning, mid-negotiation with
   another agent, resolved, or ended. "running" said the process was alive
   without saying what it was doing with the time. */
function signalStatus(intent) {
  if (intent.status === "archived") return "closed";
  if (intent.status === "paused") return "paused";
  if (intent.matches > 0) return "matched";
  if ((intent.pipeline || {}).negotiating > 0) return "negotiating";
  return "live";
}

/* ---------- Single intent row ---------- */
function IntentRow({ intent, hovered, onHover, onLeave, onPick }) {
  const isPaused = intent.status === "paused";
  // Consolidated count: pending questions + awaiting opportunities (same
  // number as the Hermes and web dashboards). Demo data carries only
  // `questions`, hence the fallback.
  const pending = intent.pending ?? intent.questions ?? 0;
  const hasQ = pending > 0;
  const statusLabel = signalStatus(intent);
  // the blink is the signal working. only the states that are actually running
  // get it, so a shelf of closed and matched rows stays still
  const running = statusLabel === "live" || statusLabel === "negotiating";

  return (
    <button
      onClick={onPick}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        textAlign:"left",
        padding: "0 16px",
        height: SHELF_ROW_H,
        // the shelf is a column flex container, so without this the rows
        // shrink to share whatever height is left instead of the shelf
        // scrolling, squashing every signal and pushing the question count
        // out through the row's own border
        flex: "0 0 auto",
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
        }} title={intent.title}>
          {signalTitle(intent.title)}
        </div>
        <span style={{
          display:"flex", alignItems:"center", gap:6,
          fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
          letterSpacing:1,
        }}>
          {running && <LiveDot size={6}/>}
          {statusLabel}
        </span>
      </div>

      {/* pending questions + awaiting opportunities, the hero */}
      <QCount n={pending} muted={!hasQ}/>
    </button>
  );
}

/* ---------- Pending hero count ---------- */
// One consolidated, unlabeled number: pending questions + awaiting
// opportunities, matching the Hermes and web dashboards. The tooltip carries
// the explanation the label used to.
function QCount({ n, muted }) {
  if (muted) {
    return null;
  }
  return (
    <span
      title={`${n} waiting on you — pending questions and opportunities`}
      style={{
        display:"flex", alignItems:"baseline", justifyContent:"center",
        padding:"3px 8px",
        border:"1px solid #000",
        background:"#FF8A00",
        boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500",
        flex:"0 0 auto",
      }}>
      <span style={{
        fontFamily:"var(--mac-sans)", fontSize:14, fontWeight:700,
        lineHeight:1, color:"#000", letterSpacing:-0.3,
      }}>{n}</span>
    </span>
  );
}

/* ---------- "new intent" row: bottom of the shelf ---------- */
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
        flex: "0 0 auto",
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
        }}>new signal</div>
      </div>
    </button>
  );
}

window.Intents = Intents;
