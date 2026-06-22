// Onboarding — conversational. Agent asks; user responds.
function Onboarding({ onDone, onBack }) {
  const { ONBOARDING_STEPS } = window.HALO_DATA;
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);

  const step = ONBOARDING_STEPS[stepIdx];

  useEffect(() => {
    setDraft("");
    if (inputRef.current) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 700);
    }
  }, [stepIdx]);

  const submit = (val) => {
    const v = (val ?? draft).trim();
    if (!v && !step.choices) return;
    const newAns = { ...answers, [step.id]: val ?? draft };
    setAnswers(newAns);
    if (stepIdx < ONBOARDING_STEPS.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      setCalibrating(true);
      setTimeout(() => onDone(newAns), 2200);
    }
  };

  if (calibrating) {
    return <Calibrating />;
  }

  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "grid", gridTemplateColumns: "1fr 480px",
    }}>
      {/* Left: conversation log */}
      <div style={{
        padding: "44px 60px 24px",
        display: "flex", flexDirection: "column",
        position: "relative", overflow: "hidden",
      }}>
        {/* top bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28 }}>
          <button onClick={onBack} style={{
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
            letterSpacing: 0.4, textTransform: "lowercase",
          }}>← back</button>
          <div style={{ flex: 1 }} />
          <LiveDot size={7} />
          <span style={{
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)",
            letterSpacing: 1.5, textTransform: "uppercase",
          }}>halo · calibrating</span>
        </div>

        {/* progress */}
        <div style={{ display: "flex", gap: 4, marginBottom: 36 }}>
          {ONBOARDING_STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 2,
              background: i <= stepIdx ? "var(--orange)" : "rgba(255,255,255,0.08)",
              boxShadow: i === stepIdx ? "0 0 8px rgba(255,122,26,0.5)" : "none",
              transition: "all .3s",
            }} />
          ))}
        </div>

        {/* conversation history + current */}
        <div className="scroll" style={{
          flex: 1, overflowY: "auto",
          display: "flex", flexDirection: "column", gap: 22,
          paddingRight: 12, paddingBottom: 24,
        }}>
          {ONBOARDING_STEPS.slice(0, stepIdx).map((s, i) => (
            <PastTurn key={s.id} step={s} answer={answers[s.id]} />
          ))}

          {/* current question */}
          <div key={step.id} className="fade-up" style={{ display: "grid", gap: 12 }}>
            <AgentBubble>
              <StreamText text={step.prompt} speed={18} />
            </AgentBubble>
            {step.hint && (
              <div style={{
                fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
                marginLeft: 32, marginTop: -4,
              }}>
                {step.hint}
              </div>
            )}

            {/* input area */}
            <div style={{ marginLeft: 32, marginTop: 10, display: "grid", gap: 14 }}>
              {step.choices ? (
                <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
                  {step.choices.map(c => (
                    <ChoiceRow key={c.value} c={c} onClick={() => submit(c.value)} />
                  ))}
                </div>
              ) : (
                <>
                  <div style={{
                    display: "flex", flexWrap: "wrap", gap: 6, maxWidth: 620,
                  }}>
                    {step.examples?.map(ex => (
                      <Chip key={ex} onClick={() => submit(ex)}>{ex}</Chip>
                    ))}
                  </div>
                  <form onSubmit={(e) => { e.preventDefault(); submit(); }}
                    style={{ display: "flex", gap: 10, alignItems: "center", maxWidth: 620 }}>
                    <span style={{ color: "var(--orange)", fontFamily: "var(--mono)" }}>›</span>
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      placeholder={step.placeholder}
                      style={{
                        flex: 1,
                        background: "transparent",
                        border: "none",
                        borderBottom: "1px solid var(--line-2)",
                        outline: "none",
                        color: "var(--text)",
                        fontFamily: "var(--sans)",
                        fontSize: 16,
                        padding: "8px 0",
                      }}
                      onFocus={(e) => e.target.style.borderBottomColor = "var(--orange)"}
                      onBlur={(e) => e.target.style.borderBottomColor = "var(--line-2)"}
                    />
                    <Btn primary small onClick={() => submit()}>send ↵</Btn>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right: live ambient field already running */}
      <OnboardingFieldPreview answers={answers} stepIdx={stepIdx} />
    </div>
  );
}

function AgentBubble({ children }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{
        width: 22, height: 22, borderRadius: 2,
        border: "1px solid rgba(255,122,26,0.4)",
        display: "grid", placeItems: "center",
        boxShadow: "0 0 14px rgba(255,122,26,0.18)",
        flex: "0 0 auto", marginTop: 4,
      }}>
        <span style={{
          fontFamily: "var(--mono)", fontSize: 10,
          color: "var(--orange)", letterSpacing: 0.2,
        }}>h</span>
      </div>
      <div style={{
        fontFamily: "var(--sans)", fontSize: 19,
        color: "var(--text)", fontWeight: 300, lineHeight: 1.4,
        maxWidth: 620,
      }}>{children}</div>
    </div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{ display: "flex", gap: 10, marginLeft: 32 }}>
      <span style={{ color: "var(--dim-2)", fontFamily: "var(--mono)" }}>›</span>
      <div style={{
        fontFamily: "var(--sans)", fontSize: 14,
        color: "var(--text-2)", maxWidth: 520, fontStyle: "italic",
      }}>{children}</div>
    </div>
  );
}

function PastTurn({ step, answer }) {
  return (
    <div style={{ display: "grid", gap: 8, opacity: 0.55 }}>
      <AgentBubble>
        <span style={{ fontSize: 15, color: "var(--text-2)" }}>{step.prompt}</span>
      </AgentBubble>
      <UserBubble>{step.choices ? step.choices.find(c => c.value === answer)?.label : answer}</UserBubble>
    </div>
  );
}

function ChoiceRow({ c, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        border: `1px solid ${hover ? "rgba(255,122,26,0.5)" : "var(--line)"}`,
        background: hover ? "rgba(255,122,26,0.06)" : "transparent",
        display: "grid", gap: 4,
        transition: "all .15s ease",
      }}>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 12,
        color: hover ? "var(--orange-2)" : "var(--text)",
        letterSpacing: 0.4, textTransform: "lowercase",
      }}>{c.label}</div>
      <div style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--dim)" }}>{c.sub}</div>
    </button>
  );
}

// Right column during onboarding — shows the field starting to come alive
function OnboardingFieldPreview({ answers, stepIdx }) {
  const lines = [
    "scanning the field…",
    "found 184 attendees indexed.",
    "62 have an agent online.",
    answers.intent ? `noted: \"${truncate(answers.intent, 38)}\"` : null,
    stepIdx >= 1 ? "checking your signal against the room…" : null,
    answers.edges ? `cross-referenced: ${truncate(answers.edges, 38)}` : null,
    stepIdx >= 2 ? "filtering by off-limits…" : null,
    answers["off-limits"] ? `respecting: ${truncate(answers["off-limits"], 38)}` : null,
    stepIdx >= 3 ? "calibrating operating mode…" : null,
  ].filter(Boolean);

  return (
    <div style={{
      borderLeft: "1px solid var(--line)",
      background: "var(--bg-1)",
      padding: "44px 36px",
      display: "flex", flexDirection: "column",
      gap: 18, overflow: "hidden",
    }}>
      <div style={{
        fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 1.4,
        textTransform: "uppercase", color: "var(--dim)",
      }}>— the field, warming</div>

      <div className="scroll" style={{
        flex: 1, overflowY: "auto",
        fontFamily: "var(--mono)", fontSize: 12,
        color: "var(--text-2)", lineHeight: 1.7,
        display: "grid", gap: 6, alignContent: "start",
      }}>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{ animationDelay: `${i*60}ms` }}>
            <span style={{ color: "var(--orange-dim)" }}>·</span>{" "}
            <span style={{ color: i === lines.length - 1 ? "var(--text)" : "var(--text-2)" }}>{l}</span>
          </div>
        ))}
        {stepIdx >= 1 && <FieldGlyph />}
      </div>

      <div style={{
        fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)",
        letterSpacing: 0.5,
      }}>
        nothing here leaves your device. promise.
      </div>
    </div>
  );
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }

// Simple orbiting-dot glyph
function FieldGlyph() {
  return (
    <div style={{ position: "relative", height: 160, marginTop: 14 }}>
      <div style={{
        position: "absolute", left: "50%", top: "50%",
        width: 10, height: 10, marginLeft: -5, marginTop: -5,
        borderRadius: 999, background: "var(--orange)",
        boxShadow: "0 0 20px rgba(255,122,26,0.6)",
      }} />
      {[44, 64, 88].map((r, i) => (
        <div key={r} style={{
          position: "absolute", left: "50%", top: "50%",
          width: r * 2, height: r * 2,
          marginLeft: -r, marginTop: -r,
          border: "1px dashed rgba(255,255,255,0.06)",
          borderRadius: 999,
          animation: `orbit ${22 + i*8}s linear infinite`,
        }}>
          <div style={{
            position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)",
            width: 5, height: 5, borderRadius: 999,
            background: `hsl(${28 + i*6} 90% ${60 - i*8}%)`,
            boxShadow: "0 0 8px rgba(255,122,26,0.6)",
          }} />
        </div>
      ))}
    </div>
  );
}

function Calibrating() {
  const lines = [
    "compressing your edges into a signal…",
    "negotiating handshakes with 62 agents…",
    "filtering people you'd rather not see…",
    "opening the field.",
  ];
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "grid", placeItems: "center",
      fontFamily: "var(--mono)", color: "var(--text-2)",
    }}>
      <div style={{ display: "grid", gap: 16, textAlign: "center" }}>
        <div style={{
          display: "flex", justifyContent: "center",
          gap: 10, alignItems: "center", marginBottom: 8,
        }}>
          <LiveDot size={10} />
          <span style={{ letterSpacing: 4, fontSize: 11, textTransform: "uppercase" }}>halo</span>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{
            animationDelay: `${i * 350}ms`,
            fontSize: 13, color: i === lines.length - 1 ? "var(--orange-2)" : "var(--dim)",
            letterSpacing: 0.3,
          }}>
            <span style={{ color: "var(--orange-dim)", marginRight: 8 }}>›</span>{l}
          </div>
        ))}
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
