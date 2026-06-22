// Onboarding — Mac System 6 chrome, conversational. + Calibrating screen.

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

  if (calibrating) return <Calibrating/>;

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      padding:"32px 40px", overflow:"auto",
    }}>
      <div style={{
        width: 980, maxWidth:"100%",
        display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:18,
        height: "min(720px, calc(100vh - 80px))",
      }}>
        {/* LEFT — conversation window */}
        <MacWindow title="halo · calibrating" onClose={onBack}>
          <div style={{
            padding:"18px 28px 12px",
            display:"flex", flexDirection:"column",
            flex:1, minHeight:0,
          }}>
            {/* top status row */}
            <div style={{
              display:"flex", alignItems:"center", gap:10, marginBottom:16,
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
              }}>halo · calibrating</span>
            </div>

            {/* progress — pinstripe segments */}
            <div style={{ display:"flex", gap:3, marginBottom:24 }}>
              {ONBOARDING_STEPS.map((_, i) => (
                <div key={i} style={{
                  flex:1, height:8,
                  border:"1px solid #000",
                  background: i < stepIdx
                    ? "#000"
                    : i === stepIdx
                      ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)"
                      : "#fff",
                }}/>
              ))}
            </div>

            <div className="mac-scroll" style={{
              flex:1, minHeight:0, overflowY:"auto",
              display:"flex", flexDirection:"column", gap:20,
              paddingRight:6, paddingBottom:18,
            }}>
              {ONBOARDING_STEPS.slice(0, stepIdx).map((s) => (
                <PastTurn key={s.id} step={s} answer={answers[s.id]}/>
              ))}

              <div key={step.id} className="fade-up" style={{ display:"grid", gap:10 }}>
                <AgentBubble><StreamText text={step.prompt} speed={18}/></AgentBubble>
                {step.hint && (
                  <div style={{
                    fontFamily:"var(--mac-mono)", fontSize:10.5, color:"#555",
                    marginLeft:32, marginTop:-2,
                  }}>{step.hint}</div>
                )}

                <div style={{ marginLeft:32, marginTop:8, display:"grid", gap:14 }}>
                  {step.choices ? (
                    <div style={{ display:"grid", gap:6, maxWidth:520 }}>
                      {step.choices.map(c => (
                        <ChoiceRow key={c.value} c={c} onClick={() => submit(c.value)}/>
                      ))}
                    </div>
                  ) : (
                    <React.Fragment>
                      <div style={{
                        display:"flex", flexWrap:"wrap", gap:6, maxWidth:600,
                      }}>
                        {step.examples?.map(ex => (
                          <Chip key={ex} onClick={() => submit(ex)}>{ex}</Chip>
                        ))}
                      </div>
                      <form onSubmit={(e) => { e.preventDefault(); submit(); }}
                        style={{ display:"flex", gap:10, alignItems:"center", maxWidth:600 }}>
                        <span style={{
                          fontFamily:"var(--mac-mono)",
                          fontSize: 14, color:"#000",
                        }}>›</span>
                        <input
                          ref={inputRef}
                          value={draft}
                          onChange={e => setDraft(e.target.value)}
                          placeholder={step.placeholder}
                          style={{
                            flex:1,
                            background:"#fff",
                            border:"none",
                            borderBottom:"1px solid #000",
                            outline:"none",
                            color:"#000",
                            fontFamily:"var(--mac-sans)",
                            fontSize: 15,
                            padding:"6px 0",
                          }}
                        />
                        <Btn primary small onClick={() => submit()}>send ↵</Btn>
                      </form>
                    </React.Fragment>
                  )}
                </div>
              </div>
            </div>
          </div>
        </MacWindow>

        {/* RIGHT — the field warming */}
        <MacWindow title="The Field, warming">
          <OnboardingFieldPreview answers={answers} stepIdx={stepIdx}/>
        </MacWindow>
      </div>
    </div>
  );
}

function AgentBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      <div style={{
        width:22, height:22,
        border:"1px solid #000",
        display:"grid", placeItems:"center",
        flex:"0 0 auto", marginTop:4,
        background:"#000", color:"#fff",
      }}>
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.2,
        }}>h</span>
      </div>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:18,
        color:"#000", fontWeight:400, lineHeight:1.4,
        maxWidth:620,
      }}>{children}</div>
    </div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:10, marginLeft:32 }}>
      <span style={{ color:"#666", fontFamily:"var(--mac-mono)" }}>›</span>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:13.5,
        color:"#000", maxWidth:520, fontStyle:"italic",
      }}>{children}</div>
    </div>
  );
}

function PastTurn({ step, answer }) {
  return (
    <div style={{ display:"grid", gap:6, opacity:0.55 }}>
      <AgentBubble>
        <span style={{ fontSize:14, color:"#444" }}>{step.prompt}</span>
      </AgentBubble>
      <UserBubble>{step.choices ? step.choices.find(c => c.value === answer)?.label : answer}</UserBubble>
    </div>
  );
}

function ChoiceRow({ c, onClick }) {
  const [down, setDown] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        textAlign:"left",
        padding:"10px 14px",
        border:"1px solid #000",
        background: down ? "#000" : "#fff",
        color:      down ? "#fff" : "#000",
        display:"grid", gap:4,
        cursor:"pointer",
      }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:12,
        letterSpacing:0.4, textTransform:"lowercase",
        fontWeight:600,
      }}>{c.label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:12, opacity:0.78 }}>{c.sub}</div>
    </button>
  );
}

// Right column during onboarding
function OnboardingFieldPreview({ answers, stepIdx }) {
  const lines = [
    "scanning the field…",
    "found 184 attendees indexed.",
    "62 have an agent online.",
    answers.intent ? `noted: "${truncate(answers.intent, 38)}"` : null,
    stepIdx >= 1 ? "checking your signal against the room…" : null,
    answers.edges ? `cross-referenced: ${truncate(answers.edges, 38)}` : null,
    stepIdx >= 2 ? "filtering by off-limits…" : null,
    answers["off-limits"] ? `respecting: ${truncate(answers["off-limits"], 38)}` : null,
    stepIdx >= 3 ? "calibrating operating mode…" : null,
  ].filter(Boolean);

  return (
    <div style={{
      padding:"22px 26px",
      display:"flex", flexDirection:"column", gap:14,
      overflow:"hidden", flex:1, minHeight:0,
    }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color:"#000",
      }}>— the field, warming</div>

      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        fontFamily:"var(--mac-mono)", fontSize:12,
        color:"#000", lineHeight:1.7,
        display:"grid", gap:5, alignContent:"start",
      }}>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{ animationDelay:`${i*60}ms` }}>
            <span style={{ marginRight:6 }}>·</span>
            <span style={{
              fontWeight: i === lines.length - 1 ? 700 : 400,
            }}>{l}</span>
          </div>
        ))}
        {stepIdx >= 1 && <FieldGlyph/>}
      </div>

      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, color:"#555",
        letterSpacing:0.5,
      }}>nothing here leaves your device. promise.</div>
    </div>
  );
}

function truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + "…" : s; }

function FieldGlyph() {
  return (
    <div style={{ position:"relative", height: 150, marginTop: 12 }}>
      <div style={{
        position:"absolute", left:"50%", top:"50%",
        width:10, height:10, marginLeft:-5, marginTop:-5,
        background:"#000",
      }}/>
      {[36, 56, 78].map((r, i) => (
        <div key={r} style={{
          position:"absolute", left:"50%", top:"50%",
          width: r*2, height: r*2,
          marginLeft:-r, marginTop:-r,
          border:"1px dashed #000",
          borderRadius:999,
          animation:`mac-orbit ${22 + i*8}s linear infinite`,
        }}>
          <div style={{
            position:"absolute", left:"50%", top:0, transform:"translateX(-50%)",
            width:6, height:6,
            background:"#000",
          }}/>
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
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
    }}>
      <MacWindow title="halo · calibrating" style={{ width: 420 }}>
        <div style={{ padding:"26px 28px 24px", textAlign:"center" }}>
          <div style={{
            display:"flex", justifyContent:"center",
            gap:10, alignItems:"center", marginBottom:18,
          }}>
            <LiveDot size={9}/>
            <span style={{
              fontFamily:"var(--mac-mono)",
              letterSpacing:3, fontSize:11, textTransform:"uppercase",
            }}>halo</span>
          </div>

          {/* indeterminate progress, pinstripe */}
          <div style={{
            border:"1px solid #000", height: 10, overflow:"hidden",
            margin:"0 auto 18px",
            background: "#fff",
          }}>
            <div style={{
              height:"100%",
              backgroundImage:
                "repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)",
              animation:"mac-stripes 0.8s linear infinite",
              backgroundSize: "24px 24px",
            }}/>
          </div>

          {lines.map((l, i) => (
            <div key={i} className="fade-up" style={{
              animationDelay:`${i * 350}ms`,
              fontFamily:"var(--mac-sans)",
              fontSize: 13,
              color: i === lines.length - 1 ? "#000" : "#444",
              letterSpacing:0.2,
              padding:"3px 0",
              fontWeight: i === lines.length - 1 ? 700 : 400,
            }}>
              <span style={{ marginRight:8, fontFamily:"var(--mac-mono)" }}>›</span>{l}
            </div>
          ))}
        </div>
      </MacWindow>
    </div>
  );
}

window.Onboarding = Onboarding;
