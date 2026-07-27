// Intents — mobile signals hub: brand promise, active signals, and the entry
// point for a fresh signal. Tapping a saved signal resumes it directly.

function Intents({ onPickExisting, onNew, onBack }) {
  const { INTENTS } = window.INDEX_DATA;

  const active = INTENTS.filter(i => i.status === "active");
  const idle   = INTENTS.filter(i => i.status === "idle");
  const paused = INTENTS.filter(i => i.status === "paused");
  const ordered = [...active, ...idle, ...paused];

  const totalRunning = active.length + idle.length;
  const totalQuestions = INTENTS.reduce((a, i) => a + (i.questions || 0), 0);

  return (
    <div className="mob-desktop" style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
      <PanelHeader
        title="index · your signals"
        right={
          <span style={{
            display:"flex", alignItems:"center", gap:6,
            fontFamily:"var(--mac-mono)", fontSize:9.5, color:"#000",
            letterSpacing:1, textTransform:"uppercase",
          }}>
            <LiveDot size={7}/> {totalRunning} on · {totalQuestions} q
          </span>
        }
      />

      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        padding:"16px 16px calc(20px + var(--safe-bottom))",
        display:"flex", flexDirection:"column", gap:10, background:"#fff",
      }}>
        <div>
          <h1 style={{
            fontFamily:"var(--amiga-title)", fontWeight:400,
            fontSize:27, lineHeight:1.08, letterSpacing:-0.6, margin:0, color:"#000",
          }}>
            meet the person your agent is{" "}
            <span style={{
              background:"#FF8A00", color:"#000", padding:"0 6px",
              display:"inline-block", border:"1px solid #000",
              boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 2px 2px 0 #000",
              fontWeight:700,
            }}>already</span>{" "}
            looking for.
          </h1>
          <p style={{
            marginTop:8, fontFamily:"var(--mac-sans)", fontSize:13, color:"#444", lineHeight:1.5,
          }}>
            resume a running signal, answer what other agents are asking, or
            open a fresh signal and let the feed refine it in place.
          </p>
        </div>

        <RuleLabel>— your signals</RuleLabel>

        {ordered.map(intent => (
          <IntentRow key={intent.id} intent={intent} onOpen={() => onPickExisting(intent)}/>
        ))}

        <NewIntentRow onClick={onNew}/>
      </div>
    </div>
  );
}

function IntentRow({ intent, onOpen }) {
  const [down, press] = usePress();
  const isPaused = intent.status === "paused";
  const isActive = intent.status === "active";
  const hasQ = intent.questions > 0;
  const statusLabel = isActive ? "running" : intent.status;
  return (
    <button onClick={onOpen} {...press}
      style={{
        textAlign:"left", padding:"14px 14px", width:"100%",
        border:"1px solid #000",
        background: down ? "#FFF6E8" : "#FFFFFF",
        boxShadow: down
          ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 #000"
          : "inset 1px 1px 0 #fff, inset -1px -1px 0 #888, 1px 1px 0 #000",
        display:"flex", alignItems:"center", gap:12, cursor:"pointer",
        opacity: isPaused ? 0.62 : 1, fontFamily:"var(--mac-sans)",
      }}>
      <div style={{ flex:1, minWidth:0, display:"grid", gap:4 }}>
        <div style={{
          fontFamily:"var(--amiga-title)", fontSize:15, color:"#000", fontWeight:500,
          letterSpacing:-0.1, lineHeight:1.25,
        }}>{intent.title}</div>
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          {isActive && <LiveDot size={6}/>}
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:9.5, color:"#555",
            letterSpacing:1, textTransform:"uppercase",
          }}>{statusLabel} · {intent.matches} matches</span>
        </div>
      </div>
      <QCount n={intent.questions} muted={!hasQ}/>
    </button>
  );
}

function QCount({ n, muted }) {
  if (muted) {
    return null;
  }
  return (
    <span style={{
      display:"flex", alignItems:"center", gap:7, padding:"7px 11px",
      border:"1px solid #000", background:"#FF8A00",
      boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500", flex:"0 0 auto",
    }}>
      <span style={{
        fontFamily:"var(--mac-sans)", fontSize:22, fontWeight:700,
        lineHeight:1, color:"#000", letterSpacing:-0.5,
      }}>{n}</span>
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:8.5, color:"#000",
        letterSpacing:1, textTransform:"uppercase", lineHeight:1.2,
      }}>question{n === 1 ? "" : "s"}</span>
    </span>
  );
}

function NewIntentRow({ onClick }) {
  const [down, press] = usePress();
  return (
    <button onClick={onClick} {...press}
      style={{
        textAlign:"left", padding:"18px 16px", width:"100%",
        border:"2px solid #000",
        background: down ? "#000" : "#FF8A00",
        color: down ? "#FF8A00" : "#000",
        cursor:"pointer", display:"flex", alignItems:"center", gap:14, marginTop:4,
        boxShadow: down ? "none" : "inset 1px 1px 0 #FFD7A0, inset -2px -2px 0 #8A4500, 3px 3px 0 #000",
      }}>
      <span style={{
        width:32, height:32, display:"grid", placeItems:"center",
        background: down ? "#FF8A00" : "#fff", color:"#000",
        border:"1px solid #000", boxShadow:"inset 1px 1px 0 #fff, inset -1px -1px 0 #888",
        fontFamily:"var(--mac-mono)", fontSize:22, fontWeight:700, flex:"0 0 auto",
      }}>+</span>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:17, fontWeight:700, letterSpacing:-0.2 }}>
        start a new signal
      </div>
    </button>
  );
}

window.Intents = Intents;
