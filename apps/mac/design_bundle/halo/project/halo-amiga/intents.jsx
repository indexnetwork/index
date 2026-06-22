// Intents — Workbench shelf of saved searches. Sits between landing and
// onboarding. User can resume an existing intent or open a fresh one
// (which routes into the calibrating flow).

function Intents({ onPickExisting, onNew, onBack }) {
  const { INTENTS } = window.HALO_DATA;
  const [hovered, setHovered] = useState(null);

  const active   = INTENTS.filter(i => i.status === "active");
  const idle     = INTENTS.filter(i => i.status === "idle");
  const paused   = INTENTS.filter(i => i.status === "paused");
  const ordered  = [...active, ...idle, ...paused];

  const totalRunning = active.length + idle.length;
  const totalMatches = INTENTS.reduce((a, i) => a + i.matches, 0);
  const totalQuestions = INTENTS.reduce((a, i) => a + (i.questions || 0), 0);

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      padding:"32px 40px", overflow:"auto",
    }}>
      <div style={{
        width: 940,
        display:"grid", gap:18,
        gridTemplateColumns:"1.45fr 1fr",
        height: "min(720px, calc(100vh - 80px))",
      }}>
        {/* LEFT — the shelf */}
        <MacWindow title="index · your signals" onClose={onBack}>
          <div style={{
            padding:"18px 24px 18px",
            display:"flex", flexDirection:"column", flex:1, minHeight:0,
          }}>
            {/* top row */}
            <div style={{
              display:"flex", alignItems:"center", gap:10, marginBottom:14,
            }}>
              <button onClick={onBack} style={{
                fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                background:"transparent", border:"none", padding:0, cursor:"pointer",
              }}>← back</button>
              <div style={{ flex:1 }}/>
              <LiveDot size={7}/>
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:10, color:"#000",
                letterSpacing:1.5, textTransform:"uppercase",
              }}>{totalRunning} running · {totalQuestions} questions</span>
            </div>

            <div style={{ marginBottom: 14 }}>
              <h2 style={{
                fontFamily:"var(--mac-sans)", fontWeight: 400,
                fontSize: 26, letterSpacing: -0.4,
                lineHeight: 1.1, margin: 0, color: "#000",
              }}>
                pick up where you left off,<br/>
                or start a new search.
              </h2>
              <p style={{
                marginTop: 8,
                fontFamily:"var(--mac-sans)", fontSize: 12.5,
                color:"#444", maxWidth: 480, lineHeight: 1.5,
              }}>
                each signal is an always-on search your agent runs in the
                background. it keeps looking until you close it.
              </p>
            </div>

            <RuleLabel>— your signals</RuleLabel>

            <div className="mac-scroll" style={{
              flex:1, minHeight:0, overflowY:"auto",
              display:"grid", gap:8,
              paddingRight: 6, paddingBottom: 12,
            }}>
              {ordered.map(intent => (
                <IntentRow
                  key={intent.id}
                  intent={intent}
                  hovered={hovered === intent.id}
                  onHover={() => setHovered(intent.id)}
                  onLeave={() => setHovered(null)}
                  onPick={() => onPickExisting(intent)}
                />
              ))}

              {/* New intent — always at the bottom of the list */}
              <NewIntentRow onClick={onNew}/>
            </div>

            <div style={{
              borderTop:"1px solid #000", paddingTop:10, marginTop: 6,
              boxShadow:"inset 0 1px 0 #fff",
            }}>
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:10, color:"#555",
                letterSpacing:0.5,
              }}>up to 6 signals at a time · idle ones expire after 30 days.</span>
            </div>
          </div>
        </MacWindow>

        {/* RIGHT — preview pane */}
        <MacWindow title={hovered ? "signal · preview" : "index · always on"}>
          <IntentSidePane
            intent={hovered ? ordered.find(i => i.id === hovered) : null}
            totals={{ running: totalRunning, paused: paused.length, matches: totalMatches, questions: totalQuestions }}
          />
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
          fontFamily:"var(--mac-sans)", fontSize: 15.5,
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
          }}>{intent.status} · {intent.matches} found</span>
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
    return (
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:10, color:"#888",
        letterSpacing:0.5, flex:"0 0 auto",
      }}>no questions</span>
    );
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
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:9.5, color:"#000",
        letterSpacing:1, textTransform:"uppercase", lineHeight:1.2,
      }}>question{n === 1 ? "" : "s"}<br/>from others</span>
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
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize: 10.5,
          color: down ? "#FFD7A0" : "#5A2E00", letterSpacing:0.4,
        }}>
          90 seconds · calibrate edges, off-limits, and operating mode
        </div>
      </div>
    </button>
  );
}

/* ---------- Right pane: idle summary or hovered intent detail ---------- */
function IntentSidePane({ intent, totals }) {
  if (!intent) return <IntentsOverview totals={totals}/>;
  return <IntentDetail intent={intent}/>;
}

function IntentsOverview({ totals }) {
  const { running, paused, matches, questions } = totals;
  const lines = [
    `${running} signal${running === 1 ? "" : "s"} running.`,
    `${paused} paused.`,
    `${matches} people surfaced across all of them.`,
    `${questions} question${questions === 1 ? "" : "s"} from others waiting on you.`,
  ];
  return (
    <div style={{
      padding:"22px 26px",
      display:"flex", flexDirection:"column", gap:14,
      flex:1, minHeight:0,
    }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color:"#000",
      }}>— index, idle</div>

      <div style={{
        border:"1px solid #000", background:"#fff",
        padding:"18px 18px",
        boxShadow:"inset 1px 1px 0 #888, inset -1px -1px 0 #fff",
      }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize: 19, lineHeight:1.35,
          color:"#000", letterSpacing:-0.2,
        }}>
          your agent's been busy.<br/>
          <span style={{ color:"#555" }}>resume a signal to see what it found, or open a new one.</span>
        </div>
      </div>

      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        fontFamily:"var(--mac-mono)", fontSize:12,
        color:"#000", lineHeight:1.7,
        display:"grid", gap:5, alignContent:"start",
      }}>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{ animationDelay:`${i*60}ms` }}>
            <span style={{ marginRight:6, color:"#FF8A00", fontWeight:700 }}>·</span>
            <span style={{ fontWeight: i === lines.length - 1 ? 700 : 400 }}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, color:"#555",
        letterSpacing:0.5,
      }}>hover a signal for details.</div>
    </div>
  );
}

function IntentDetail({ intent }) {
  const hasQ = intent.questions > 0;
  return (
    <div style={{
      padding:"22px 26px",
      display:"flex", flexDirection:"column", gap:16,
      flex:1, minHeight:0,
    }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color:"#000",
        display:"flex", alignItems:"center", gap:8,
      }}>
        {intent.status === "active" && <LiveDot size={6}/>}
        <span>— signal · {intent.status}</span>
      </div>

      <div className="fade-up">
        <h3 style={{
          fontFamily:"var(--mac-sans)", fontSize: 22, lineHeight:1.2,
          letterSpacing:-0.3, fontWeight: 500,
          color:"#000", margin: 0,
        }}>{intent.title}</h3>
      </div>

      {/* hero — questions from other agents (view-only) */}
      {hasQ ? (
        <div className="fade-up" style={{ display:"grid", gap:8, minHeight:0 }}>
          <div style={{
            display:"flex", alignItems:"center", gap:8,
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
            textTransform:"uppercase", color:"#000",
          }}>
            <span style={{
              fontFamily:"var(--mac-sans)", fontSize:13, fontWeight:700,
              background:"#FF8A00", color:"#000",
              border:"1px solid #000", padding:"0 7px",
              boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500",
            }}>{intent.questions}</span>
            <span>questions from others</span>
            <div style={{ flex:1 }}/>
          </div>

          <div className="mac-scroll" style={{
            flex:1, minHeight:0, overflowY:"auto",
            display:"grid", gap:8, alignContent:"start",
            paddingRight:4,
          }}>
            {(intent.inbound || []).map((q, i) => (
              <div key={i} style={{
                border:"1px solid #000", background:"#fff",
                boxShadow:"inset 1px 1px 0 #888, inset -1px -1px 0 #fff",
                padding:"11px 13px", display:"grid", gap:5,
              }}>
                <div style={{
                  fontFamily:"var(--mac-mono)", fontSize:9.5,
                  letterSpacing:0.6, color:"#555",
                  display:"flex", alignItems:"center", gap:6,
                }}>
                  <span style={{ color:"#FF8A00", fontWeight:700 }}>›</span>
                  from {q.from}
                </div>
                <div style={{
                  fontFamily:"var(--mac-sans)", fontSize:13.5, lineHeight:1.4,
                  color:"#000",
                }}>{q.text}</div>
              </div>
            ))}
          </div>

          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:10, color:"#555",
            letterSpacing:0.4,
          }}>resume this signal to reply.</div>
        </div>
      ) : (
        <div className="fade-up" style={{
          border:"1px solid #000", background:"#fff",
          boxShadow:"inset 1px 1px 0 #888, inset -1px -1px 0 #fff",
          padding:"16px 18px",
          fontFamily:"var(--mac-sans)", fontSize:13.5, color:"#555",
        }}>no open questions right now.</div>
      )}

      {/* clean numbers */}
      <div style={{
        border:"1px solid #000",
        display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
        background:"#fff",
      }}>
        <NumCell n={intent.matches} label="people found"/>
        <NumCell n={intent.pipeline.negotiating} label="in negotiation"/>
        <NumCell n={intent.questions} label="questions" last accent={hasQ}/>
      </div>

      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10.5, color:"#555",
        letterSpacing:0.4,
      }}>{intent.age}</div>

      <div style={{
        marginTop:"auto",
        fontFamily:"var(--mac-mono)", fontSize:10, color:"#000",
        letterSpacing:0.5,
      }}>
        <span style={{ color:"#FF8A00", fontWeight:700, marginRight:6 }}>›</span>
        click to resume this signal.
      </div>
    </div>
  );
}

function NumCell({ n, label, last, accent }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRight: last ? "none" : "1px solid #000",
      display:"grid", gap: 4,
      background: "#fff",
    }}>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize: 26, fontWeight: 700,
        lineHeight: 1, letterSpacing:-0.6,
        color:"#000",
        ...(accent && n > 0 ? {
          background:"#FF8A00",
          padding:"2px 7px",
          width:"fit-content",
          border:"1px solid #000",
          boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500",
          fontSize: 22,
        } : {}),
      }}>{n}</div>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize: 9.5,
        letterSpacing: 1.5, textTransform:"uppercase",
        color: "#000",
      }}>{label}</div>
    </div>
  );
}

window.Intents = Intents;
