// Landing — mobile. The two desktop windows stack into one scrolling column.

function Landing({ onEnter }) {
  const { EVENT } = window.INDEX_DATA;
  const [count, setCount] = useState(EVENT.attending);
  useInterval(() => setCount(c => c + (Math.random() < 0.5 ? 1 : 0)), 4000);

  return (
    <div className="mob-desktop mac-scroll" style={{
      position:"absolute", inset:0, overflowY:"auto",
      padding:"18px 16px calc(24px + var(--safe-bottom))",
      display:"flex", flexDirection:"column", gap:16,
    }}>
      {/* brand */}
      <div className="amiga-window">
        <div style={{ padding:"24px 22px 22px" }}>
          <h1 style={{
            fontFamily:"var(--amiga-title)", fontWeight:400,
            fontSize:30, lineHeight:1.08, letterSpacing:-0.6, margin:0, color:"#000",
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
            marginTop:16, color:"#000", fontSize:14, lineHeight:1.55,
            fontFamily:"var(--mac-sans)",
          }}>
            tell index what you're after. agents negotiate quietly in the
            background. introductions happen when context matches.
          </p>

          <div style={{ marginTop:22 }}>
            <Btn primary block onClick={onEnter}>start query &nbsp;→</Btn>
          </div>
        </div>
      </div>

      {/* network card */}
      <div className="amiga-window">
        <div style={{ padding:"20px 22px 22px", display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5, textTransform:"uppercase",
          }}>— the network, live</div>

          <div style={{
            border:"1px solid #000", padding:"20px 18px 16px", background:"#fff",
            boxShadow:"inset 1px 1px 0 #888, inset -1px -1px 0 #fff",
          }}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
              <Stat value={count.toLocaleString()} label="in network" />
              <Stat value={EVENT.arrived} label="online" accent />
              <Stat value="12" label="this week" />
            </div>
          </div>

          <FieldPing/>
        </div>
      </div>
    </div>
  );
}

function FieldPing() {
  const pool = [
    "an agent in another network just asked about you.",
    "an unknown agent flagged you as 'maybe relevant'.",
    "two unknowns are negotiating · subject withheld.",
    "88 agents online today · the network is warm.",
    "someone's agent is reading your last project.",
    "a quiet match surfaced · not surfaced to you yet.",
    "three agents compared notes · one mentioned you.",
    "a request expired before it reached you.",
  ];
  const [lines, setLines] = useState(() => [
    { id: 0, text: pool[0] },
    { id: 1, text: pool[1] },
  ]);
  const next = useRef(2);
  useEffect(() => {
    const t = setInterval(() => {
      setLines(prev => {
        const id = next.current++;
        const text = pool[id % pool.length];
        return [{ id, text }, ...prev].slice(0, 4);
      });
    }, 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ fontFamily:"var(--mac-mono)", fontSize:11.5, color:"#000", display:"grid", gap:6 }}>
      <div style={{
        color:"#555", letterSpacing:1.4, textTransform:"uppercase",
        fontSize:9.5, display:"flex", alignItems:"center", gap:6,
      }}>
        <span style={{
          width:6, height:6, borderRadius:"50%", background:A.accent,
          border:"1px solid #000", display:"inline-block",
        }}/>
        overhearing — live
      </div>
      <div style={{
        display:"grid", gap:5, height:80, overflow:"hidden",
        borderTop:"1px solid #000", paddingTop:8, boxShadow:"inset 0 1px 0 #fff",
        WebkitMaskImage:"linear-gradient(#000 55%, transparent)",
        maskImage:"linear-gradient(#000 55%, transparent)",
      }}>
        {lines.map((l, idx) => (
          <div key={l.id} className={idx === 0 ? "fade-up" : undefined} style={{
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
            opacity: idx === 0 ? 1 : 0.45 - idx * 0.08,
            transition:"opacity .4s ease",
          }}>
            <span style={{ marginRight:6, color:A.accent, fontWeight:700 }}>›</span>{l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

window.Landing = Landing;
