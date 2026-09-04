// NewIntent — the signal-creation flow. Mac System 6 chrome, conversational.
// + Calibrating screen.
//
// The agent asks, you answer, it asks again. The opening answer is the signal;
// each follow-up comes from /intents/clarify, which folds the answers back into
// the payload. Then you confirm what was written and it goes out everywhere.

// The opening prompt: the user's first answer IS the signal, handed to the
// agent to clarify. No suggestion chips — whatever they type drives it.
const INTENT_STEP = {
  id: "intent",
  kind: "ask",
  prompt: "who are you trying to meet right now?",
  placeholder: "type what you're looking for…",
};

// How many clarifying questions follow the opening prompt. Caps the loop and
// drives the progress pips (opening + middle beats).
const MAX_FOLLOW_UPS = 2;
const STEP_COUNT = 1 + MAX_FOLLOW_UPS;

function NewIntent({ onDone, onBack }) {
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;

  // Completed turns drive the progress bar and the faded history; the current
  // step is the opening prompt, a clarifying question, or one of the two gates.
  const [turns, setTurns] = useState([]);
  const [step, setStep] = useState(() => INTENT_STEP);
  const [thinking, setThinking] = useState(false);
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);

  // The payload as it currently reads. Clarify rewrites it; create persists it.
  const payloadRef = useRef("");
  const queue = useRef([]);            // clarifying questions not yet asked
  const pending = useRef([]);          // answers not yet folded into the payload
  const askedRef = useRef(0);          // clarifying questions asked so far
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const stepIdx = Math.min(turns.length, STEP_COUNT - 1);
  const stepId = step && step.id;

  useEffect(() => {
    setDraft("");
    if (inputRef.current) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [stepId, thinking]);

  const showQuestion = (question) => {
    askedRef.current += 1;
    setThinking(false);
    setStep({
      id: `q-${askedRef.current}-${Date.now()}`,
      kind: "ask",
      prompt: question.prompt,
      placeholder: "type your answer…",
      examples: (question.options || []).map((option) => option.label).filter(Boolean),
    });
  };

  const showSummary = (note) => {
    setThinking(false);
    setStep({ id: `summary-${Date.now()}`, kind: "summary", note: note || "" });
  };

  // The agent could not be reached. The answers are kept, so retrying resumes
  // the same round rather than restarting the conversation.
  const showRetry = () => {
    setThinking(false);
    setStep({
      id: `retry-${Date.now()}`,
      kind: "retry",
      prompt: "couldn't reach your agent.",
      note: "your answers are kept.",
    });
  };

  // One clarification round: the answers gathered since the last one get folded
  // into the payload, and whatever is still worth asking comes back.
  const clarify = async () => {
    setThinking(true);
    try {
      const answers = pending.current;
      const result = await client.intents.clarify({
        payload: payloadRef.current,
        ...(answers.length > 0 ? { answers } : {}),
      });
      if (cancelledRef.current) return;
      payloadRef.current = result.payload;
      pending.current = [];
      queue.current = result.questions || [];
      advance();
    } catch (_e) {
      if (cancelledRef.current) return;
      showRetry();
    }
  };

  // Next beat: another question while there is budget and something to ask,
  // one more clarification round to fold in what was just answered, else the
  // summary.
  const advance = () => {
    if (askedRef.current >= MAX_FOLLOW_UPS) {
      if (pending.current.length > 0) { void clarify(); return; }
      showSummary();
      return;
    }
    if (queue.current.length > 0) { showQuestion(queue.current.shift()); return; }
    if (pending.current.length > 0) { void clarify(); return; }
    showSummary();
  };

  const submit = (value) => {
    const raw = value ?? draft;
    const answer = String(raw).trim();
    if (!answer) return;
    setTurns((prev) => [...prev, { id: step.id, prompt: step.prompt, answer }]);

    if (step.id === "intent") {
      payloadRef.current = answer;
      // Signed out (the prototype walkthrough) there is nothing to clarify
      // against; the caller renders the signal locally.
      if (!client) { setCalibrating(true); onDone({ intent: answer }, false, null); return; }
      void clarify();
      return;
    }
    pending.current = [...pending.current, { prompt: step.prompt, answer }];
    advance();
  };

  const create = async () => {
    setCalibrating(true);
    try {
      const description = payloadRef.current.trim();
      const created = await client.intents.create({ description });
      if (cancelledRef.current) return;
      onDone({ intent: description }, true, created.intentId);
    } catch (_e) {
      if (cancelledRef.current) return;
      setCalibrating(false);
      showSummary("that didn't go through — try again.");
    }
  };

  if (calibrating) return <Calibrating/>;

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{
        width: 980, maxWidth:"100%",
        display:"grid", gridTemplateColumns:"minmax(0, 1.4fr) minmax(0, 1fr)", gap:18,
        height: "min(720px, calc(100vh - 128px))",
      }}>
        {/* LEFT, conversation window */}
        <MacWindow title="calibrating" onClose={onBack}>
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

            {/* progress, pinstripe segments */}
            <div style={{ display:"flex", gap:3, marginBottom:24 }}>
              {Array.from({ length: STEP_COUNT }).map((_, i) => (
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
              {turns.map((t) => (
                <PastTurn key={t.id} step={{ prompt: t.prompt }} answer={t.answer}/>
              ))}

              {thinking ? (
                <div key="thinking" className="fade-up" style={{ display:"grid", gap:10 }}>
                  <AgentBubble>
                    <span style={{
                      color:"var(--ink-2)", display:"inline-flex",
                      alignItems:"center",
                    }}>
                      <WorkingDots/>
                    </span>
                  </AgentBubble>
                </div>
              ) : step.kind === "retry" ? (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:12 }}>
                <AgentBubble>{step.prompt}</AgentBubble>
                <div style={{ marginLeft:36, display:"flex", alignItems:"center", gap:12 }}>
                  <Btn primary onClick={() => clarify()}>try again</Btn>
                  <span style={{
                    fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
                  }}>{step.note}</span>
                </div>
              </div>
              ) : step.kind === "summary" ? (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:12 }}>
                <AgentBubble>Here's your signal.</AgentBubble>
                <SignalSummaryCard
                  description={payloadRef.current}
                  note={step.note}
                  onCreate={create}
                />
              </div>
              ) : (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:10 }}>
                <AgentBubble>{step.prompt}</AgentBubble>

                <div style={{ marginLeft:36, marginTop:10, display:"grid", gap:16 }}>
                  {/* type your own answer first, the suggestions are the
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
                  {step.examples && step.examples.length > 0 && (
                    <React.Fragment>
                      <div style={{
                        fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:1,
                        textTransform:"uppercase", color:"var(--ink-3)",
                      }}>or pick one</div>
                      <div style={{
                        display:"grid", gap:7, maxWidth:560,
                      }}>
                        {step.examples.map(ex => (
                          <SuggestChip key={ex} onClick={() => submit(ex)}>{ex}</SuggestChip>
                        ))}
                      </div>
                    </React.Fragment>
                  )}
                </div>
              </div>
              )}
            </div>
          </div>
        </MacWindow>

        {/* RIGHT, the field warming */}
        <MacWindow title="the field, warming">
          <NewIntentFieldPreview turns={turns} stepIdx={stepIdx}/>
        </MacWindow>
      </div>
    </div>
  );
}

// New-intent is the same agent that speaks on the signals page, so it wears the
// same mark. The "h" tile this replaced named the runtime (hermes) at the one
// moment you have no idea what that is, and made your first conversation with
// index look like it came from something else.
function AgentBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
      <MyAgentAvatar size={26} style={{ marginTop:3 }}/>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:21,
        color:"#000", fontWeight:500, lineHeight:1.35, letterSpacing:-0.2,
        maxWidth:620,
      }}>{children}</div>
    </div>
  );
}

/* The agent is doing something and the line has to look like it. A typed-out
   sentence finished typing and then sat there, which read as stuck: the only
   moving thing was gone by the time you looked at it. Three squares taking
   turns run for as long as the work does, on the same blink the live marks in
   the rest of the app use, so "busy" looks the same everywhere. */
function WorkingDots({ size = 8 }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width:size, height:size, background:"#000",
          animation:"mac-blink 1.05s steps(2) infinite",
          animationDelay:`${i * 0.35}s`,
        }}/>
      ))}
    </span>
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
      <UserBubble>{answer}</UserBubble>
    </div>
  );
}

// The confirmation gate, kept quiet: the signal as an indented quote in the
// conversation, small detail lines, one button. No card chrome.
function SignalSummaryCard({ description, note, onCreate }) {
  return (
    <div style={{ marginLeft:36, maxWidth:560, display:"grid", gap:14 }}>
      <div style={{
        borderLeft:"2px solid #000", paddingLeft:14,
        display:"grid", gap:8,
      }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500,
          lineHeight:1.4, color:"#000",
        }}>{description}</div>
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
          lineHeight:1.6,
        }}>going out to · everywhere</div>
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <Btn primary onClick={onCreate}>create this signal</Btn>
        {note && (
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:11,
            color:"#000", fontWeight:700,
          }}>{note}</span>
        )}
      </div>
    </div>
  );
}

// Suggested answer, Workbench gadget sized up to match the question's altitude.
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

// Right column during signal creation
function NewIntentFieldPreview({ turns, stepIdx }) {
  // Just the narrative of what the agent is doing with you.
  const lines = [
    "getting a read on what you need…",
    turns[0] ? `you're after: "${truncate(turns[0].answer, 40)}"` : null,
    stepIdx >= 1 ? "taking in what's on your mind…" : null,
    turns[1] ? `noted: ${truncate(turns[1].answer, 40)}` : null,
    stepIdx >= 2 ? "sharpening the edges…" : null,
    turns[2] ? `noted: ${truncate(turns[2].answer, 40)}` : null,
  ].filter(Boolean);

  return (
    <div style={{
      padding:"20px 26px 18px",
      display:"flex", flexDirection:"column", gap:8,
      overflow:"hidden", flex:1, minHeight:0,
    }}>
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
        {turns.length > 0 && <FieldGlyph/>}
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
      gridTemplateColumns:"minmax(0, 1fr)",
    }}>
      <MacWindow title="calibrating" style={{ width: 420 }}>
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

window.NewIntent = NewIntent;
