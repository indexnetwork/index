// Onboarding — mobile. Single-column conversational calibration. The desktop's
// side "field warming" window is dropped to a compact counts strip; the input
// is pinned to the bottom so it sits above the keyboard.

function resolveStep(baseStep, answers) {
  if (baseStep.id === "edges" && answers.intent) return { ...baseStep, ...followUpFor(answers.intent) };
  if (baseStep.id === "off-limits" && answers.intent) return { ...baseStep, ...offLimitsFor(answers.intent) };
  return baseStep;
}

function offLimitsFor(intent) {
  const t = (intent || "").toLowerCase();
  if (/(feedback|\bidea\b|business|startup|launch|validate|pitch)/.test(t)) {
    return { placeholder: "no investors in pitch mode · skip direct competitors…",
      examples: ["no investors pitching me", "skip direct competitors", "no 'you should pivot' takes"] };
  }
  if (/(open.?source|contribut|\brepo\b|github|maintainer|\boss\b)/.test(t)) {
    return { placeholder: "no recruiters · skip crypto projects…",
      examples: ["no recruiters", "skip crypto projects", "no vague 'let's collab'"] };
  }
  if (/(co.?founder|cofounder|\bpartner\b|start a company|build a company)/.test(t)) {
    return { placeholder: "no idea-only people · skip anyone not ready to commit…",
      examples: ["no idea-only people", "skip the not-ready-to-commit", "no recruiters"] };
  }
  if (/(\bai\b|\bml\b|machine learning|\bmodel|\bllm)/.test(t)) {
    return { placeholder: "no recruiters · skip web3 / crypto…",
      examples: ["no recruiters", "skip web3 / crypto", "no hard-sell mode"] };
  }
  return { placeholder: "no recruiters · skip sales pitches…",
    examples: ["no recruiters", "skip sales pitches", "no crypto"] };
}

function followUpFor(intent) {
  const t = (intent || "").toLowerCase();
  if (/(feedback|\bidea\b|business|startup|launch|validate|pitch)/.test(t)) {
    return { prompt: "what's the idea, in a sentence?",
      hint: "rough is fine. i'll look for people who've been near this problem.",
      placeholder: "a payments tool for small crews · an ai notetaker for therapists…",
      examples: ["a payments tool for small crews", "an AI notetaker for therapists", "a marketplace for vintage synths"] };
  }
  if (/(open.?source|contribut|\brepo\b|github|maintainer|\boss\b)/.test(t)) {
    return { prompt: "what do you like to build with?",
      hint: "languages, stacks, the kind of problem you enjoy.",
      placeholder: "rust + systems · typescript + dev tools · python + ml…",
      examples: ["rust + systems work", "typescript + developer tooling", "python + ml infra"] };
  }
  if (/(co.?founder|cofounder|\bpartner\b|start a company|build a company)/.test(t)) {
    return { prompt: "what do you bring, and where's the gap?",
      hint: "your strength plus what you're missing lets me match the complement.",
      placeholder: "technical, need someone commercial…",
      examples: ["technical, need someone commercial", "strong on product, weak on sales", "can sell, need an engineer"] };
  }
  if (/(\bai\b|\bml\b|machine learning|\bmodel|\bllm)/.test(t)) {
    return { prompt: "what corner of AI are you in right now?",
      hint: "the part you're closest to helps me find your people.",
      placeholder: "agents + tool use · evals + interpretability…",
      examples: ["agents and tool use", "evals and interpretability", "open-weights tinkering"] };
  }
  return { prompt: "what're you into these days?",
    hint: "what's on your mind. it helps me pattern-match.",
    placeholder: "a side project i'm shipping · getting back into climbing…",
    examples: ["a side project i'm shipping", "getting back into climbing", "reading more this year"] };
}

function Onboarding({ onDone, onBack }) {
  const { ONBOARDING_STEPS } = window.HALO_DATA;
  const [stepIdx, setStepIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const step = resolveStep(ONBOARDING_STEPS[stepIdx], answers);

  useEffect(() => {
    setDraft("");
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
    <div className="mob-desktop" style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
      <div style={{
        flex:"0 0 auto", padding:"10px 16px", borderBottom:"2px solid #000", background:"#fff",
        display:"flex", alignItems:"center", gap:12,
      }}>
        <button onClick={onBack} style={{
          fontFamily:"var(--mac-mono)", fontSize:13, color:"#000",
          background:"transparent", border:"none", padding:0, cursor:"pointer",
        }}>← back</button>
        {/* progress pinstripe */}
        <div style={{ flex:1, display:"flex", gap:3 }}>
          {ONBOARDING_STEPS.map((_, i) => (
            <div key={i} style={{
              flex:1, height:8, border:"1px solid #000",
              background: i < stepIdx ? "#000"
                : i === stepIdx ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)"
                : "#fff",
            }}/>
          ))}
        </div>
      </div>

      {/* compact field strip */}
      <div style={{
        flex:"0 0 auto", padding:"8px 16px", background:"#fff", borderBottom:"1px solid #ccc",
        display:"flex", alignItems:"center", gap:18,
      }}>
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:9.5, letterSpacing:1.5, textTransform:"uppercase", color:"#555" }}>field warming</span>
        <span style={{ fontFamily:"var(--mac-sans)", fontSize:13 }}><b>184</b> indexed</span>
        <span style={{
          fontFamily:"var(--mac-sans)", fontSize:13, fontWeight:700,
          background:"#FF8A00", border:"1px solid #000", padding:"0 6px",
          boxShadow:"inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500",
        }}>62 online</span>
      </div>

      <div ref={scrollRef} className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        padding:"18px 16px 18px", display:"flex", flexDirection:"column", gap:20, background:"#fff",
      }}>
        {ONBOARDING_STEPS.slice(0, stepIdx).map((s) => (
          <PastTurn key={s.id} step={resolveStep(s, answers)} answer={answers[s.id]}/>
        ))}

        <div key={step.id} className="fade-up" style={{ display:"grid", gap:10 }}>
          <AgentBubble><StreamText text={step.prompt} speed={18}/></AgentBubble>
          {step.hint && (
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:12.5, color:"#555",
              marginLeft:36, marginTop:-2, lineHeight:1.4,
            }}>{step.hint}</div>
          )}
          <div style={{ marginLeft:36, marginTop:8, display:"grid", gap:14 }}>
            {step.choices ? (
              <div style={{ display:"grid", gap:8 }}>
                {step.choices.map(c => <ChoiceRow key={c.value} c={c} onClick={() => submit(c.value)}/>)}
              </div>
            ) : (
              <React.Fragment>
                <div style={{
                  fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:1,
                  textTransform:"uppercase", color:"#888",
                }}>or pick one</div>
                <div style={{ display:"grid", gap:8 }}>
                  {step.examples?.map(ex => (
                    <SuggestChip key={ex} onClick={() => submit(ex)}>{ex}</SuggestChip>
                  ))}
                </div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>

      {/* pinned input (hidden on choice steps) */}
      {!step.choices && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}
          style={{
            flex:"0 0 auto", borderTop:"2px solid #000", background:"#fff",
            padding:"8px 14px calc(8px + var(--safe-bottom))",
            display:"flex", gap:10, alignItems:"center",
          }}>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:17, color:"#000" }}>›</span>
          <input
            ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={step.placeholder}
            style={{
              flex:1, background:"#fff", border:"none", borderBottom:"1px solid #000",
              outline:"none", color:"#000", fontFamily:"var(--mac-sans)", fontSize:16, padding:"7px 0",
            }}
          />
          <Btn primary small onClick={() => submit()}>send ↵</Btn>
        </form>
      )}
    </div>
  );
}

function AgentBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
      <div style={{
        width:26, height:26, border:"1px solid #000",
        display:"grid", placeItems:"center", flex:"0 0 auto", marginTop:3,
        background:"#000", color:"#fff",
      }}>
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:600 }}>h</span>
      </div>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:19, color:"#000",
        fontWeight:500, lineHeight:1.35, letterSpacing:-0.2,
      }}>{children}</div>
    </div>
  );
}

function UserBubble({ children }) {
  return (
    <div style={{ display:"flex", gap:12, marginLeft:38 }}>
      <span style={{ color:"#666", fontFamily:"var(--mac-mono)", fontSize:14 }}>›</span>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:15, color:"#000", fontStyle:"italic" }}>{children}</div>
    </div>
  );
}

function PastTurn({ step, answer }) {
  return (
    <div style={{ display:"grid", gap:6, opacity:0.55 }}>
      <AgentBubble><span style={{ fontSize:15, color:"#444" }}>{step.prompt}</span></AgentBubble>
      <UserBubble>{step.choices ? step.choices.find(c => c.value === answer)?.label : answer}</UserBubble>
    </div>
  );
}

function SuggestChip({ children, onClick }) {
  const [down, press] = usePress();
  return (
    <button onClick={onClick} {...press}
      style={{
        textAlign:"left", padding:"12px 14px",
        fontFamily:"var(--mac-sans)", fontSize:15, textTransform:"lowercase", letterSpacing:0.2,
        border:"1px solid #000",
        background: down ? "#000" : "#fff", color: down ? "#fff" : "#000", borderRadius:0,
        boxShadow: down
          ? "inset 1px 1px 0 #888, inset -1px -1px 0 #fff"
          : "inset 1px 1px 0 #fff, inset -1px -1px 0 #888, 1px 1px 0 #000",
        transform: down ? "translate(1px,1px)" : "none", cursor:"pointer",
      }}>{children}</button>
  );
}

function ChoiceRow({ c, onClick }) {
  const [down, press] = usePress();
  return (
    <button onClick={onClick} {...press}
      style={{
        textAlign:"left", padding:"14px 16px", border:"1px solid #000",
        background: down ? "#000" : "#fff", color: down ? "#fff" : "#000",
        display:"grid", gap:5, cursor:"pointer",
      }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:14, letterSpacing:0.4, textTransform:"lowercase", fontWeight:700,
      }}>{c.label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:13.5, opacity:0.78 }}>{c.sub}</div>
    </button>
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
    <div className="mob-desktop" style={{ position:"absolute", inset:0, display:"grid", placeItems:"center", padding:24 }}>
      <div className="amiga-window" style={{ width:"100%", maxWidth:380 }}>
        <div style={{ padding:"26px 26px 24px", textAlign:"center" }}>
          <div style={{ display:"flex", justifyContent:"center", gap:10, alignItems:"center", marginBottom:18 }}>
            <LiveDot size={9}/>
            <span style={{ fontFamily:"var(--mac-mono)", letterSpacing:3, fontSize:13, textTransform:"uppercase" }}>index</span>
          </div>
          <div style={{ border:"1px solid #000", height:10, overflow:"hidden", margin:"0 auto 18px", background:"#fff" }}>
            <div style={{
              height:"100%",
              backgroundImage:"repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)",
              animation:"mac-stripes 0.8s linear infinite", backgroundSize:"24px 24px",
            }}/>
          </div>
          {lines.map((l, i) => (
            <div key={i} className="fade-up" style={{
              animationDelay:`${i * 350}ms`, fontFamily:"var(--mac-sans)", fontSize:15,
              color: i === lines.length - 1 ? "#000" : "#444", letterSpacing:0.2,
              padding:"4px 0", fontWeight: i === lines.length - 1 ? 700 : 400,
            }}>
              <span style={{ marginRight:8, fontFamily:"var(--mac-mono)" }}>›</span>{l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.Onboarding = Onboarding;
