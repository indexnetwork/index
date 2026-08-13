/* global useIndexEnv */
// NewIntent — the signal-creation flow. Mac System 6 chrome, conversational.
// + Calibrating screen.
// Live-only: clarifying questions after the opening prompt come from the
// backend (the intake funnel or the chat agent). There is no local scripted
// question set or canned example content.

// The opening prompt: the user's first answer IS the signal, handed to the
// agent to clarify. No suggestion chips — whatever they type drives it.
const INTENT_STEP = {
  id: "intent",
  prompt: "who are you trying to meet right now?",
  placeholder: "type what you're looking for…",
};

// How many dynamic follow-ups follow the opening prompt. Caps the chat
// clarify loop and drives the progress pips (opening + middle beats).
const DYN_MAX = 2;
const STEP_COUNT = 1 + DYN_MAX;

function NewIntent({ onDone, onBack }) {
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const env = useIndexEnv();
  // The web app's deterministic intake funnel (/intents/intake/*), gated by the
  // backend FAST_SIGNAL_INTAKE flag. When off, the chat flow below runs with
  // persona: "signal". When on, start failure shows retry — never chat fallback.
  const fastEnabled = !!(client && env.features && env.features.fastSignalIntake);

  // Completed turns drive the progress bar and the faded history; the current
  // step is either a local scripted one or a backend-generated question.
  const [turns, setTurns] = useState([]);
  const [step, setStep] = useState(() => INTENT_STEP);
  const [thinking, setThinking] = useState(fastEnabled);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);

  const intentIdRef = useRef(null);       // set once the live signal exists
  const createdRef = useRef(false);
  const createdDescriptionRef = useRef(null);
  const answersRef = useRef({});          // mirror of `answers` for async handlers
  const flowStartRef = useRef(Date.now());
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

  // Fold the collected steps into one signal description for create_intent.
  const composeDescription = (a) => {
    const parts = [];
    if (a.intent) parts.push(String(a.intent).trim());
    if (a.edges) parts.push(`a great match: ${String(a.edges).trim()}`);
    if (a["off-limits"]) parts.push(`off-limits: ${String(a["off-limits"]).trim()}`);
    return parts.filter(Boolean).join(" · ");
  };

  // ---- fast intake (the web app's /intents/intake funnel) ------------------
  //
  // Round 1 comes from /start, follow-ups from /question until the locked
  // total, then /prepare starts synthesis while the user chooses where to look.
  // /proposal resolves that speculative work (a 422 carries a clarification
  // question), and a one-button summary gates /intents/confirm. The server holds
  // no funnel session: every call resends the answered rounds.

  const fastRounds = useRef([]);          // [{ prompt, answer }]
  const fastQueue = useRef([]);           // prefetched follow-up questions
  const fastTotal = useRef(null);         // locked question budget
  const fastPrepare = useRef(null);       // in-flight /prepare promise
  const fastRunId = useRef(null);
  const fastProposal = useRef(null);      // resolved proposal shown on the summary
  const fastChoice = useRef({});          // { networkId } or { whereText }, matching web
  const fastWhereLabel = useRef("everywhere");

  const fastCommunities = (env.networks || []).filter((network) => !network.isPersonal);

  const showFastQuestion = (q, kind = "question") => {
    setThinking(false);
    setStep({
      id: `fast-${kind}-${Date.now()}`,
      fast: kind,
      prompt: q.prompt,
      hint: q.evidence || "",
      placeholder: "type your answer…",
      examples: (q.options || []).map((o) => o.label).filter(Boolean),
    });
  };

  const showFastWhere = () => {
    setThinking(false);
    setStep({
      id: `fast-where-${Date.now()}`,
      fast: "where",
      prompt: "where should we look?",
    });
  };

  // Summary gate: rendered as a dedicated card (SignalSummaryCard), not the
  // generic question layout. `choices` stays so submit() resolves the label.
  const showFastSummary = (p, note) => {
    fastProposal.current = p;
    setThinking(false);
    setStep({
      id: `fast-summary-${Date.now()}`,
      fast: "summary",
      prompt: p.description,
      proposal: p,
      whereLabel: fastWhereLabel.current,
      note: note || "",
      choices: [{ value: "create", label: "create this signal", sub: `looking in ${fastWhereLabel.current}` }],
    });
  };

  const showFastRetry = () => {
    setThinking(false);
    setStep({
      id: `fast-retry-${Date.now()}`,
      fast: "retry",
      prompt: "couldn't build your signal.",
      choices: [{ value: "retry", label: "try again", sub: "your answers are kept" }],
    });
  };

  const showFastStartRetry = () => {
    setThinking(false);
    setStep({
      id: `fast-start-retry-${Date.now()}`,
      fast: "start-retry",
      prompt: "couldn't start your signal.",
      choices: [{ value: "retry", label: "try again", sub: "check your connection and retry" }],
    });
  };

  const loadFastStart = () => {
    if (!client) return;
    setThinking(true);
    client.intents.intake.start()
      .then(({ question }) => { if (!cancelledRef.current) showFastQuestion(question); })
      .catch(() => { if (!cancelledRef.current) showFastStartRetry(); });
  };

  // Next follow-up from the queue or the server; once the budget is spent,
  // fire speculative synthesis and move on to the where step.
  const fastAdvance = async () => {
    if (fastQueue.current.length > 0) { showFastQuestion(fastQueue.current.shift()); return; }
    const rounds = fastRounds.current;
    if (fastTotal.current === null || rounds.length < fastTotal.current) {
      try {
        const res = await client.intents.intake.question({
          rounds,
          ...(fastTotal.current !== null ? { plannedTotal: fastTotal.current } : {}),
        });
        if (cancelledRef.current) return;
        fastTotal.current = res.total;
        const qs = res.questions || [];
        if (qs.length > 0 && rounds.length < res.total) {
          fastQueue.current = qs.slice(1);
          showFastQuestion(qs[0]);
          return;
        }
      } catch (_e) { /* proceed with the rounds we have */ }
      if (cancelledRef.current) return;
    }
    fastPrepare.current = client.intents.intake.prepare({ rounds });
    fastPrepare.current.then((r) => { fastRunId.current = r.runId; }).catch(() => {});
    showFastWhere();
  };

  const chooseFastWhere = (choice, label) => {
    fastChoice.current = choice;
    fastWhereLabel.current = label;
    fastResolve();
  };

  const fastResolve = async () => {
    setThinking(true);
    try {
      if (!fastRunId.current && fastPrepare.current) {
        fastRunId.current = await fastPrepare.current.then((r) => r.runId).catch(() => null);
      }
      if (!fastRunId.current) {
        fastRunId.current = (await client.intents.intake.prepare({ rounds: fastRounds.current })).runId;
      }
      const p = await client.intents.intake.proposal({
        runId: fastRunId.current,
        rounds: fastRounds.current,
        ...fastChoice.current,
      });
      if (!cancelledRef.current) showFastSummary(p);
    } catch (e) {
      if (cancelledRef.current) return;
      const body = e && e.response;
      if (body && body.code === "verification_rejected" && body.clarification) {
        showFastQuestion(body.clarification, "clarify");
        return;
      }
      showFastRetry();
    }
  };

  const fastConfirm = async (ans) => {
    setThinking(true);
    try {
      const p = fastProposal.current;
      const res = await client.intents.confirm({
        proposalId: p.proposalId,
        description: p.description,
        ...(fastChoice.current.networkId ? { networkId: fastChoice.current.networkId } : {}),
      });
      if (cancelledRef.current) return;
      if (res && res.intentId) intentIdRef.current = res.intentId;
      createdDescriptionRef.current = p.description;
      createdRef.current = true;
      finish(ans);
    } catch (_e) {
      if (cancelledRef.current) return;
      showFastSummary(fastProposal.current, "that didn't go through — try again.");
    }
  };

  useEffect(() => {
    if (!fastEnabled) return;
    loadFastStart();
    // The intake is one mounted flow. Retrying is an explicit UI action; a
    // client/closure identity change must not silently restart answered rounds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signal intake no longer opens a chat turn. The macOS app authenticates
  // with an API key, and API-key callers cannot start a Signal chat — that
  // persona is web-only, and there is no default persona to fall back on.
  // Clarification comes from the deterministic intake funnel below; without it
  // the flow finishes from the answers already collected.

  const submit = (val) => {
    const raw = val ?? draft;
    const v = String(raw).trim();
    if (!v && !step.choices) return;
    const answerLabel = step.choices
      ? ((step.choices.find((c) => c.value === raw) || {}).label || String(raw))
      : v;
    setTurns((prev) => [...prev, { id: step.id, prompt: step.prompt, answer: answerLabel }]);

    const newAns = { ...answers, [step.id]: raw };
    // Alias dynamic answers onto the prototype's edges/off-limits slots so the
    // field preview and the main view header keep reading naturally.
    if (step.fast === "question" || step.fast === "clarify") {
      if (!newAns.intent) newAns.intent = v;
      else if (!newAns.edges) newAns.edges = v;
      else if (!newAns["off-limits"]) newAns["off-limits"] = v;
    }
    setAnswers(newAns);
    answersRef.current = newAns;

    // Fast-intake steps: each answer extends the resent rounds, exactly like
    // the web funnel.
    if (step.fast) {
      const isChip = (step.examples || []).includes(raw);
      if (step.fast === "question") {
        fastRounds.current = [...fastRounds.current, {
          prompt: step.prompt,
          answer: isChip ? { selectedOptions: [raw] } : { selectedOptions: [], freeText: v },
        }];
        setThinking(true);
        fastAdvance();
      } else if (step.fast === "clarify") {
        // Merges into the last round's free text; it is not a new round and
        // does not count toward the locked total.
        const last = fastRounds.current[fastRounds.current.length - 1];
        last.answer = {
          selectedOptions: last.answer.selectedOptions,
          freeText: [last.answer.freeText, v].filter(Boolean).join(" — "),
        };
        fastResolve();
      } else if (step.fast === "summary") {
        fastConfirm(newAns);
      } else if (step.fast === "retry") {
        fastResolve();
      } else if (step.fast === "start-retry") {
        loadFastStart();
      }
      return;
    }

    // No live client to clarify against — finish from what was answered.
    finish(newAns);
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
              ) : step.fast === "where" ? (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:12 }}>
                <AgentBubble>{step.prompt}</AgentBubble>
                <FastWherePicker networks={fastCommunities} onSelect={chooseFastWhere}/>
              </div>
              ) : step.fast === "summary" ? (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:12 }}>
                <AgentBubble>Here's your signal.</AgentBubble>
                <SignalSummaryCard
                  proposal={step.proposal}
                  whereLabel={step.whereLabel}
                  note={step.note}
                  onCreate={() => submit("create")}
                />
              </div>
              ) : (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:10 }}>
                <AgentBubble>{step.prompt}</AgentBubble>
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
          <NewIntentFieldPreview answers={answers} stepIdx={stepIdx}/>
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
      <UserBubble>{step.choices ? step.choices.find(c => c.value === answer)?.label : answer}</UserBubble>
    </div>
  );
}

// The fast-intake summary gate, kept quiet: the signal as an indented quote in
// the conversation, small detail lines, one button. No card chrome.
function FastWherePicker({ networks, onSelect }) {
  const [whereText, setWhereText] = useState("");
  return (
    <div style={{ marginLeft:36, maxWidth:560, display:"grid", gap:10 }}>
      {networks.map((network) => (
        <ChoiceRow
          key={network.id}
          c={{ value:network.id, label:network.name, sub:"look in this community" }}
          onClick={() => onSelect({ networkId:network.id }, network.name)}
        />
      ))}
      <ChoiceRow
        c={{ value:"everywhere", label:"Everywhere", sub:"no community or place constraint" }}
        onClick={() => onSelect({}, "everywhere")}
      />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = whereText.trim();
          if (value) onSelect({ whereText:value }, value);
        }}
        style={{ display:"flex", gap:12, alignItems:"center", marginTop:6 }}
      >
        <input
          value={whereText}
          onChange={(event) => setWhereText(event.target.value)}
          placeholder="Somewhere more specific?"
          style={{
            flex:1, background:"#fff", border:"none", borderBottom:"1px solid #000",
            outline:"none", color:"#000", fontFamily:"var(--mac-sans)", fontSize:15,
            padding:"7px 0",
          }}
        />
        <Btn primary type="submit" disabled={!whereText.trim()}>continue</Btn>
      </form>
      <div style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>
        naming a place rewrites your signal, so it takes a moment longer.
      </div>
    </div>
  );
}

function SignalSummaryCard({ proposal, whereLabel, note, onCreate }) {
  return (
    <div style={{ marginLeft:36, maxWidth:560, display:"grid", gap:14 }}>
      <div style={{
        borderLeft:"2px solid #000", paddingLeft:14,
        display:"grid", gap:8,
      }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500,
          lineHeight:1.4, color:"#000",
        }}>{proposal.description}</div>
        {(proposal.lookingFor || proposal.youBring || whereLabel) && (
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)",
            lineHeight:1.6, display:"grid", gap:2,
          }}>
            {proposal.lookingFor && <div>looking for · {proposal.lookingFor}</div>}
            {proposal.youBring && <div>you bring · {proposal.youBring}</div>}
            {whereLabel && <div>looking in · {whereLabel}</div>}
          </div>
        )}
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

// Right column during signal creation
function NewIntentFieldPreview({ answers, stepIdx }) {
  // Just the narrative of what the agent is doing with you.
  const lines = [
    "getting a read on what you need…",
    answers.intent ? `you're after: "${truncate(answers.intent, 40)}"` : null,
    stepIdx >= 1 ? "taking in what's on your mind…" : null,
    answers.edges ? `noted: ${truncate(answers.edges, 40)}` : null,
    stepIdx >= 2 ? "marking what to steer you clear of…" : null,
    answers["off-limits"] ? `off-limits: ${truncate(answers["off-limits"], 40)}` : null,
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
