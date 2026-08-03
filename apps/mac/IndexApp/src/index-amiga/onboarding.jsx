// Onboarding, Mac System 6 chrome, conversational. + Calibrating screen.

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

// Off-limits chips, tuned to whatever they're actually looking for, so the
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

  // default, meeting people generally
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
  const SHAPE_STEP = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
  // How many follow-up questions sit between "intent" and "shape", the live
  // flow asks the backend for the same number the local script would.
  const DYN_MAX = Math.max(1, ONBOARDING_STEPS.length - 2);
  const live = !!(window.IndexApp && window.IndexApp.isAuthed());
  const client = live ? window.IndexApp.getClient() : null;
  const env = useIndexEnv();
  // The web app's deterministic intake funnel (/intents/intake/*), gated by the
  // backend FAST_SIGNAL_INTAKE flag. When off (or start fails) the chat flow
  // below stays the path.
  const fastEnabled = !!(client && env.features && env.features.fastSignalIntake);

  // Completed turns drive the progress bar and the faded history; the current
  // step is either a local scripted one or a backend-generated question.
  const [turns, setTurns] = useState([]);
  const [step, setStep] = useState(() => resolveStep(ONBOARDING_STEPS[0], {}));
  const [thinking, setThinking] = useState(fastEnabled);
  const [answers, setAnswers] = useState({});
  const [draft, setDraft] = useState("");
  const [calibrating, setCalibrating] = useState(false);
  const inputRef = useRef(null);

  const intentIdRef = useRef(null);       // set once the live signal exists
  const createdRef = useRef(false);
  const sessionRef = useRef(null);        // chat conversation id
  const answersRef = useRef({});          // mirror of `answers` for async handlers
  const flowStartRef = useRef(Date.now());
  const seenQ = useRef(new Set());
  const awaitingRef = useRef(false);      // a chat turn owes us the next step
  const dynAsked = useRef(0);
  const localIdx = useRef(0);             // pointer into the scripted steps
  const usedLocalFallback = useRef(false);
  const cancelledRef = useRef(false);
  useEffect(() => () => { cancelledRef.current = true; }, []);

  const stepIdx = Math.min(turns.length, ONBOARDING_STEPS.length - 1);

  useEffect(() => {
    setDraft("");
    if (inputRef.current) {
      setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
    }
  }, [step && step.id, thinking]);

  // Fold the collected steps into one signal description for create_intent.
  const composeDescription = (a) => {
    const parts = [];
    if (a.intent) parts.push(String(a.intent).trim());
    if (a.edges) parts.push(`a great match: ${String(a.edges).trim()}`);
    if (a["off-limits"]) parts.push(`off-limits: ${String(a["off-limits"]).trim()}`);
    return parts.filter(Boolean).join(" · ");
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- fast intake (the web app's /intents/intake funnel) ------------------
  //
  // Round 1 comes from /start, follow-ups from /question until the locked
  // total, then /prepare + /proposal synthesize the draft (a 422 carries a
  // clarification question). The signal always looks everywhere (no networkId),
  // and a one-button summary gates /intents/confirm. The server holds no funnel
  // session: every call resends the answered rounds.

  const fastRounds = useRef([]);          // [{ prompt, answer }]
  const fastQueue = useRef([]);           // prefetched follow-up questions
  const fastTotal = useRef(null);         // locked question budget
  const fastPrepare = useRef(null);       // in-flight /prepare promise
  const fastRunId = useRef(null);
  const fastProposal = useRef(null);      // resolved proposal shown on the summary

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
      note: note || "",
      choices: [{ value: "create", label: "create this signal", sub: "looking everywhere" }],
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
      });
      if (cancelledRef.current) return;
      if (res && res.intentId) intentIdRef.current = res.intentId;
      createdRef.current = true;
      finish(ans);
    } catch (_e) {
      if (cancelledRef.current) return;
      showFastSummary(fastProposal.current, "that didn't go through — try again.");
    }
  };

  useEffect(() => {
    if (!fastEnabled) return;
    client.intents.intake.start()
      .then(({ question }) => { if (!cancelledRef.current) showFastQuestion(question); })
      // Start failed (flag raced off, network): the scripted first step is
      // still in place, so the chat flow takes over untouched.
      .catch(() => { if (!cancelledRef.current) setThinking(false); });
  }, []);

  // ---- chat-driven clarification (same machinery as the web app) ----------
  //
  // The first answer opens a /chat/stream turn. The agent asks clarifying
  // questions via ask_user_question, each arrives as a `user_question` SSE
  // event and becomes the next onboarding step; answering it resumes the same
  // blocked turn. The turn ends in an ```intent_proposal``` block, which we
  // confirm through POST /intents/confirm.

  // Resolve a user_question event id into the persisted chat question row.
  const fetchQuestion = async (id) => {
    for (let i = 0; i < 5 && !cancelledRef.current; i++) {
      const res = await client.questions.pending(
        { mode: "chat", conversationId: sessionRef.current },
      ).catch(() => null);
      const q = window.IndexApp.normalizeList(res, "questions").find((r) => r && r.id === id);
      if (q) return q;
      await sleep(800);
    }
    return null;
  };

  const showQuestion = (q) => {
    seenQ.current.add(q.id);
    dynAsked.current += 1;
    const c = window.IndexApi.mapClarifier(q);
    awaitingRef.current = false;
    setThinking(false);
    setStep({
      id: `q-${q.id}`,
      question: q,
      prompt: c.text || "tell me more?",
      hint: c.triggersHint || "",
      placeholder: "type your answer…",
      examples: c.chips && c.chips.length ? c.chips : undefined,
    });
  };

  const toShape = () => {
    awaitingRef.current = false;
    setThinking(false);
    setStep(resolveStep(SHAPE_STEP, answersRef.current));
  };

  // No dynamic flow available (demo, stream error before anything happened),
  // continue with the original scripted follow-ups.
  const fallbackLocal = () => {
    if (cancelledRef.current) return;
    if (dynAsked.current > 0 || createdRef.current) { toShape(); return; }
    usedLocalFallback.current = true;
    awaitingRef.current = false;
    setThinking(false);
    localIdx.current += 1;
    const next = ONBOARDING_STEPS[Math.min(localIdx.current, ONBOARDING_STEPS.length - 1)];
    setStep(resolveStep(next, answersRef.current));
  };

  const confirmProposal = async (p) => {
    try {
      const res = await client.intents.confirm({
        proposalId: p.proposalId,
        description: p.description,
      });
      if (res && res.intentId) intentIdRef.current = res.intentId;
      createdRef.current = true;
    } catch (e) { /* finish() falls back to a direct create */ }
  };

  // The agent may have created the signal directly (no proposal block), so
  // detect it so the flow still closes out as "created".
  const newestIntentSinceStart = async () => {
    const res = await client.intents.list({}).catch(() => null);
    const rows = window.IndexApp.normalizeList(res, "intents")
      .filter((r) => r && r.createdAt && Date.parse(r.createdAt) >= flowStartRef.current - 60000)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return rows[0] || null;
  };

  const handleDone = async (response) => {
    // Only act when the flow is waiting on this turn, a late `done` (e.g. the
    // question wait timed out while the user idles) must not clobber the step.
    if (cancelledRef.current || !awaitingRef.current) return;
    const proposal = (window.IndexApp.parseIntentProposals(response) || [])[0];
    if (proposal) { await confirmProposal(proposal); toShape(); return; }
    const fresh = await newestIntentSinceStart();
    if (fresh) { intentIdRef.current = fresh.id; createdRef.current = true; toShape(); return; }
    // The agent answered in prose. A short question becomes the next step;
    // anything else means the guided beat is over.
    const text = String(response || "").replace(/```[\s\S]*?```/g, "").trim();
    if (text && text.length <= 300 && dynAsked.current < DYN_MAX + 1) {
      dynAsked.current += 1;
      awaitingRef.current = false;
      setThinking(false);
      setStep({
        id: `chat-${dynAsked.current}`,
        chatTurn: true,
        prompt: text,
        placeholder: "type your answer…",
      });
      return;
    }
    fallbackLocal();
  };

  // Open one chat turn and route its events back into the step machine.
  const startTurn = (message) => {
    awaitingRef.current = true;
    setThinking(true);
    window.IndexApp.streamChat({
      message,
      sessionId: sessionRef.current,
      onSession: (sid) => { sessionRef.current = sid; },
      onEvent: (ev) => {
        if (cancelledRef.current || !ev) return;
        if (ev.type === "user_question" && Array.isArray(ev.questions)) {
          const next = ev.questions.find((q) => q && q.id && !seenQ.current.has(q.id));
          if (next) {
            (async () => {
              const q = await fetchQuestion(next.id);
              if (q && !cancelledRef.current) showQuestion(q);
            })();
          }
        } else if (ev.type === "done") {
          handleDone(ev.response || ev.fullResponse || "");
        } else if (ev.type === "error") {
          if (awaitingRef.current) fallbackLocal();
        }
      },
    }).catch(() => { if (awaitingRef.current) fallbackLocal(); });
  };

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
    if (step.question || step.chatTurn) {
      if (dynAsked.current === 1) newAns.edges = v;
      else if (!newAns["off-limits"]) newAns["off-limits"] = v;
    }
    if (step.fast === "question" || step.fast === "clarify") {
      if (!newAns.intent) newAns.intent = v;
      else if (!newAns.edges) newAns.edges = v;
      else if (!newAns["off-limits"]) newAns["off-limits"] = v;
    }
    setAnswers(newAns);
    answersRef.current = newAns;

    if (step.id === "shape") { finish(newAns); return; }

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
      }
      return;
    }

    // A structured chat question, answering it resumes the blocked turn, and
    // the same stream carries the next question or the final proposal.
    if (step.question && client) {
      const isChip = (step.examples || []).includes(raw);
      const body = isChip ? { selectedOptions: [raw] } : { selectedOptions: [], freeText: v };
      awaitingRef.current = true;
      setThinking(true);
      client.questions.answer(step.question.id, body)
        .then((res) => {
          // Turn already ended (timeout), carry the answer as a follow-up.
          if (!res || !res.resumed) startTurn(`Re: "${step.prompt}": ${v}`);
        })
        .catch(() => startTurn(`Re: "${step.prompt}": ${v}`));
      return;
    }

    // A prose question from the agent, the answer is the next chat message.
    if (step.chatTurn && client) { startTurn(v); return; }

    // The first answer IS the signal, hand it to the agent, which clarifies
    // and proposes, exactly like the web app's guided intake.
    if (step.id === "intent" && client) {
      startTurn(
        `I'm setting up my first signal. Here's what I'm looking for: ${v}. `
        + "Ask me clarifying questions if anything important is missing, then create the signal.",
      );
      return;
    }

    // Demo / scripted fallback, the original local flow.
    localIdx.current += 1;
    const next = ONBOARDING_STEPS[Math.min(localIdx.current, ONBOARDING_STEPS.length - 1)];
    setStep(resolveStep(next, newAns));
  };

  const finish = (ans) => {
    setCalibrating(true);
    (async () => {
      let created = createdRef.current;
      if (client && !created) {
        // Live but the early create failed (or never ran), create from the
        // composed script answers, exactly like the original flow.
        try {
          await window.IndexApp.createIntent(composeDescription(ans));
          created = true;
        } catch (_e) { /* fall back to demo transition */ }
      } else if (client && created && intentIdRef.current && usedLocalFallback.current) {
        // Scripted fallback answers still refine the created signal.
        window.IndexApp.mcpCall("update_intent", {
          intentId: intentIdRef.current,
          description: composeDescription(ans),
        }).catch(() => {});
      }
      // Keep the calibrating beat visible even if the calls are fast.
      await new Promise((r) => setTimeout(r, created ? 1200 : 2000));
      onDone(ans, created);
    })();
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

            {/* progress, pinstripe segments */}
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
              ) : step.fast === "summary" ? (
              <div key={step.id} className="fade-up" style={{ display:"grid", gap:12 }}>
                <AgentBubble>Here's your signal.</AgentBubble>
                <SignalSummaryCard
                  proposal={step.proposal}
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
          <OnboardingFieldPreview answers={answers} stepIdx={stepIdx}/>
        </MacWindow>
      </div>
    </div>
  );
}

// Onboarding is the same agent that speaks on the signals page, so it wears the
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

// The fast-intake summary gate: the synthesized signal as a Workbench card,
// one primary action. Sits in the conversation column, indented like answers.
function SignalSummaryCard({ proposal, note, onCreate }) {
  return (
    <div style={{
      marginLeft:36, maxWidth:560,
      border:"1px solid #000", background:"#fff",
      boxShadow:"2px 2px 0 rgba(0,0,0,0.25)",
    }}>
      {/* title strip */}
      <div style={{
        display:"flex", alignItems:"center", gap:10,
        padding:"7px 14px", borderBottom:"1px solid #000",
      }}>
        <LiveDot size={8}/>
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:11,
          letterSpacing:2, textTransform:"uppercase",
        }}>your signal</span>
        <div style={{ flex:1 }}/>
        <Tag>looking everywhere</Tag>
      </div>

      <div style={{ padding:"16px 18px", display:"grid", gap:14 }}>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:19, fontWeight:600,
          lineHeight:1.35, letterSpacing:-0.2, color:"#000",
        }}>{proposal.description}</div>

        {(proposal.lookingFor || proposal.youBring) && (
          <div style={{
            display:"grid", gap:8,
            borderTop:"1px dashed var(--ink-3)", paddingTop:12,
          }}>
            {proposal.lookingFor && <SummaryRow k="looking for" v={proposal.lookingFor}/>}
            {proposal.youBring && <SummaryRow k="you bring" v={proposal.youBring}/>}
          </div>
        )}
      </div>

      <div style={{
        padding:"12px 18px 14px", borderTop:"1px solid #000",
        display:"flex", alignItems:"center", gap:12,
      }}>
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

function SummaryRow({ k, v }) {
  return (
    <div style={{ display:"flex", gap:12, alignItems:"baseline" }}>
      <span style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
        textTransform:"uppercase", color:"var(--ink-3)", flex:"0 0 88px",
      }}>{k}</span>
      <span style={{
        fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)",
        lineHeight:1.5, minWidth:0,
      }}>{v}</span>
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

// Right column during onboarding
function OnboardingFieldPreview({ answers, stepIdx }) {
  // Just the narrative of what the agent is doing with you.
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
