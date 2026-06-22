// Landing — Mac System 6 "Welcome to halo" window

function Landing({ onEnter }) {
  const { EVENT } = window.HALO_DATA;
  const [count, setCount] = useState(EVENT.attending);
  useInterval(() => setCount(c => c + (Math.random() < 0.5 ? 1 : 0)), 4000);

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      padding: "32px 40px",
      overflow:"auto",
    }}>
      <div style={{
        width: 920, maxWidth:"100%",
        display:"grid", gap:24,
        gridTemplateColumns:"1fr 1fr",
      }}>
        {/* Left window — brand */}
        <MacWindow title="halo" style={{ minHeight: 440 }}>
          <div style={{
            padding:"28px 32px 24px",
            display:"flex", flexDirection:"column", justifyContent:"space-between",
            flex:1,
          }}>
            <div style={{
              display:"flex", alignItems:"center", gap:8,
              fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:3,
              textTransform:"uppercase",
            }}>
              <LiveDot size={7}/>
              <span>halo · ambient social layer · v0.4</span>
            </div>

            <div style={{ maxWidth: 380 }}>
              <h1 style={{
                fontFamily:"var(--mac-sans)", fontWeight:400,
                fontSize:38, lineHeight:1.05, letterSpacing:-0.6,
                margin:0, color:"#000",
              }}>
                meet the people<br/>
                <span style={{
                  background:"#000", color:"#fff",
                  padding:"0 6px", display:"inline-block",
                }}>you're</span>{" "}
                <span>looking for.</span>
              </h1>

              <p style={{
                marginTop:18, color:"#000",
                fontSize:13.5, lineHeight:1.55, maxWidth:340,
                fontFamily:"var(--mac-sans)",
              }}>
                tell halo who you're trying to meet. it spends the week
                quietly negotiating intros with their agents, so you don't
                have to chase.
              </p>

              <div style={{
                marginTop:24, display:"flex", gap:12, alignItems:"center",
                flexWrap:"wrap",
              }}>
                <Btn primary onClick={onEnter}>find them →</Btn>
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:10,
                  color:"#444",
                }}>
                  takes 90 seconds. nothing leaves your<br/>device until you ok it.
                </span>
              </div>
            </div>

            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:9.5, letterSpacing:0.6,
              color:"#555", display:"flex", gap:18, flexWrap:"wrap",
              borderTop:"1px solid #000", paddingTop:10, marginTop:10,
            }}>
              <span>halo / always on</span>
              <span>—</span>
              <span>not a chat app. not a feed. an agent that keeps looking.</span>
            </div>
          </div>
        </MacWindow>

        {/* Right window — the network card */}
        <MacWindow title="The Network" style={{ minHeight: 440 }}>
          <div style={{ padding:"24px 28px 24px", display:"flex", flexDirection:"column", gap:14 }}>

            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
              textTransform:"uppercase",
            }}>— the network, live</div>

            <div style={{
              border:"1px solid #000",
              padding:"22px 22px 18px",
              background:"#fff",
              position:"relative",
            }}>
              <div style={{ display:"flex", alignItems:"baseline", gap:10, marginBottom:2 }}>
                <h2 style={{
                  margin:0, fontFamily:"var(--mac-sans)", fontWeight:400,
                  fontSize:26, letterSpacing:-0.4, color:"#000",
                }}>{EVENT.name}</h2>
                <Tag inverted>LIVE</Tag>
              </div>
              <div style={{
                fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
                letterSpacing:0.4, marginBottom:18,
              }}>
                {EVENT.venue} · {EVENT.neighborhood} · {EVENT.date}
              </div>

              <div style={{
                display:"grid", gridTemplateColumns:"1fr 1fr 1fr",
                gap:14, marginTop:4,
              }}>
                <Stat value={count.toLocaleString()} label="in network" />
                <Stat value={EVENT.arrived} label="online now" accent />
                <Stat value="12" label="new this week" />
              </div>

              <div style={{ height:1, background:"#000", margin:"16px 0 12px" }}/>

              <div style={{ display:"grid", gap:3 }}>
                <KV k="your agent"    v="halo · idle, listening" accent/>
                <KV k="network id"    v="halo/0.4"/>
                <KV k="other agents"  v={`${EVENT.arrived} online · 12 negotiating right now`}/>
                <KV k="privacy"       v="local-first"/>
              </div>
            </div>

            <FieldPing/>
          </div>
        </MacWindow>
      </div>
    </div>
  );
}

function FieldPing() {
  const items = [
    "an agent in another network just asked about you.",
    "ren's agent flagged you as 'maybe relevant'.",
    "two unknowns are negotiating · subject withheld.",
    "88 agents online · the network is warm.",
  ];
  return (
    <div style={{
      fontFamily:"var(--mac-mono)", fontSize:11, color:"#000",
      display:"grid", gap:6,
    }}>
      <div style={{
        color:"#555", letterSpacing:1.4, textTransform:"uppercase",
        fontSize:9.5,
      }}>— overhearing</div>
      <Ticker items={items.map(t => ({ text: t }))} intervalMs={3000}/>
    </div>
  );
}

window.Landing = Landing;
