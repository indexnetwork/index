// NewIntent — opening → prepare → recovery (once) → create. The summary only
// returns when a create fails, to edit and retry.

const INTENT_STEP = {
  id: "intent",
  kind: "ask",
  prompt: "who are you trying to meet right now?",
  placeholder: "type what you're looking for…",
  examples: [
    "traveling soon, want to meet cool people in ai",
    "building something, want honest feedback on it",
    "just launched, want cool people to try it",
    "new in town, want to find my people",
    "raising soon, want to meet investors who get it",
    "hiring soon, want to meet great people early",
    "have an idea, want someone to build it with",
  ],
};

function NewIntent({ onDone, onBack }) {
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;

  const [turns, setTurns] = useState([]);
  const [stage, setStage] = useState("opening");
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [recoveryFields, setRecoveryFields] = useState([]);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [finalDescription, setFinalDescription] = useState("");
  const inputRef = useRef(null);

  const payloadRef = useRef("");
  const preparationReceiptRef = useRef("");
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const stepIdx = stage === "opening" ? 1 : 2;

  useEffect(() => {
    setDraft("");
    if (inputRef.current && stage === "opening") {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [stage, thinking]);

  const runPrepare = async (answers = []) => {
    setThinking(true);
    try {
      const result = await client.intents.prepare({
        payload: payloadRef.current,
        ...(answers.length > 0 ? { answers } : {}),
      });
      if (cancelledRef.current) return;
      payloadRef.current = result.payload;
      setFinalDescription(result.payload);
      // No approval step: a ready draft is created as it stands. After the one
      // recovery form it is created regardless, and the server's own
      // preparation has the last word.
      if (result.status === "ready") {
        preparationReceiptRef.current = result.preparationReceipt;
        setThinking(false);
        void create(result.payload);
        return;
      }
      if (!recoveryUsed) {
        setFeedback(result.feedback);
        setRecoveryFields(result.recovery ?? []);
        setRecoveryUsed(true);
        setStage("recovery");
        setThinking(false);
        return;
      }
      preparationReceiptRef.current = "";
      setThinking(false);
      void create(result.payload);
    } catch (_e) {
      if (cancelledRef.current) return;
      setStage("retry");
      setThinking(false);
    }
  };

  const submitOpening = (value) => {
    const answer = String(value ?? draft).trim();
    if (!answer) return;
    setTurns([{ id: "intent", prompt: INTENT_STEP.prompt, answer }]);
    payloadRef.current = answer;
    if (!client) { setCalibrating(true); onDone({ intent: answer }, false, null); return; }
    void runPrepare();
  };

  const submitRecovery = (answers) => {
    void runPrepare(answers);
  };

  const create = async (description) => {
    if (calibrating || !description.trim() || description.length > 65_536) return;
    setCalibrating(true);
    try {
      const created = await client.intents.create({ description, preparationReceipt: preparationReceiptRef.current });
      if (cancelledRef.current) return;
      onDone({ intent: description }, true, created.intentId);
    } catch (_e) {
      if (cancelledRef.current) return;
      setCalibrating(false);
      setStage("summary");
      setFeedback(`that didn't go through — ${(_e && _e.message) || "try again."}`);
    }
  };

  // Once the follow-up answers are in, the next thing is the signal itself,
  // so that wait goes straight to the calibrating card.
  if (calibrating || (thinking && recoveryUsed)) return <Calibrating/>;

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
        <MacWindow title="calibrating" onClose={onBack}>
          <div style={{ padding:"18px 28px 12px", display:"flex", flexDirection:"column", flex:1, minHeight:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <button onClick={onBack} style={{
                fontFamily:"var(--mac-mono)", fontSize:13, color:"#000",
                background:"transparent", border:"none", padding:0, cursor:"pointer",
              }}>← back</button>
              <div style={{ flex:1 }}/>
            </div>

            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:24 }}>
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:11, color:"#8f8f88",
                letterSpacing:"0.05em", flex:"0 0 auto",
              }}>step {stepIdx} of 2</span>
              <div style={{ flex:1, display:"flex", gap:3 }}>
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} style={{
                    flex:1, height:8, border:"1px solid #000",
                    background: i < stepIdx - 1 ? "#000" : i === stepIdx - 1 ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)" : "#fff",
                  }}/>
                ))}
              </div>
            </div>

            {/* Reaches the window's edge so the scrollbar sits on the outer
                line; the 28px inset is carried inside instead. */}
            <div className="mac-scroll" style={{
              flex:1, minHeight:0, overflowY:"auto",
              display:"flex", flexDirection:"column", gap:20,
              marginRight:-28, paddingRight:28, paddingBottom:18,
            }}>
              {turns.map((t) => (
                <PastTurn key={t.id} step={{ prompt: t.prompt }} answer={t.answer}/>
              ))}

              {thinking ? (
                <div className="fade-up" style={{ display:"grid", gap:10 }}>
                  <AgentBubble><WorkingDots/></AgentBubble>
                </div>
              ) : stage === "retry" ? (
                <div className="fade-up" style={{ display:"grid", gap:12 }}>
                  <AgentBubble>couldn't reach your agent.</AgentBubble>
                  <div style={{ marginLeft:36 }}>
                    <Btn primary onClick={() => runPrepare()}>try again</Btn>
                  </div>
                </div>
              ) : stage === "summary" ? (
                <div className="fade-up" style={{ display:"grid", gap:12 }}>
                  <AgentBubble>Here's your signal.</AgentBubble>
                  <SignalSummaryCard
                    description={finalDescription}
                    onChange={setFinalDescription}
                    note={feedback}
                    canCreate={!!preparationReceiptRef.current}
                    onCreate={() => create(finalDescription)}
                    onRecheck={() => runPrepare()}
                  />
                </div>
              ) : stage === "recovery" ? (
                <RecoveryFormView
                  fields={recoveryFields}
                  feedback={feedback}
                  onSubmit={submitRecovery}
                />
              ) : (
                <div className="fade-up" style={{ display:"grid", gap:10 }}>
                  <AgentBubble label={<TurnLabel/>}>{INTENT_STEP.prompt}</AgentBubble>
                  <div style={{ marginLeft:42, display:"grid", gap:10 }}>
                    {/* One composer box: the send button lives inside it, on a
                        footer strip under the text, rather than as a second box
                        standing beside it. */}
                    <form onSubmit={(e) => { e.preventDefault(); submitOpening(); }} style={{
                      maxWidth:620, border:"1px solid #000", background:"#fff",
                      display:"flex", flexDirection:"column",
                    }}>
                      <textarea
                        ref={inputRef}
                        value={draft}
                        maxLength={65_536}
                        rows={3}
                        onChange={e => setDraft(e.target.value)}
                        placeholder={INTENT_STEP.placeholder}
                        style={{
                          background:"transparent", border:"none", outline:"none",
                          color:"#111", fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.45,
                          resize:"vertical", padding:"11px 14px 4px",
                        }}
                      />
                      <div style={{ display:"flex", justifyContent:"flex-end", padding:"0 8px 8px" }}>
                        <Btn primary small type="submit" disabled={!draft.trim()}>send →</Btn>
                      </div>
                    </form>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                      {INTENT_STEP.examples.map(ex => (
                        <OptionChip key={ex} label={ex} onClick={() => submitOpening(ex)}/>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </MacWindow>

        <MacWindow title="the field, warming">
          <NewIntentFieldPreview turns={turns} stepIdx={stepIdx}/>
        </MacWindow>
      </div>
    </div>
  );
}

function RecoveryFormView({ fields, feedback, onSubmit }) {
  const [singleSelected, setSingleSelected] = useState({});
  const [multiSelected, setMultiSelected] = useState({});
  const [textValues, setTextValues] = useState({});
  // choice fields whose "write your own" box is open; what's typed there
  // lives in textValues, same as a text field's answer
  const [writing, setWriting] = useState({});
  const setText = (fieldId, value) => setTextValues((current) => ({ ...current, [fieldId]: value }));
  const setWrite = (fieldId, open) => setWriting((current) => ({ ...current, [fieldId]: open }));

  const toggleMulti = (fieldId, label) => {
    setMultiSelected((current) => {
      const selected = current[fieldId] ?? [];
      return {
        ...current,
        [fieldId]: selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label],
      };
    });
  };

  const handleSubmit = () => {
    const answers = fields.flatMap((field) => {
      if (field.kind === "text") {
        const answer = textValues[field.id]?.trim();
        return answer ? [{ prompt: field.label, answer }] : [];
      }
      const own = writing[field.id] ? textValues[field.id]?.trim() : "";
      if (field.kind === "single") {
        const answer = own || singleSelected[field.id]?.trim();
        return answer ? [{ prompt: field.label, answer }] : [];
      }
      const answer = [...(multiSelected[field.id] ?? []), ...(own ? [own] : [])].join(" — ");
      return answer ? [{ prompt: field.label, answer }] : [];
    });
    onSubmit(answers);
  };

  return (
    <div className="fade-up" style={{ display:"grid", gap:16 }}>
      <AgentBubble label={<TurnLabel/>}>
        {feedback || "help me understand what you're looking for."}
      </AgentBubble>
      <div style={{ marginLeft:42, display:"grid", gap:18, maxWidth:620 }}>
        {fields.map((field) => (
          <div key={field.id}>
            <div style={{ fontFamily:"var(--mac-sans)", fontSize:14, fontWeight:700, marginBottom:8 }}>{field.label}</div>
            {field.kind === "text" && (
              <textarea
                value={textValues[field.id] ?? ""}
                onChange={(e) => setTextValues((current) => ({ ...current, [field.id]: e.target.value }))}
                placeholder={field.placeholder ?? "type your answer…"}
                rows={2}
                style={{
                  width:"100%", boxSizing:"border-box", padding:10, border:"1px solid #000",
                  fontFamily:"var(--mac-sans)", fontSize:14,
                }}
              />
            )}
            {field.kind === "single" && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {(field.options ?? []).map((option) => {
                  const checked = !writing[field.id] && singleSelected[field.id] === option.label;
                  return (
                    <OptionChip
                      key={option.label}
                      label={option.label}
                      selected={checked}
                      onClick={() => {
                        setSingleSelected((current) => ({
                          ...current,
                          [field.id]: checked ? "" : option.label,
                        }));
                        // one answer: picking a chip replaces what was typed
                        setWrite(field.id, false);
                        setText(field.id, "");
                      }}
                    />
                  );
                })}
                <WriteOwn
                  open={!!writing[field.id]}
                  value={textValues[field.id] ?? ""}
                  onOpen={() => { setSingleSelected((current) => ({ ...current, [field.id]: "" })); setWrite(field.id, true); }}
                  onChange={(value) => setText(field.id, value)}
                  onClose={() => setWrite(field.id, false)}
                />
              </div>
            )}
            {field.kind === "multi" && (
              <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {(field.options ?? []).map((option) => {
                  const checked = (multiSelected[field.id] ?? []).includes(option.label);
                  return (
                    <OptionChip
                      key={option.label}
                      label={option.label}
                      selected={checked}
                      onClick={() => toggleMulti(field.id, option.label)}
                    />
                  );
                })}
                {/* many answers: what's typed goes in alongside the chips */}
                <WriteOwn
                  open={!!writing[field.id]}
                  value={textValues[field.id] ?? ""}
                  onOpen={() => setWrite(field.id, true)}
                  onChange={(value) => setText(field.id, value)}
                  onClose={() => setWrite(field.id, false)}
                />
              </div>
            )}
          </div>
        ))}
        <Btn primary onClick={handleSubmit}>create signal</Btn>
      </div>
    </div>
  );
}

// The "write your own" chip from the conversation's question cards: a chip
// until clicked, then an input in the same box. Closes again if left empty.
function WriteOwn({ open, value, onOpen, onChange, onClose }) {
  if (!open) return <OptionChip write label="write your own" onClick={onOpen}/>;
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => { if (!e.currentTarget.value.trim()) onClose(); }}
      onKeyDown={(e) => { if (e.key === "Escape" && !e.currentTarget.value.trim()) onClose(); }}
      placeholder="write your own"
      aria-label="Write your own answer"
      style={{
        flex:"1 1 220px", minWidth:180, minHeight:36,
        border:"1px solid #000", padding:"8px 14px",
        fontFamily:"var(--mac-mono)", fontSize:12, color:"#111", outline:"none",
      }}
    />
  );
}

function AgentBubble({ children, label = null, muted = false }) {
  return (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
      <MyAgentAvatar size={30} style={{ marginTop:2 }}/>
      <div style={{ flex:1, minWidth:0 }}>
        {label}
        <div style={{
          maxWidth:"92%", background:"#fff",
          fontFamily:"var(--mac-sans)",
          fontSize:14, fontWeight: muted ? 400 : 700,
          lineHeight:1.55, color: muted ? "#2a2a2a" : "#111",
        }}>{children}</div>
      </div>
    </div>
  );
}

function TurnLabel({ who = "your agent" }) {
  return (
    <div style={{
      marginBottom:6, color:"#8f8f88",
      fontFamily:"var(--mac-mono)", fontSize:11,
      textTransform:"uppercase", letterSpacing:"0.05em",
    }}>{who}</div>
  );
}

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
    <div style={{ display:"flex", justifyContent:"flex-end" }}>
      <div style={{
        maxWidth:"92%", padding:"11px 14px",
        background:"#2a2a2a", color:"#fff", borderRadius:"4px 4px 2px 4px",
        fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.5,
        wordBreak:"break-word",
      }}>{children}</div>
    </div>
  );
}

function PastTurn({ step, answer }) {
  return (
    <div style={{ display:"grid", gap:10 }}>
      <AgentBubble muted label={<TurnLabel/>}>{step.prompt}</AgentBubble>
      <UserBubble>{answer}</UserBubble>
    </div>
  );
}

function SignalSummaryCard({ description, onChange, note, canCreate, onCreate, onRecheck }) {
  return (
    <div style={{ marginLeft:36, maxWidth:560, display:"grid", gap:14 }}>
      <div style={{ borderLeft:"2px solid #000", paddingLeft:14, display:"grid", gap:8 }}>
        <textarea
          aria-label="Signal description"
          value={description}
          onChange={(event) => onChange(event.target.value)}
          maxLength={65_536}
          rows={6}
          style={{
            width:"100%", boxSizing:"border-box", padding:10, border:"1px solid #000",
            fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500,
            lineHeight:1.4, color:"#000", background:"#fff", resize:"vertical",
          }}
        />
        {note && (
          <div style={{
            fontFamily:"var(--mac-sans)", fontSize:12.5, fontStyle:"italic",
            lineHeight:1.5, color:"var(--ink-2)",
          }}>{note}</div>
        )}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        {canCreate ? (
          <Btn primary disabled={!description.trim() || description.length > 65_536} onClick={onCreate}>create this signal</Btn>
        ) : (
          <Btn primary disabled={!description.trim()} onClick={onRecheck}>check signal</Btn>
        )}
      </div>
    </div>
  );
}

function NewIntentFieldPreview({ turns, stepIdx }) {
  const lines = [
    "getting a read on what you need…",
    turns[0] ? `you're after: "${truncate(turns[0].answer, 40)}"` : null,
    stepIdx >= 2 ? "sharpening the edges…" : null,
  ].filter(Boolean);

  return (
    <div style={{ padding:"20px 26px 18px", display:"flex", flexDirection:"column", gap:8, overflow:"hidden", flex:1, minHeight:0 }}>
      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        fontFamily:"var(--mac-mono)", fontSize:13,
        color:"#000", lineHeight:1.7,
        display:"grid", gap:6, alignContent:"start",
      }}>
        {lines.map((l, i) => (
          <div key={i} className="fade-up" style={{ animationDelay:`${i*60}ms`, display:"flex", gap:8, alignItems:"baseline" }}>
            <span style={{ color:"#FF8A00", fontWeight:700 }}>·</span>
            <span style={{ fontWeight: i === lines.length - 1 ? 700 : 400 }}>{l}</span>
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
      <div style={{ position:"absolute", left:"50%", top:"50%", width:10, height:10, marginLeft:-5, marginTop:-5, background:"#000" }}/>
      {[36, 56, 78].map((r, i) => (
        <div key={r} style={{
          position:"absolute", left:"50%", top:"50%",
          width: r*2, height: r*2, marginLeft:-r, marginTop:-r,
          border:"1px dashed #000", borderRadius:999,
          animation:`mac-orbit ${22 + i*8}s linear infinite`,
        }}>
          <div style={{ position:"absolute", left:"50%", top:0, transform:"translateX(-50%)", width:6, height:6, background:"#000" }}/>
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
    <div style={{ position:"absolute", inset:0, display:"grid", placeItems:"center", gridTemplateColumns:"minmax(0, 1fr)" }}>
      <MacWindow title="calibrating" style={{ width: 420 }}>
        <div style={{ padding:"26px 28px 24px", textAlign:"center" }}>
          <div style={{ display:"flex", justifyContent:"center", gap:10, alignItems:"center", marginBottom:18 }}>
            <LiveDot size={9}/>
            <span style={{ fontFamily:"var(--mac-mono)", letterSpacing:3, fontSize:13, textTransform:"uppercase" }}>index</span>
          </div>
          <div style={{ border:"1px solid #000", height: 10, overflow:"hidden", margin:"0 auto 18px", background: "#fff" }}>
            <div style={{ height:"100%", backgroundImage:"repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)", animation:"mac-stripes 0.8s linear infinite", backgroundSize: "24px 24px" }}/>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="fade-up" style={{
              animationDelay:`${i * 350}ms`, fontFamily:"var(--mac-sans)", fontSize: 15,
              color: i === lines.length - 1 ? "#000" : "var(--ink-2)",
              letterSpacing:0.2, padding:"4px 0",
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
