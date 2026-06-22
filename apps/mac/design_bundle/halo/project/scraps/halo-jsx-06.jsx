// Room detail — slides over from the right when a match is clicked
function Room({ personId, onClose, person, onAction }) {
  const { NEGOTIATIONS } = window.HALO_DATA;
  const neg = NEGOTIATIONS[personId];
  const [extraMessages, setExtraMessages] = useState([]);
  const [confirming, setConfirming] = useState(null);

  // Esc closes
  useEffect(() => {
    const fn = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  // Periodically append a live negotiation tick
  useInterval(() => {
    const ambient = [
      { agent: "halo", text: `${person.name.split(" ")[0]}'s agent just blinked. waiting.`, state: "waiting" },
      { agent: `${person.name.split(" ")[0]}/agent`, text: "they shifted position · still in range.", state: "ok" },
      { agent: "halo", text: "you have 7 minutes before her conversation cluster breaks up.", state: "check" },
    ];
    const pick = ambient[Math.floor(Math.random() * ambient.length)];
    setExtraMessages(m => [...m, { ...pick, t: nowS() }]);
  }, 6000);

  if (!neg || !person) return null;

  const handle = (action) => {
    setConfirming(action);
    setTimeout(() => {
      onAction(personId, action);
      setConfirming(null);
      if (action === "accept" || action === "pass") {
        setTimeout(onClose, 700);
      }
    }, 900);
  };

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(0,0,0,0.65)",
      backdropFilter: "blur(3px)",
      animation: "fade-in 220ms ease",
      zIndex: 50,
      display: "grid", gridTemplateColumns: "1fr 880px",
    }}>
      <button onClick={onClose} style={{
        cursor: "pointer",
        background: "transparent",
        fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim-2)",
        textAlign: "left", padding: 24, alignSelf: "start", justifySelf: "start",
      }}>
        ← back to field
      </button>

      <div className="fade-up" style={{
        background: "var(--bg)",
        borderLeft: "1px solid var(--line)",
        boxShadow: "-30px 0 60px rgba(0,0,0,0.5)",
        display: "grid", gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
      }}>
        {/* header */}
        <div style={{
          padding: "20px 28px",
          borderBottom: "1px solid var(--line)",
          display: "grid", gridTemplateColumns: "auto 1fr auto",
          gap: 18, alignItems: "center",
          background: "var(--bg-1)",
        }}>
          <Avatar name={person.name} size={52} ring={person.status === "ready"} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h2 style={{
                margin: 0, fontFamily: "var(--sans)", fontWeight: 400,
                fontSize: 24, color: "var(--text)", letterSpacing: -0.4,
              }}>{person.name}</h2>
              <StatusBadgeBig status={person.status} />
            </div>
            <div style={{
              marginTop: 4, fontFamily: "var(--sans)", fontSize: 13.5,
              color: "var(--text-2)", fontWeight: 300,
            }}>{person.blurb}</div>
            <div style={{
              marginTop: 6, fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
            }}>
              <span style={{ color: "var(--orange-2)" }}>{neg.headline}</span>
              {" · "}{person.location} · {person.distance} · arrived {Math.abs(person.arrived)}m ago
            </div>
          </div>
          <button onClick={onClose} style={{
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
            padding: "6px 12px", border: "1px solid var(--line)",
          }}>esc ×</button>
        </div>

        {/* body — two columns: negotiation transcript + context */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 320px",
          overflow: "hidden",
        }}>
          {/* transcript */}
          <div className="scroll" style={{
            overflowY: "auto",
            padding: "20px 28px",
            display: "grid", gap: 16, alignContent: "start",
          }}>
            <RuleLabel color="var(--dim)">agent ↔ agent · negotiation pipeline</RuleLabel>

            {neg.pipeline.map((m, i) => (
              <NegLine key={i} m={m} />
            ))}
            {extraMessages.map((m, i) => (
              <NegLine key={"x" + i} m={{ t: m.t, agent: m.agent, text: m.text, state: m.state }} fresh />
            ))}

            <RuleLabel color="var(--dim)">opener i'd suggest</RuleLabel>
            <div style={{
              padding: 16,
              background: "rgba(255,122,26,0.04)",
              border: "1px solid rgba(255,122,26,0.18)",
              fontFamily: "var(--sans)", fontSize: 15, fontStyle: "italic",
              color: "var(--text)", maxWidth: 540, lineHeight: 1.5,
              fontWeight: 300,
            }}>
              {neg.opener}
            </div>

            <div style={{
              fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)",
              marginTop: -4,
            }}>
              ← i'll keep negotiating. you can ignore this room until you want it.
            </div>
          </div>

          {/* context sidebar */}
          <div style={{
            borderLeft: "1px solid var(--line)",
            padding: "20px 22px",
            background: "var(--bg-1)",
            display: "grid", gap: 18, alignContent: "start",
            overflowY: "auto",
          }} className="scroll">
            <Section title="overlap with your edges">
              {neg.overlap.map(o => (
                <div key={o} style={{
                  fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--orange-2)",
                  padding: "4px 0", borderBottom: "1px dashed rgba(255,122,26,0.18)",
                }}>· {o}</div>
              ))}
            </Section>

            {neg.avoid.length > 0 && (
              <Section title="avoid">
                {neg.avoid.map(o => (
                  <div key={o} style={{
                    fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--dim)",
                    padding: "4px 0",
                  }}>× {o}</div>
                ))}
              </Section>
            )}

            <Section title="intro path">
              <KV k="via" v={person.introVia} />
              <KV k="mutuals" v={`${person.mutuals} shared`} />
              <KV k="overlap score" v={`${Math.round(person.score * 100)}%`} accent />
            </Section>

            <Section title="their agent says">
              <div style={{
                fontFamily: "var(--sans)", fontSize: 13,
                color: "var(--text-2)", lineHeight: 1.45, fontWeight: 300,
                padding: "6px 0", fontStyle: "italic",
              }}>
                "open to meet, prefers slow. no calendar this week. flag if she's bringing recruiting energy."
              </div>
            </Section>

            <Section title="pipeline state">
              <KV k="status" v={person.status} accent />
              <KV k="last move" v="−2m ago" />
              <KV k="next check" v="ambient · no eta" />
            </Section>
          </div>
        </div>

        {/* actions */}
        <div style={{
          borderTop: "1px solid var(--line)",
          padding: "16px 24px",
          background: "var(--bg-1)",
          display: "flex", gap: 10, alignItems: "center",
        }}>
          <div style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)" }}>
            {confirming
              ? <span style={{ color: "var(--orange-2)" }}>· transmitting your choice…</span>
              : <span>your move. or close and trust me.</span>}
          </div>
          <Btn small onClick={() => handle("pass")} disabled={!!confirming}>pass</Btn>
          <Btn small onClick={() => handle("counter")} disabled={!!confirming}>counter-propose</Btn>
          <Btn small onClick={() => handle("wait")} disabled={!!confirming}>let it run</Btn>
          <Btn primary small onClick={() => handle("accept")} disabled={!!confirming}>
            {confirming === "accept" ? "sending…" : "accept intro →"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

function nowS() { return new Date().toISOString().slice(11, 16); }

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 1.2,
        textTransform: "uppercase", color: "var(--dim-2)",
        marginBottom: 6,
      }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function NegLine({ m, fresh }) {
  const isMe = m.agent === "halo";
  const stateColor = {
    ok: "var(--text-2)",
    check: "var(--orange-2)",
    waiting: "var(--dim)",
  }[m.state] || "var(--text-2)";
  return (
    <div className={fresh ? "fade-up" : ""} style={{
      display: "grid", gridTemplateColumns: "44px 90px 1fr",
      gap: 10, alignItems: "baseline",
      borderLeft: `2px solid ${isMe ? "rgba(255,122,26,0.4)" : "var(--line-2)"}`,
      paddingLeft: 12,
    }}>
      <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)" }}>{m.t}</div>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 11,
        color: isMe ? "var(--orange)" : "var(--text-2)",
        letterSpacing: 0.3,
      }}>{m.agent}</div>
      <div style={{
        fontFamily: "var(--sans)", fontSize: 13.5, fontWeight: 300,
        color: stateColor, lineHeight: 1.5,
      }}>{m.text}</div>
    </div>
  );
}

function StatusBadgeBig({ status }) {
  const map = {
    accepted:    { c: "var(--orange)",   t: "accepted · intro live" },
    ready:       { c: "var(--orange)",   t: "ready for intro" },
    negotiating: { c: "var(--orange-2)", t: "negotiating" },
    warm:        { c: "var(--text-2)",   t: "discovered · warm" },
    considering: { c: "var(--dim)",      t: "discovered" },
    expired:     { c: "var(--dim-2)",    t: "expired" },
    passed:      { c: "var(--dim-2)",    t: "passed" },
  };
  const cfg = map[status] || map.considering;
  return <Tag color={cfg.c} glow={status === "ready" || status === "accepted"}>{cfg.t}</Tag>;
}

window.Room = Room;
