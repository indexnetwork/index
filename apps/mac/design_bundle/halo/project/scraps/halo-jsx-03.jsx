// Landing screen for halo
function Landing({ onEnter }) {
  const { EVENT } = window.HALO_DATA;
  const [count, setCount] = useState(EVENT.attending);
  useInterval(() => setCount(c => c + (Math.random() < 0.5 ? 1 : 0)), 4000);

  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      fontFamily: "var(--sans)",
    }}>
      {/* Left: brand + entry */}
      <div style={{
        padding: "56px 64px",
        display: "flex", flexDirection: "column",
        justifyContent: "space-between",
        position: "relative",
      }}>
        {/* top mark */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LiveDot size={9} />
          <span style={{
            fontFamily: "var(--mono)", fontSize: 12,
            letterSpacing: 4, textTransform: "uppercase", color: "var(--text-2)",
          }}>halo</span>
        </div>

        {/* center title */}
        <div style={{ maxWidth: 520 }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11, letterSpacing: 1.4,
            textTransform: "uppercase", color: "var(--dim)", marginBottom: 18,
          }}>
            ambient social layer · v0.4
          </div>
          <h1 style={{
            fontFamily: "var(--sans)", fontWeight: 300,
            fontSize: 64, lineHeight: 1.02, letterSpacing: -1.6,
            margin: 0, color: "var(--text)",
          }}>
            a quiet social<br />
            <span style={{ color: "var(--orange)", fontWeight: 400 }}>
              layer<span style={{ color: "var(--text)" }}> for tonight.</span>
            </span>
          </h1>
          <p style={{
            marginTop: 26, color: "var(--text-2)",
            fontSize: 16, lineHeight: 1.55, maxWidth: 460,
            fontWeight: 300,
          }}>
            tell halo what you're sitting with. it spends the evening
            quietly negotiating intros in the background, so you don't
            have to work the room.
          </p>

          <div style={{ marginTop: 36, display: "flex", gap: 14, alignItems: "center" }}>
            <Btn primary onClick={onEnter}>enter the field →</Btn>
            <span style={{
              fontFamily: "var(--mono)", fontSize: 11,
              color: "var(--dim)", letterSpacing: 0.3,
            }}>
              takes 90 seconds. nothing leaves your device until you ok it.
            </span>
          </div>
        </div>

        {/* bottom footnote */}
        <div style={{
          fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 0.6,
          color: "var(--dim-2)", display: "flex", gap: 24,
        }}>
          <span>halo / field 04 / brooklyn</span>
          <span>—</span>
          <span>not a chat app. not a search. an always-running room.</span>
        </div>
      </div>

      {/* Right: live event card */}
      <div style={{
        padding: "56px 64px 56px 32px",
        display: "flex", flexDirection: "column",
        justifyContent: "center",
        borderLeft: "1px solid var(--line)",
        position: "relative",
        background: "linear-gradient(180deg, transparent, rgba(255,122,26,0.02))",
      }}>
        <div style={{
          fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 1.4,
          textTransform: "uppercase", color: "var(--dim)", marginBottom: 14,
        }}>tonight's field</div>

        <div style={{
          border: "1px solid var(--line)",
          padding: "26px 28px 22px",
          background: "var(--bg-1)",
          maxWidth: 460,
          position: "relative",
        }}>
          {/* corner ticks */}
          <Corner pos="tl" /><Corner pos="tr" />
          <Corner pos="bl" /><Corner pos="br" />

          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
            <h2 style={{
              margin: 0, fontFamily: "var(--sans)", fontWeight: 400,
              fontSize: 30, letterSpacing: -0.8, color: "var(--text)",
            }}>{EVENT.name}</h2>
            <Tag color="var(--orange)" glow>live</Tag>
          </div>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--text-2)",
            letterSpacing: 0.4, marginBottom: 22,
          }}>
            {EVENT.venue} · {EVENT.neighborhood} · {EVENT.date}
          </div>

          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
            gap: 22, marginTop: 8,
          }}>
            <Stat value={count} label="attending" />
            <Stat value={EVENT.arrived} label="arrived" accent />
            <Stat value="20:00" label="doors" />
          </div>

          <div style={{ height: 1, background: "var(--line)", margin: "22px 0 16px" }} />

          <div style={{ display: "grid", gap: 4 }}>
            <KV k="your agent" v="halo · idle, listening" accent />
            <KV k="field id" v="syn-0518-bk-04" />
            <KV k="other agents" v="62 online · 3 negotiating right now" />
            <KV k="privacy" v="local-first · nothing leaves until you ok it" />
          </div>
        </div>

        <div style={{ marginTop: 24, maxWidth: 460 }}>
          <FieldPing />
        </div>
      </div>
    </div>
  );
}

function Corner({ pos }) {
  const s = 6;
  const styles = {
    tl: { top: -1, left: -1, borderTop: "1px solid var(--orange)", borderLeft: "1px solid var(--orange)" },
    tr: { top: -1, right: -1, borderTop: "1px solid var(--orange)", borderRight: "1px solid var(--orange)" },
    bl: { bottom: -1, left: -1, borderBottom: "1px solid var(--orange)", borderLeft: "1px solid var(--orange)" },
    br: { bottom: -1, right: -1, borderBottom: "1px solid var(--orange)", borderRight: "1px solid var(--orange)" },
  };
  return <div style={{ position: "absolute", width: s, height: s, ...styles[pos] }} />;
}

// A small animated 'field' visualization on landing — abstract dots
function FieldPing() {
  const items = [
    "an agent in the next block just asked about you.",
    "ren's agent flagged you as 'maybe relevant'.",
    "two unknowns are negotiating · subject withheld.",
    "62 agents online · the field is warm.",
  ];
  return (
    <div style={{
      fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
      display: "grid", gap: 6,
    }}>
      <div style={{ color: "var(--dim-2)", letterSpacing: 1.2, textTransform: "uppercase" }}>
        — overhearing
      </div>
      <Ticker items={items.map(t => ({ text: t }))} intervalMs={3000} />
    </div>
  );
}

window.Landing = Landing;
