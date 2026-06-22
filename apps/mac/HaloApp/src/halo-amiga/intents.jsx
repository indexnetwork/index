// Intents — Workbench shelf of saved searches. This is the app's hub:
// brand promise, active signals, and the entry point for a new signal.

function Intents({ onPickExisting, onNew, onBack }) {
  const { INTENTS } = window.HALO_DATA;
  const [hovered, setHovered] = useState(null);

  const active   = INTENTS.filter(i => i.status === "active");
  const idle     = INTENTS.filter(i => i.status === "idle");
  const paused   = INTENTS.filter(i => i.status === "paused");
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
        <MacWindow title="index · your signals" onClose={onBack} style={{ maxHeight: "calc(100vh - 64px)", minHeight: 0 }}>
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
              justifyContent:"center",
              gap:18,
              paddingRight:22,
              borderRight:"2px solid #000",
            }}>
              <div>
                {onBack && (
                  <button onClick={onBack} style={{
                    fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                    background:"transparent", border:"none", padding:0, cursor:"pointer",
                    marginBottom:16,
                  }}>← back</button>
                )}
                <h1 style={{
                  fontFamily:"var(--amiga-title)", fontWeight:400,
                  fontSize:34, lineHeight:1.05, letterSpacing:-0.6,
                  margin:0, color:"#000",
                }}>
                  meet the person your agent is{" "}
                  <span style={{
                    background:"#FF8A00", color:"#000",
                    padding:"0 6px", display:"inline-block",
                    border:"1px solid #000",
                    boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 2px 2px 0 #000",
                    fontWeight:700,
                  }}>already</span>{" "}
                  looking for.
                </h1>
                <p style={{
                  marginTop:12, color:"#000",
                  fontSize:13.5, lineHeight:1.5, maxWidth:540,
                  fontFamily:"var(--mac-sans)",
                }}>
                  tell index what you're after. agents negotiate quietly in the
                  background. and let you know if there's an alignment.
                </p>
              </div>
            </div>

            <div style={{
              minWidth:0,
              minHeight:0,
              display:"flex",
              flexDirection:"column",
            }}>
              <RuleLabel>— your signals</RuleLabel>

              <p style={{
                margin:"6px 0 14px",
                fontFamily:"var(--mac-sans)",
                fontSize:13,
                lineHeight:1.5,
                color:"#444",
                maxWidth:430,
              }}>
                each signal stays active in the background. your agent keeps
                looking until the right people surface, or you close it.
              </p>

              {/* sized to its content when the list is short (window hugs it),
                  but flex-shrinks and scrolls once there are too many to fit */}
              <div className="mac-scroll" style={{
                flex:"1 1 auto", minHeight:0, overflowY:"auto",
                display:"flex", flexDirection:"column", gap:8,
                paddingRight: 6,
              }}>
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
          ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 #000"
          : "inset 1px 1px 0 #fff, inset -1px -1px 0 #888, 1px 1px 0 #000",
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
            fontFamily:"var(--mac-mono)", fontSize:9.5, color:"#555",
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
        padding:"18px 18px",
        border:"2px solid #000",
        background: down ? "#000" : "#FF8A00",
        color: down ? "#FF8A00" : "#000",
        cursor:"pointer",
        display:"flex", alignItems:"center", gap: 14,
        boxShadow: down
          ? "none"
          : "inset 1px 1px 0 #FFD7A0, inset -2px -2px 0 #8A4500, 3px 3px 0 #000",
        marginTop: 8,
      }}>
      <span style={{
        width: 30, height: 30,
        display:"grid", placeItems:"center",
        background: down ? "#FF8A00" : "#fff",
        color: "#000",
        border:"1px solid #000",
        boxShadow:"inset 1px 1px 0 #fff, inset -1px -1px 0 #888",
        fontFamily:"var(--mac-mono)", fontSize:20, fontWeight:700,
        flex:"0 0 auto",
      }}>+</span>
      <div style={{ display:"grid", gap:3 }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize: 17, fontWeight: 700,
          letterSpacing:-0.2,
        }}>start a new signal</div>
      </div>
    </button>
  );
}

window.Intents = Intents;
