// Onboarding — Mac System 6 chrome, conversational. + Calibrating screen.

// The second step adapts to whatever intent the person gave in step one, so the
// follow-up question is actually relevant to what they're looking for.
function resolveStep(baseStep, answers) {
  if (baseStep.id === "edges" && answers.intent) {
    return { ...baseStep, ...followUpFor(answers.intent) };
  }
  if (baseStep.id === "off-limits" && answers.intent) {
    return { ...baseStep, ...offLimitsFor(answers.intent) };
  }
  return baseStep;
}

// Off-limits chips, tuned to whatever they're actually looking for — so the
// suggestions feel like the agent gets the context, not a canned list.
function offLimitsFor(intent) {
  const t = (intent || "").toLowerCase();

  if (/(feedback|\bidea\b|business|startup|launch|validate|pitch)/.test(t)) {
    return {
      placeholder: "no investors in pitch mode · skip direct competitors · no 'just pivot' people…",
      examples: [
        "no investors pitching me",
        "skip direct competitors",
        "no 'you should pivot' takes",
      ],
    };
  }

  if (/(open.?source|contribut|\brepo\b|github|maintainer|\boss\b)/.test(t)) {
    return {
      placeholder: "no recruiters · skip crypto projects · no vague 'let's collab' DMs…",
      examples: [
        "no recruiters",
        "skip crypto projects",
        "no vague 'let's collab'",
      ],
    };
  }

  if (/(co.?founder|cofounder|\bpartner\b|start a company|build a company)/.test(t)) {
    return {
      placeholder: "no idea-only people · skip anyone not ready to commit · no recruiters…",
      examples: [
        "no idea-only people",
        "skip the not-ready-to-commit",
        "no recruiters",
      ],
    };
  }

  if (/(\bai\b|\bml\b|machine learning|\bmodel|\bllm)/.test(t)) {
    return {
      placeholder: "no recruiters · skip web3 / crypto · no one in hard-sell mode…",
      examples: [
        "no recruiters",
        "skip web3 / crypto",
        "no hard-sell mode",
      ],
    };
  }

  return {
    placeholder: "no recruiters · skip sales pitches · don't introduce me to my ex's friends…",
    examples: [
      "no recruiters",
      "skip sales pitches",
      "no crypto",
    ],
  };
}

function followUpFor(intent) {
  const t = (intent || "").toLowerCase();

  // a new idea / wants feedback
  if (/(feedback|\bidea\b|business|startup|launch|validate|pitch)/.test(t)) {
    return {
      prompt: "what's the idea, in a sentence?",
      hint: "rough is fine. i'll look for people who've been near this problem.",
      placeholder: "a payments tool for small crews · a calmer email client · ai notetaker for therapists…",
      examples: [
        "a payments tool for small crews",
        "an AI notetaker for therapists",
        "a marketplace for vintage synths",
      ],
    };
  }

  // open source / contributing
  if (/(open.?source|contribut|\brepo\b|github|maintainer|\boss\b)/.test(t)) {
    return {
      prompt: "what do you like to build with?",
      hint: "languages, stacks, the kind of problem you enjoy. helps me find the right projects.",
      placeholder: "rust + systems · typescript + dev tools · python + ml…",
      examples: [
        "rust + systems work",
        "typescript + developer tooling",
        "python + ml infra",
      ],
    };
  }

  // co-founder hunt
  if (/(co.?founder|cofounder|\bpartner\b|start a company|build a company)/.test(t)) {
    return {
      prompt: "what do you bring, and where's the gap?",
      hint: "your strength plus what you're missing lets me match the complement.",
      placeholder: "technical, need someone commercial · strong on design, weak on distribution…",
      examples: [
        "technical, need someone commercial",
        "strong on product, weak on sales",
        "can sell, need an engineer",
      ],
    };
  }

  // AI people / general interest
  if (/(\bai\b|\bml\b|machine learning|\bmodel|\bllm)/.test(t)) {
    return {
      prompt: "what corner of AI are you in right now?",
      hint: "the part you're closest to helps me find your people.",
      placeholder: "agents + tool use · evals + interpretability · open-weights models · ai for science…",
      examples: [
        "agents and tool use",
        "evals and interpretability",
        "open-weights tinkering",
      ],
    };
  }

  // default — meeting people generally
  return {
    prompt: "what're you into these days?",
    hint: "what's on your mind. it helps me pattern-match.",
    placeholder: "a side project i'm shipping · getting back into climbing · reading more fiction…",
    examples: [
      "a side project i'm shipping",
      "getting back into climbing",
      "reading more this year",
    ],
  };
}

function Onboarding({ onDone, onBack }) {
  const { ONBOARDING_STEPS } = window.INDEX_DATA;
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);

  const step = resolveStep(ONBOARDING_STEPS[stepIdx], answers);

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
        <MacWindow title="index · calibrating" onClose={onBack}>
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
                fontFamily:"var(--mac-mono)", fontSize:13, color:"#000",
                background:"transparent", border:"none", padding:0, cursor:"pointer",
              }}>← back</button>
              <div style={{ flex:1 }}/>
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
                <PastTurn key={s.id} step={resolveStep(s, answers)} answer={answers[s.id]}/>
              ))}

              <div key={step.id} className="fade-up" style={{ display:"grid", gap:10 }}>
                <AgentBubble><StreamText text={step.prompt} speed={18}/></AgentBubble>
                {step.hint && (
                  <div style={{
                    fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
                    marginLeft:36, marginTop:-2, lineHeight:1.4,
                  }}>{step.hint}</div>
                )}

                <div style={{ marginLeft:36, marginTop:10, display:"grid", gap:16 }}>
                  {step.choices ? (
                    <div style={{ display:"grid", gap:8, maxWidth:560 }}>
                      {step.choices.map(c => (
                        <ChoiceRow key={c.value} c={c} onClick={() => submit(c.value)}/>
                      ))}
                    </div>
                  ) : (
                    <React.Fragment>
                      {/* type your own answer first — the suggestions are the
                          "or pick one" fallback, so they come after */}
                      <form onSubmit={(e) => { e.preventDefault(); submit(); }}
                        style={{ display:"flex", gap:12, alignItems:"center", maxWidth:560 }}>
                        <span style={{
                          fontFamily:"var(--mac-mono)",
                          fontSize: 17, color:"#000",
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
                            fontSize: 16,
                            padding:"7px 0",
                          }}
                        />
                        <Btn primary disabled={!draft.trim()} onClick={() => submit()}>send ↵</Btn>
                      </form>
                      <div style={{
                        fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:1,
                        textTransform:"uppercase", color:"var(--ink-3)",
                      }}>or pick one</div>
                      <div style={{
                        display:"grid", gap:7, maxWidth:560,
                      }}>
                        {step.examples?.map(ex => (
                          <SuggestChip key={ex} onClick={() => submit(ex)}>{ex}</SuggestChip>
                        ))}
                      </div>
                    </React.Fragment>
                  )}
                </div>
              </div>
            </div>
          </div>
        </MacWindow>

        {/* RIGHT — the field warming */}
        <MacWindow title="the field, warming">
          <OnboardingFieldPreview answers={answers} stepIdx={stepIdx}/>
        </MacWindow>
      </div>
    </div>
  );
}

function AgentBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
      <div style={{
        width:26, height:26,
        border:"1px solid #000",
        display:"grid", placeItems:"center",
        flex:"0 0 auto", marginTop:3,
        background:"#000", color:"#fff",
      }}>
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:12, letterSpacing:0.2, fontWeight:600,
        }}>h</span>
      </div>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:21,
        color:"#000", fontWeight:500, lineHeight:1.35, letterSpacing:-0.2,
        maxWidth:620,
      }}>{children}</div>
    </div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:12, marginLeft:38 }}>
      <span style={{ color:"var(--ink-2)", fontFamily:"var(--mac-mono)", fontSize:14 }}>›</span>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:15,
        color:"#000", maxWidth:520, fontStyle:"italic",
      }}>{children}</div>
    </div>
  );
}

function PastTurn({ step, answer }) {
  return (
    <div style={{ display:"grid", gap:6, opacity:0.55 }}>
      <AgentBubble>
        <span style={{ fontSize:16, color:"var(--ink-2)" }}>{step.prompt}</span>
      </AgentBubble>
      <UserBubble>{step.choices ? step.choices.find(c => c.value === answer)?.label : answer}</UserBubble>
    </div>
  );
}

// Suggested answer — Workbench gadget sized up to match the question's altitude.
// Mirrors the bevel of the shared Chip/Btn primitives, but legible at a glance.
function SuggestChip({ children, onClick }) {
  const [down, setDown] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseDown={() => setDown(true)}
      onMouseUp={() => setDown(false)}
      onMouseLeave={() => setDown(false)}
      style={{
        textAlign:"left",
        padding:"9px 14px",
        fontFamily:"var(--mac-sans)", fontSize:14,
        textTransform:"lowercase", letterSpacing:0.2,
        border:"1px solid #000",
        background: down ? "#000" : "#fff",
        color:      down ? "#fff" : "#000",
        borderRadius:0,
        boxShadow: down
          ? "inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #fff"
          : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3), 1px 1px 0 rgba(0,0,0,0.2)",
        transform: down ? "translate(1px,1px)" : "none",
        cursor:"pointer",
      }}>{children}</button>
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
        padding:"12px 16px",
        border:"1px solid #000",
        background: down ? "#000" : "#fff",
        color:      down ? "#fff" : "#000",
        display:"grid", gap:5,
        cursor:"pointer",
      }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:14,
        letterSpacing:0.4, textTransform:"lowercase",
        fontWeight:700,
      }}>{c.label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, opacity:0.78 }}>{c.sub}</div>
    </button>
  );
}

// Right column during onboarding
function OnboardingFieldPreview({ answers, stepIdx }) {
  // Contextual log — the headline counts are pulled out into the Stat strip
  // above, so this stays the narrative of what the agent is doing with you.
  const lines = [
    "getting a read on what you need…",
    answers.intent ? `you're after: "${truncate(answers.intent, 40)}"` : null,
    stepIdx >= 1 ? "taking in what's on your mind…" : null,
    answers.edges ? `noted: ${truncate(answers.edges, 40)}` : null,
    stepIdx >= 2 ? "marking what to steer you clear of…" : null,
    answers["off-limits"] ? `off-limits: ${truncate(answers["off-limits"], 40)}` : null,
    stepIdx >= 3 ? "setting how i'll work for you…" : null,
  ].filter(Boolean);

  return (
    <div style={{
      padding:"20px 26px 18px",
      display:"flex", flexDirection:"column", gap:8,
      overflow:"hidden", flex:1, minHeight:0,
    }}>
      {/* legible headline counts, using the shared Stat component */}
      <div style={{ display:"flex", gap:28, margin:"4px 0 10px" }}>
        <Stat value="184" label="indexed"/>
        <Stat value="62" label="online now" accent/>
      </div>

      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        fontFamily:"var(--mac-mono)", fontSize:13,
        color:"#000", lineHeight:1.7,
        display:"grid", gap:6, alignContent:"start",
      }}>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{
            animationDelay:`${i*60}ms`,
            display:"flex", gap:8, alignItems:"baseline",
          }}>
            <span style={{ color:"#FF8A00", fontWeight:700 }}>·</span>
            <span style={{
              fontWeight: i === lines.length - 1 ? 700 : 400,
            }}>{l}</span>
          </div>
        ))}
        {stepIdx >= 1 && <FieldGlyph/>}
      </div>
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
    "reaching out across the network…",
    "filtering people you'd rather not see…",
    "opening the field.",
  ];
  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
    }}>
      <MacWindow title="index · calibrating" style={{ width: 420 }}>
        <div style={{ padding:"26px 28px 24px", textAlign:"center" }}>
          <div style={{
            display:"flex", justifyContent:"center",
            gap:10, alignItems:"center", marginBottom:18,
          }}>
            <LiveDot size={9}/>
            <span style={{
              fontFamily:"var(--mac-mono)",
              letterSpacing:3, fontSize:13, textTransform:"uppercase",
            }}>index</span>
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
              fontSize: 15,
              color: i === lines.length - 1 ? "#000" : "var(--ink-2)",
              letterSpacing:0.2,
              padding:"4px 0",
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
