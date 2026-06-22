// Main view — Mac System 6 split-window layout with full flow logic
// Same simulation logic as the original; only chrome/skin is reworked.

function MainView({ profile, people, setPeople, conversation, setConversation,
                    field, setField, stats, simRate, setSimRate, tweaks = {},
                    onOpenRoom }) {
  const { EVENT, CLARIFIERS, FIELD_EVENTS, AMBIENT_NOTES } = window.HALO_DATA;
  const [tab, setTab] = useState("all");
  const [paused, setPaused] = useState(false);
  const [pipelineMode, setPipelineMode] = useState("broad");
  const modeTimerRef = useRef(null);
  const clarifierCursor = useRef(0);
  const queuedRef = useRef(false);

  const flashMode = (m, holdMs = 9000) => {
    setPipelineMode(m);
    if (modeTimerRef.current) clearTimeout(modeTimerRef.current);
    modeTimerRef.current = setTimeout(() => {
      if (m === "narrowing") setPipelineMode("focused");
      else setPipelineMode("broad");
    }, holdMs);
  };
  useEffect(() => () => modeTimerRef.current && clearTimeout(modeTimerRef.current), []);

  /* ----- ambient sim: append field events + maybe bump scores ----- */
  useInterval(() => {
    if (paused) return;
    const ev = FIELD_EVENTS[Math.floor(Math.random() * FIELD_EVENTS.length)];
    setField(prev => [{ ...ev, id: Math.random().toString(36).slice(2), t: now() }, ...prev].slice(0, 50));
    if (Math.random() < 0.4) {
      setPeople(prev => {
        const visible = prev.filter(p => !p.hidden);
        if (visible.length === 0) return prev;
        const idx = prev.indexOf(visible[Math.floor(Math.random() * visible.length)]);
        const p = prev[idx];
        const next = [...prev];
        const delta = (Math.random() - 0.3) * 0.04;
        next[idx] = { ...p, score: Math.min(0.99, Math.max(0.4, p.score + delta)) };
        return next;
      });
    }
  }, paused ? null : Math.max(800, 4200 / simRate));

  /* ----- seed feed with first clarifier ----- */
  useEffect(() => {
    if (queuedRef.current) return;
    queuedRef.current = true;
    const t = setTimeout(() => pushClarifier(), 2400);
    return () => clearTimeout(t);
  }, []);

  const pushClarifier = () => {
    const c = CLARIFIERS[clarifierCursor.current % CLARIFIERS.length];
    clarifierCursor.current += 1;
    setConversation(prev => [
      ...prev,
      {
        kind:"clarifier",
        id: `${c.id}-${Math.random().toString(36).slice(2,6)}`,
        clarifierId: c.id,
        source: c.source,
        sourceMeta: c.sourceMeta,
        effect: c.effect || "neutral",
        text: c.text,
        chips: c.chips,
        triggersHint: c.triggersHint,
        answered: false, choice: null,
        t: now(),
      },
    ]);
  };
  const pushAmbientNote = () => {
    const n = AMBIENT_NOTES[Math.floor(Math.random() * AMBIENT_NOTES.length)];
    setConversation(prev => [
      ...prev,
      { kind:"note", id: Math.random().toString(36).slice(2), text: n, t: now() },
    ]);
  };

  useInterval(() => { if (!paused) pushClarifier();  }, paused ? null : 16000 / simRate);
  useInterval(() => { if (!paused && Math.random() < 0.7) pushAmbientNote(); }, paused ? null : 9000 / simRate);

  /* ----- ambient pipeline breathing ----- */
  useInterval(() => {
    if (paused) return;
    const choice = Math.random();
    if (choice < 0.55) {
      const surfaceCount = Math.random() < 0.3 ? 2 : 1;
      setPeople(prev => {
        const next = [...prev];
        for (let n = 0; n < surfaceCount; n++) {
          const hiddenIdxs = next.map((p, i) => p.hidden ? i : -1).filter(i => i >= 0);
          if (hiddenIdxs.length === 0) break;
          const j = hiddenIdxs[Math.floor(Math.random() * hiddenIdxs.length)];
          next[j] = { ...next[j], hidden: false };
        }
        return next;
      });
      flashMode("expanding", 5000);
      const lines = [
        "field widened · a new candidate just walked in.",
        "ambient discovery · agent caught a new signal nearby.",
        "someone new just got an agent online · indexing.",
        "passing-by candidate just opted into the field.",
      ];
      setField(prev => [{
        kind:"warm", text: lines[Math.floor(Math.random()*lines.length)],
        id: Math.random().toString(36).slice(2), t: now(),
      }, ...prev].slice(0, 50));
    } else if (choice < 0.7) {
      flashMode("narrowing", 5000);
    } else {
      setPeople(prev => {
        const stale = prev.filter(p => !p.hidden && (p.status === "considering" || p.status === "warm") && p.score < 0.72);
        if (stale.length === 0) return prev;
        stale.sort((a, b) => a.score - b.score);
        const victim = stale[0];
        const idx = prev.indexOf(victim);
        const next = [...prev];
        next[idx] = { ...victim, status: "expired" };
        return next;
      });
      setField(prev => [{
        kind:"passed", text:"a candidate just expired · they left or the moment closed.",
        id: Math.random().toString(36).slice(2), t: now(),
      }, ...prev].slice(0, 50));
    }
  }, paused ? null : 14000 / simRate);

  const visiblePeople = useMemo(() => people.filter(p => !p.hidden), [people]);
  const filtered = useMemo(() => [...visiblePeople].sort((a, b) => b.score - a.score), [visiblePeople]);

  const funnelStages = useMemo(() => {
    const by = (s) => visiblePeople.filter(p => p.status === s).length;
    return [
      { label:"discovered",  count: by("warm") + by("considering") + by("ready") },
      { label:"negotiating", count: by("negotiating"), accent:true },
      { label:"accepted",    count: by("accepted"),    accent:true },
      { label:"expired",     count: by("expired") },
      { label:"passed",      count: by("passed") },
    ];
  }, [visiblePeople]);

  const answerClarifier = (item, choice) => {
    const clarifier = { id: item.clarifierId, effect: item.effect };
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered:true, choice } : it
    ).concat([
      { kind:"agent", id: Math.random().toString(36).slice(2), text: agentAckFor(clarifier, choice), t: now(), pending:true },
    ]));
    const effectKind = applyClarifierEffect(clarifier, choice, setPeople, setField);
    const finalKind = effectKind || (item.effect && item.effect !== "neutral" ? item.effect : "broad");
    flashMode(finalKind, finalKind === "expanding" ? 8000 : 9000);
  };
  const dismissClarifier = (item) => {
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered:true, choice:"(dismissed)", dismissed:true } : it
    ));
  };

  const [draft, setDraft] = useState("");
  const sendDraft = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    setConversation(prev => [
      ...prev,
      { kind:"user",  id: Math.random().toString(36).slice(2), text, t: now() },
      { kind:"agent", id: Math.random().toString(36).slice(2), text: improvAgentReply(text), t: now(), pending:true },
    ]);
  };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid",
      gridTemplateRows:"36px 1fr 26px",
      padding: 10, gap: 8,
    }}>
      <TopBar paused={paused} setPaused={setPaused} simRate={simRate} setSimRate={setSimRate}/>

      <div style={{
        display:"grid",
        gridTemplateColumns: "minmax(380px, 38fr) minmax(580px, 62fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        gap: 8, minHeight:0,
      }}>
        <MacWindow title="halo · your feed">
          <ConversationPane
            profile={profile}
            conversation={conversation}
            onAnswer={answerClarifier}
            onDismiss={dismissClarifier}
            draft={draft} setDraft={setDraft} sendDraft={sendDraft}
          />
        </MacWindow>

        <MacWindow title="halo · your pipeline">
          <MatchFeed
            tab={tab} setTab={setTab}
            people={filtered}
            allPeople={visiblePeople}
            field={field}
            funnelStages={funnelStages}
            pipelineMode={pipelineMode}
            onOpenRoom={onOpenRoom}
          />
        </MacWindow>
      </div>

      <BottomBar stats={stats}/>
    </div>
  );
}

function now() { return Date.now(); }

/* =================== AGENT ACK MAP (full copy of original) =================== */
function agentAckFor(clarifier, choice) {
  const key = `${clarifier.id}/${choice}`;
  const map = {
    "q1/anchor me there":   "anchoring. narrowing the pipeline to the 'leaving big-co' cluster · 3 people stay foregrounded.",
    "q1/stay broad":        "staying broad. i'll keep the field wide. expect more noise but also more surface area.",
    "q1/show me the cluster": "highlighting the cluster on your right. the rest fades, not gone.",
    "q2/yes, send it":      "sent. ilya's agent says he'll skim in the next 3 minutes.",
    "q2/skim it for me":    "skimming. give me 40 seconds.",
    "q2/skip the prep":     "skipped. i'll route around the paper in the opener.",
    "q3/upstairs":          "rerouting upstairs. surfacing the ml/infra cluster · 2 new candidates queued.",
    "q3/downstairs":        "anchoring downstairs. payments + crews cluster narrows on maren and kai.",
    "q3/let me float":      "floating. i'll keep both clusters warm and surface whichever pulls harder.",
    "q4/mention it casually": "noted. ren's agent will keep the camera away unless you bring it up.",
    "q4/decline politely":  "declined for tonight. ren's still open to meet — no press attached.",
    "q4/hold for later":    "held. i'll re-raise next week if you're still curious.",
    "q5/widen":             "widening. pulling 3 founder-leaning people from the deep pool.",
    "q5/keep it tight":     "kept tight. dropping the bottom 2 from the pipeline.",
    "q5/only if signal's strong": "filtering hard. one founder candidate surfaces, the rest stay pooled.",
    "q6/go closer":         "rerouting your pipeline upstairs. phoebe-adjacent cluster getting attention.",
    "q6/queue them":        "queued. low priority. i won't interrupt you for it.",
    "q6/ignore ambient":    "dropping ambient pickups for tonight.",
    "q7/go upstairs":       "rerouting upstairs. surfacing theo + yael.",
    "q7/stay here":         "held. the upstairs cluster gets dropped.",
    "q7/split the difference": "compromise · surfacing theo only.",
    "q8/queue me":          "queued. kai's slot 3. expect a tap in ~18 minutes.",
    "q8/not tonight":       "passed. kai's agent says no hard feelings.",
    "q8/tell me more":      "pulling his deck and his three previous attempts.",
    "q9/lean in":           "leaning into the saas-tired cluster · 5 candidates rising fast.",
    "q9/branch wider":      "branching · widening into 7 unrelated edges.",
    "q9/ignore the cluster":"dropping it. i'll route you away from the saas chorus.",
    "q10/yes, drop noise":  "noise dropped. only 3 candidates left in front of you.",
    "q10/keep them":        "kept. i'll keep the field busy.",
    "q10/tighten gradually":"easing it in · pruning one candidate per 5 min.",
    "q11/follow them":      "following. pipeline narrowing to the patio cluster.",
    "q11/stay put":         "held. i'll let the cluster move and re-scan from here.",
    "q11/send me a tap when they settle": "queued. tap incoming when the cluster locks down.",
    "q12/just here to wind down": "told her plainly. she'll meet you.",
    "q12/honestly mixed":   "told her honestly. she said 'i appreciate that' and is still open.",
    "q12/be honest with her": "thanks. honesty bumped her trust score · she's softening.",
    "q13/surface her":      "surfaced. sasha is on the right column.",
    "q13/show me the reasoning": "pulling the four reports.",
    "q13/skip":             "skipped. the four agents stay on it without your input.",
    "q14/find them":        "scanning · 2 candidates queued behind context.",
    "q14/let it stay ambient": "ambient it is. i'll mention if either gets closer.",
    "q14/tell me who first": "two names landing in 30 seconds.",
    "q15/maren":            "focusing on maren · ilya stays warm but on hold.",
    "q15/ilya":             "focusing on ilya · maren stays warm but on hold.",
    "q15/you pick":         "i picked maren · she's higher signal right now.",
    "q16/cut short at 22:00": "noted. pipeline narrows to top 2 only.",
    "q16/extend if signal stays": "extending. pool re-opens.",
    "q16/hold steady":      "steady. i won't shape your night around the pattern.",
    "q17/trust theo":       "trusted. 3 new candidates surface, pre-vetted by him.",
    "q17/filter it through you": "filtering · i'll re-rank his three.",
    "q17/show me the list": "list incoming. you'll see all three in the right column.",
    "q18/keep me away":     "routed away. pipeline re-anchors upstairs.",
    "q18/i can handle it":  "noted. i'll only nudge if someone steps over your line.",
    "q18/show me the cluster": "flagged · you'll see them as a dim cluster on the right.",
    "q19/ping them":        "pinging both · expect a status update in 90 seconds.",
    "q19/let them breathe": "letting them breathe. they may expire if nothing moves.",
    "q19/ping just one":    "pinged the warmer of the two.",
    "q20/commit":           "committed. pipeline focuses on maren only.",
    "q20/keep options":     "options stay open. pipeline broadens slightly.",
    "q20/let me see her thread first": "opening her room now — check the right column.",
    "q21/accept blind":     "accepted blindly · 2 candidates appear with dani's vouch attached.",
    "q21/vet first":        "vetting · holding both until i'm sure they're worth your time.",
    "q21/decline politely": "declined. dani's agent said no hard feelings.",
    "q22/slip in":          "slipping in · pipeline focuses on the four in the circle.",
    "q22/observe from nearby": "observing. i'll surface a read on each of them in 2 min.",
    "q22/pass":             "passed. the circle stays its own thing.",
  };
  if (map[key]) return map[key];
  const eff = clarifier.effect;
  if (eff === "expanding") return "got it. widening the pool now · expect the right to grow.";
  if (eff === "narrowing") return "got it. tightening the pipeline · less noise coming.";
  if (eff === "focused")   return "got it. focusing on the strongest signals · others dim.";
  return "ok. updating the pipeline.";
}

function improvAgentReply(text) {
  const lower = text.toLowerCase();
  if (lower.includes("tired")) return "noted. i'll filter louder pitches from your feed.";
  if (lower.includes("food") || lower.includes("hungry"))
    return "the dumpling place around the corner is still open. should i pin someone to walk with you?";
  if (lower.includes("widen") || lower.includes("more"))  return "widening the pool. 2 candidates surfacing now.";
  if (lower.includes("less")  || lower.includes("quiet")) return "narrowing. dropping the lower-signal half.";
  if (lower.length < 14) return "got it.";
  return "noted. recalibrating the right column accordingly.";
}

/* applyClarifierEffect — full mapping from original */
function applyClarifierEffect(clarifier, choice, setPeople, setField) {
  let mode;
  const k = `${clarifier.id}/${choice}`;
  const updates = (() => {
    switch (k) {
      case "q1/anchor me there":
        mode = "narrowing";
        return { maren:{score:0.96,status:"warm"}, phoebe:{score:0.82,status:"warm"},
                 ilya:{score:0.55}, ren:{status:"considering",score:0.6},
                 ola:{status:"passed"}, kai:{status:"passed"} };
      case "q1/stay broad":
        mode = "expanding"; return { yael:{hidden:false}, dani:{hidden:false} };
      case "q1/show me the cluster":
        mode = "focused"; return { maren:{score:0.96}, phoebe:{score:0.82} };
      case "q2/yes, send it":
      case "q2/skim it for me":
        mode = "focused"; return { ilya:{status:"negotiating",score:0.86} };
      case "q2/skip the prep": return { ilya:{status:"warm",score:0.72} };
      case "q3/upstairs":
        mode = "expanding";
        return { theo:{hidden:false}, yael:{hidden:false}, tomas:{hidden:false},
                 ilya:{score:0.84}, kai:{status:"passed"} };
      case "q3/downstairs":
        mode = "narrowing";
        return { maren:{score:0.96}, kai:{score:0.78,status:"warm"},
                 ilya:{status:"passed"}, theo:{hidden:true}, yael:{hidden:true} };
      case "q3/let me float": return {};
      case "q4/mention it casually": return { ren:{status:"warm",score:0.84} };
      case "q4/decline politely":    return { ren:{status:"passed"} };
      case "q4/hold for later":      return { ren:{status:"considering",score:0.6} };
      case "q5/widen":
        mode = "expanding"; return { yael:{hidden:false}, dani:{hidden:false}, sasha:{hidden:false} };
      case "q5/keep it tight":
        mode = "narrowing"; return { ola:{status:"passed"}, ren:{status:"considering",score:0.55}, vik:{status:"passed"} };
      case "q5/only if signal's strong": mode = "narrowing"; return { yael:{hidden:false} };
      case "q6/go closer": mode = "expanding"; return { phoebe:{score:0.86,status:"warm"}, theo:{hidden:false} };
      case "q6/queue them": return { phoebe:{status:"considering"} };
      case "q6/ignore ambient": mode = "narrowing"; return {};
      case "q7/go upstairs": mode = "expanding"; return { theo:{hidden:false}, yael:{hidden:false}, ilya:{score:0.86,status:"warm"} };
      case "q7/stay here": mode = "narrowing"; return { theo:{hidden:true}, yael:{hidden:true}, ola:{status:"passed"} };
      case "q7/split the difference": return { theo:{hidden:false} };
      case "q8/queue me":     return { kai:{status:"negotiating",score:0.74} };
      case "q8/not tonight":  return { kai:{status:"passed"} };
      case "q8/tell me more": return { kai:{status:"warm",score:0.7} };
      case "q9/lean in": mode = "expanding"; return { phoebe:{score:0.9,status:"warm"}, theo:{hidden:false}, nia:{hidden:false} };
      case "q9/branch wider": mode = "expanding"; return { jules:{score:0.7}, mira:{score:0.7}, omar:{hidden:false}, harper:{hidden:false} };
      case "q9/ignore the cluster": return { phoebe:{status:"passed"}, noor:{status:"passed"} };
      case "q10/yes, drop noise": mode = "narrowing"; return { ola:{status:"passed"}, jules:{status:"passed"}, vik:{status:"passed"}, mira:{status:"passed"}, noor:{status:"passed"} };
      case "q10/keep them": return {};
      case "q10/tighten gradually": mode = "narrowing"; return { ola:{status:"passed"}, vik:{status:"passed"} };
      case "q11/follow them": mode = "narrowing"; return { ilya:{status:"passed"}, vik:{status:"passed"}, ren:{score:0.85} };
      case "q11/stay put": return {};
      case "q11/send me a tap when they settle": return {};
      case "q12/just here to wind down": mode = "focused"; return { phoebe:{status:"accepted",score:0.95} };
      case "q12/honestly mixed": return { phoebe:{status:"warm"} };
      case "q12/be honest with her": mode = "focused"; return { phoebe:{status:"accepted",score:0.92} };
      case "q13/surface her": mode = "expanding"; return { sasha:{hidden:false} };
      case "q13/show me the reasoning": return { sasha:{hidden:false} };
      case "q13/skip": return {};
      case "q14/find them": mode = "expanding"; return { dani:{hidden:false}, harper:{hidden:false} };
      case "q14/let it stay ambient": return {};
      case "q14/tell me who first": mode = "expanding"; return { dani:{hidden:false} };
      case "q15/maren": mode = "focused"; return { maren:{status:"accepted",score:0.97}, ilya:{status:"warm"} };
      case "q15/ilya":  mode = "focused"; return { ilya:{status:"accepted",score:0.92}, maren:{status:"warm"} };
      case "q15/you pick": mode = "focused"; return { maren:{status:"accepted",score:0.96} };
      case "q16/cut short at 22:00": mode = "narrowing"; return { ola:{status:"passed"}, jules:{status:"passed"}, vik:{status:"passed"}, mira:{status:"passed"} };
      case "q16/extend if signal stays": mode = "expanding"; return { omar:{hidden:false}, harper:{hidden:false} };
      case "q16/hold steady": return {};
      case "q17/trust theo": mode = "expanding"; return { dani:{hidden:false}, nia:{hidden:false}, tomas:{hidden:false} };
      case "q17/filter it through you": mode = "expanding"; return { dani:{hidden:false} };
      case "q17/show me the list":      mode = "expanding"; return { dani:{hidden:false}, nia:{hidden:false}, tomas:{hidden:false} };
      case "q18/keep me away": mode = "narrowing"; return { vik:{status:"passed"} };
      case "q18/i can handle it": return {};
      case "q18/show me the cluster": return {};
      case "q19/ping them": return { jules:{score:0.65}, noor:{score:0.7} };
      case "q19/let them breathe": mode = "narrowing"; return { jules:{status:"expired"}, vik:{status:"expired"} };
      case "q19/ping just one": return { jules:{score:0.65} };
      case "q20/commit": mode = "focused"; return { maren:{status:"accepted",score:0.98},
        phoebe:{status:"warm"}, ilya:{status:"warm"},
        jules:{status:"passed"}, vik:{status:"passed"}, mira:{status:"passed"} };
      case "q20/keep options": mode = "expanding"; return { yael:{hidden:false} };
      case "q20/let me see her thread first": return {};
      case "q21/accept blind": mode = "expanding"; return {
        harper:{hidden:false,status:"accepted",score:0.86},
        omar:  {hidden:false,status:"accepted",score:0.82} };
      case "q21/vet first":   mode = "expanding"; return { harper:{hidden:false}, omar:{hidden:false} };
      case "q21/decline politely": return {};
      case "q22/slip in":   mode = "focused"; return { jules:{status:"accepted",score:0.88}, noor:{status:"accepted",score:0.84} };
      case "q22/observe from nearby": return { jules:{score:0.7}, noor:{score:0.7} };
      case "q22/pass": return { jules:{status:"passed"}, noor:{status:"passed"} };
      default: return {};
    }
  })();

  setPeople(prev => prev.map(p => updates[p.id] ? { ...p, ...updates[p.id] } : p));

  const hasSpecific = Object.keys(updates).length > 0;
  if (!hasSpecific && clarifier.effect && clarifier.effect !== "neutral") {
    mode = clarifier.effect;
    applyGenericEffect(clarifier.effect, setPeople);
  }

  const acceptedNames = Object.entries(updates).filter(([_,u]) => u.status === "accepted").map(([id]) => id);
  const passedNames   = Object.entries(updates).filter(([_,u]) => u.status === "passed").map(([id]) => id);
  const changedNames  = Object.keys(updates).slice(0, 3).join(", ");

  let phrase;
  if (acceptedNames.length > 0)
    phrase = `accepted · ${acceptedNames.join(", ")} ${acceptedNames.length === 1 ? "is" : "are"} heading toward you.`;
  else if (passedNames.length >= 2)
    phrase = `passed cleanly · ${passedNames.length} candidates dropped from the pipeline.`;
  else if (mode === "expanding")
    phrase = changedNames ? `pipeline expanding · pulling ${changedNames} in.` : "pipeline expanding · widening the pool.";
  else if (mode === "narrowing")
    phrase = changedNames ? `pipeline narrowing · ${changedNames} adjusted.` : "pipeline narrowing · pruning the long tail.";
  else if (mode === "focused")
    phrase = changedNames ? `pipeline focusing · ${changedNames} locked in.` : "pipeline focusing · committing to the top signals.";
  else
    phrase = changedNames ? `your answer rippled · ${changedNames} updated.` : "noted. minor adjustments to the pipeline.";

  setField(prev => [{ kind:"negotiate", text: phrase, id: Math.random().toString(36).slice(2), t: now() }, ...prev].slice(0, 50));
  return mode;
}

function applyGenericEffect(effect, setPeople) {
  setPeople(prev => {
    const next = [...prev];
    if (effect === "expanding") {
      const hiddenIdxs = next.map((p, i) => p.hidden ? i : -1).filter(i => i >= 0);
      for (let n = 0; n < Math.min(2, hiddenIdxs.length); n++) {
        const j = hiddenIdxs[Math.floor(Math.random() * hiddenIdxs.length)];
        next[j] = { ...next[j], hidden: false };
      }
    } else if (effect === "narrowing") {
      const stale = next.map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.hidden && (p.status === "considering" || p.status === "warm"))
        .sort((a, b) => a.p.score - b.p.score).slice(0, 2);
      stale.forEach(({ i }) => { next[i] = { ...next[i], status:"expired" }; });
    } else if (effect === "focused") {
      const vis = next.map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.hidden && p.status !== "passed" && p.status !== "expired")
        .sort((a, b) => b.p.score - a.p.score);
      if (vis[0]) next[vis[0].i] = { ...vis[0].p, score: Math.min(0.98, vis[0].p.score + 0.06) };
      vis.slice(1).forEach(({ i, p }) => { next[i] = { ...p, score: Math.max(0.4, p.score - 0.03) }; });
    }
    return next;
  });
}

/* =================== TOP BAR (mac menubar styling) =================== */
function TopBar({ paused, setPaused, simRate, setSimRate }) {
  const { EVENT } = window.HALO_DATA;
  return (
    <div style={{
      display:"grid", gridTemplateColumns:"auto 1fr auto",
      alignItems:"center",
      padding:"0 14px", gap:18,
      border:"1px solid #000", background:"#fff",
      fontFamily:"var(--mac-mono)", fontSize:11,
      color:"#000", height:"100%",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis" }}>
        <LiveDot size={7}/>
        <span style={{ letterSpacing:3, textTransform:"uppercase", fontWeight:700 }}>halo</span>
        <span>/</span>
        <span>always on · {EVENT.arrived} online</span>
      </div>
      <div/>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <span style={{ color:"#555" }}>sim</span>
        <MacSegmented
          value={simRate}
          onChange={setSimRate}
          options={[{value:1,label:"1×"},{value:2,label:"2×"},{value:4,label:"4×"}]}
        />
        <button onClick={() => setPaused(p => !p)} style={{
          fontFamily:"var(--mac-sans)", fontSize:12,
          background: paused ? "#000" : "#fff",
          color:      paused ? "#fff" : "#000",
          border:"1px solid #000",
          padding:"1px 12px", borderRadius:9,
          cursor:"pointer", whiteSpace:"nowrap", flexShrink:0,
        }}>{paused ? "▶ play" : "❚❚ pause"}</button>
      </div>
    </div>
  );
}

/* =================== LEFT — CONVERSATION =================== */
function ConversationPane({ profile, conversation, onAnswer, onDismiss, draft, setDraft, sendDraft }) {
  const scrollRef = useRef(null);
  const [stuck, setStuck] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(conversation.length);
  const pendingCount = useMemo(
    () => conversation.filter(it => it.kind === "clarifier" && !it.answered).length,
    [conversation]
  );

  useEffect(() => {
    if (scrollRef.current && stuck) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setUnread(0);
    } else if (conversation.length > lastLen.current) {
      setUnread(u => u + (conversation.length - lastLen.current));
    }
    lastLen.current = conversation.length;
  }, [conversation.length, stuck]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStuck(atBottom);
    if (atBottom) setUnread(0);
  };
  const jumpToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setStuck(true); setUnread(0);
    }
  };

  return (
    <div style={{
      display:"grid", gridTemplateRows:"auto 1fr auto",
      flex:1, minHeight:0, position:"relative",
    }}>
      {/* header */}
      <div style={{
        padding:"12px 18px 12px",
        borderBottom:"1px solid #000",
        background:"#fff",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.4,
            textTransform:"uppercase",
          }}>your feed · proactive</div>
          <div style={{ flex:1 }}/>
          {pendingCount > 0 && (
            <span style={{
              fontFamily:"var(--mac-mono)", fontSize:10,
              background:"#000", color:"#fff",
              padding:"1px 8px", letterSpacing:0.3,
            }}>{pendingCount} waiting on you</span>
          )}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
          <h2 style={{
            margin:0, fontFamily:"var(--mac-sans)", fontWeight:400,
            fontSize:18, color:"#000", letterSpacing:-0.2,
          }}>halo is listening</h2>
          <Tag inverted>ACTIVE</Tag>
        </div>
      </div>

      {/* feed body */}
      <div ref={scrollRef} onScroll={onScroll} className="mac-scroll" style={{
        overflowY:"auto", padding:"16px 18px 8px",
        display:"flex", flexDirection:"column", gap:14,
      }}>
        <AgentLine pending={false}>
          <StreamText text={`you're in. ${HELLO_FOR(profile)}`} speed={12}/>
        </AgentLine>

        {conversation.map((it) => {
          if (it.kind === "clarifier") {
            return (
              <ClarifierCard key={it.id} item={it}
                onAnswer={(choice) => onAnswer(it, choice)}
                onDismiss={() => onDismiss(it)}/>
            );
          }
          if (it.kind === "note") return <NoteLine key={it.id}>{it.text}</NoteLine>;
          if (it.kind === "user") return <UserLine key={it.id}>{it.text}</UserLine>;
          return <AgentLine key={it.id} pending={it.pending}>
            <StreamText text={it.text} speed={14}/>
          </AgentLine>;
        })}

        <div style={{
          marginLeft:32,
          fontFamily:"var(--mac-mono)", fontSize:11, color:"#555",
          display:"flex", alignItems:"center", gap:8,
        }}>
          <span>halo's listening · more will surface as the field changes</span>
          <span style={{ animation:"mac-blink 1.4s steps(1) infinite" }}>·</span>
        </div>
      </div>

      {!stuck && unread > 0 && (
        <button onClick={jumpToBottom} style={{
          position:"absolute", left:"50%", transform:"translateX(-50%)",
          bottom:62,
          fontFamily:"var(--mac-mono)", fontSize:11,
          padding:"3px 12px",
          border:"1px solid #000",
          background:"#000", color:"#fff",
          borderRadius:9, cursor:"pointer", zIndex:5,
          boxShadow:"1px 1px 0 #000",
        }}>↓ {unread} new</button>
      )}

      {/* input */}
      <div style={{
        borderTop:"1px solid #000",
        padding:"8px 14px",
        background:"#fff",
        display:"flex", gap:10, alignItems:"center",
      }}>
        <span style={{ fontFamily:"var(--mac-mono)", color:"#000" }}>›</span>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendDraft(); }}
          placeholder="tell halo something. or just wait."
          style={{
            flex:1, background:"transparent", border:"none", outline:"none",
            color:"#000", fontFamily:"var(--mac-sans)", fontSize:13,
            padding:"4px 0",
          }}
        />
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"#555" }}>↵</span>
      </div>
    </div>
  );
}

/* =================== CLARIFIER CARD =================== */
function ClarifierCard({ item, onAnswer, onDismiss }) {
  const [hover, setHover] = useState(false);
  const collective = item.source === "collective" || item.source === "room";
  const answered = item.answered;
  const dismissed = item.dismissed;
  const effect = item.effect || "neutral";

  const fx = {
    expanding: { inv:false, leftBar: "repeating-linear-gradient(0deg, #000, #000 2px, #fff 2px, #fff 4px)",
                 symbol:"↔", label:"expands the pipeline" },
    narrowing: { inv:false, leftBar: "repeating-linear-gradient(0deg, #000, #000 4px, #fff 4px, #fff 8px)",
                 symbol:"→←", label:"narrows the pipeline" },
    focused:   { inv:true,  leftBar: "#000",
                 symbol:"●", label:"focuses the pipeline" },
    neutral:   { inv:false, leftBar: "transparent",
                 symbol:"·", label:"no big shift" },
  }[effect];

  return (
    <div className="fade-up"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        padding:"12px 14px 12px 16px",
        background: fx.inv && !answered ? "#000" : "#fff",
        color:      fx.inv && !answered ? "#fff" : "#000",
        border:"1px solid #000",
        position:"relative",
        opacity: dismissed ? 0.45 : 1,
      }}>
      {/* left bar */}
      {effect !== "neutral" && (
        <div style={{
          position:"absolute", left:0, top:0, bottom:0, width:4,
          background: fx.leftBar,
        }}/>
      )}

      {/* top row */}
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
        <SourceBadge source={item.source || "agent"} sourceMeta={item.sourceMeta}/>
        {effect !== "neutral" && (
          <span style={{
            display:"inline-flex", alignItems:"center", gap:6,
            padding:"1px 8px",
            border: fx.inv && !answered ? "1px solid #fff" : "1px solid #000",
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.5,
            textTransform:"lowercase",
          }}>
            <span>{fx.symbol}</span>
            <span>{fx.label}</span>
          </span>
        )}
        <div style={{ flex:1 }}/>
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:10,
                       opacity:0.6 }}>{timeAgo(item.t)}</span>
        {!answered && (
          <button onClick={onDismiss} style={{
            fontFamily:"var(--mac-mono)", fontSize:10,
            padding:"1px 6px", border:"1px solid currentColor",
            background:"transparent", color:"inherit",
            opacity: hover ? 1 : 0.55, cursor:"pointer",
          }}>dismiss</button>
        )}
      </div>

      {/* before/after preview */}
      {!answered && effect !== "neutral" && <EffectPreview effect={effect} inv={fx.inv}/>}

      {/* question text */}
      <div style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:10 }}>
        <div style={{
          width:22, height:22, marginTop:2,
          border:"1px solid currentColor",
          display:"grid", placeItems:"center", flex:"0 0 auto",
          background: collective ? (fx.inv && !answered ? "#fff" : "#000") : "transparent",
          color:      collective ? (fx.inv && !answered ? "#000" : "#fff") : "currentColor",
        }}>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:10 }}>
            {collective ? "Σ" : "h"}
          </span>
        </div>
        <div style={{
          fontFamily:"var(--mac-sans)",
          fontSize:14.5, fontWeight: 400,
          lineHeight:1.45,
        }}>{item.text}</div>
      </div>

      {/* chips */}
      {!answered ? (
        <React.Fragment>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginLeft:32 }}>
            {item.chips.map(chip => (
              <button key={chip} onClick={() => onAnswer(chip)}
                style={{
                  padding:"2px 12px",
                  fontFamily:"var(--mac-sans)", fontSize:12,
                  border:"1px solid currentColor",
                  background:"transparent", color:"inherit",
                  borderRadius:9, cursor:"pointer",
                }}
                onMouseDown={(e) => { e.currentTarget.style.background = fx.inv ? "#fff" : "#000";
                                       e.currentTarget.style.color = fx.inv ? "#000" : "#fff"; }}
                onMouseUp={(e) => { e.currentTarget.style.background = "transparent";
                                     e.currentTarget.style.color = "inherit"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent";
                                        e.currentTarget.style.color = "inherit"; }}
              >{chip}</button>
            ))}
          </div>
          {item.triggersHint && (
            <div style={{
              marginLeft:32, marginTop:8,
              fontFamily:"var(--mac-mono)", fontSize:10.5,
              letterSpacing:0.3, opacity:0.7,
            }}>→ {item.triggersHint}</div>
          )}
        </React.Fragment>
      ) : (
        <div style={{
          marginLeft:32,
          fontFamily:"var(--mac-mono)", fontSize:11,
          display:"flex", alignItems:"baseline", gap:8, opacity:0.85,
        }}>
          <span style={{ opacity:0.6 }}>your reply</span>
          <span>"{item.choice}"</span>
        </div>
      )}
    </div>
  );
}

function EffectPreview({ effect, inv }) {
  const before = [0.35, 0.55, 0.75, 0.55, 0.35];
  const after = effect === "expanding"
    ? [0.4, 0.55, 0.75, 0.95, 0.75, 0.55, 0.4]
    : effect === "narrowing"
    ? [0.6, 0.85, 0.6]
    : [1.0];
  const Dots = ({ heights, accent = false }) => (
    <div style={{ display:"flex", alignItems:"center", gap:4 }}>
      {heights.map((h, i) => (
        <span key={i} style={{
          width: 4 + h * 4, height: 4 + h * 4,
          borderRadius:999,
          background: accent
            ? (inv ? "#fff" : "#000")
            : (inv ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.30)"),
          border: accent ? "none" : `1px solid ${inv ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.35)"}`,
        }}/>
      ))}
    </div>
  );
  return (
    <div style={{
      marginLeft:32, marginBottom:10,
      display:"flex", alignItems:"center", gap:10,
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.4,
      opacity:0.85,
    }}>
      <span style={{ minWidth:46 }}>before</span>
      <Dots heights={before}/>
      <span style={{ padding:"0 4px" }}>›</span>
      <span style={{ minWidth:38 }}>after</span>
      <Dots heights={after} accent/>
    </div>
  );
}

function NoteLine({ children }) {
  return (
    <div className="fade-up" style={{
      marginLeft:32,
      fontFamily:"var(--mac-mono)", fontSize:11.5,
      color:"#444", lineHeight:1.5,
      display:"flex", gap:8, alignItems:"baseline",
    }}>
      <span>·</span>
      <span style={{ fontStyle:"italic" }}>{children}</span>
    </div>
  );
}
function timeAgo(t) {
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
function HELLO_FOR(profile) {
  if (profile.shape === "quiet")  return "i'll stay quiet. one or two intros a week at most.";
  if (profile.shape === "active") return "the network's busy. i'll keep the pipeline moving.";
  return "i'll surface a handful and check in before negotiating.";
}

function AgentLine({ children, pending, highlight, collective }) {
  const glyph = collective ? "Σ" : "h";
  return (
    <div className="fade-up" style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      <div style={{
        width:22, height:22, marginTop:2,
        border:"1px solid #000",
        display:"grid", placeItems:"center", flex:"0 0 auto",
        background:"#000", color:"#fff",
      }}>
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:10 }}>{glyph}</span>
      </div>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize: highlight ? 14.5 : 14,
        color:"#000", lineHeight:1.45, maxWidth:520,
      }}>{children}</div>
    </div>
  );
}
function UserLine({ children }) {
  return (
    <div className="fade-up" style={{ display:"flex", gap:10, marginLeft:32 }}>
      <span style={{ color:"#555", fontFamily:"var(--mac-mono)", fontSize:13, marginTop:2 }}>›</span>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:13,
        color:"#444", maxWidth:460, fontStyle:"italic",
      }}>"{children}"</div>
    </div>
  );
}

/* =================== RIGHT — MATCH FEED =================== */
function MatchFeed({ tab, setTab, people, field, funnelStages, pipelineMode, onOpenRoom }) {
  const bucket = (p) => {
    if (p.status === "accepted") return "accepted";
    if (p.status === "expired")  return "expired";
    if (p.status === "passed")   return "passed";
    if (p.status === "negotiating") return "negotiating";
    return "discovered";
  };
  const peopleForTab = tab === "all" ? people : people.filter(p => bucket(p) === tab);
  return (
    <div style={{ display:"grid", gridTemplateRows:"auto 1fr", flex:1, minHeight:0 }}>
      <div style={{ padding:"12px 22px 14px", borderBottom:"1px solid #000" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
          <div style={{
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.6,
            textTransform:"uppercase",
          }}>live field</div>
          <ModeBadge mode={pipelineMode}/>
          <div style={{ flex:1 }}/>
          <Ticker items={field.slice(0, 8).length > 0 ? field.slice(0, 8) : [{ text:"warming up…" }]} intervalMs={2600}/>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:10, marginTop:6 }}>
          <h2 style={{
            margin:0, fontFamily:"var(--mac-sans)", fontWeight:400,
            fontSize:22, color:"#000", letterSpacing:-0.4,
          }}>people in your pipeline</h2>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#555" }}>
            sorted by signal · breathes with the network
          </span>
        </div>
        <div style={{ marginTop:12 }}>
          <PipelineFunnel
            stages={funnelStages}
            mode={pipelineMode}
            onClickStage={(label) => setTab(label)}
            activeStage={tab}
          />
        </div>
      </div>

      <div className="mac-scroll" style={{
        overflowY:"auto", padding:"14px 22px 24px",
        display:"grid", gap:8,
      }}>
        {peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} onOpenRoom={onOpenRoom}/>
        ))}
        {peopleForTab.length === 0 && (
          <div style={{
            padding:28, textAlign:"center",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"#555",
            border:"1px dashed #000",
          }}>no one in this state. the field keeps moving — check back.</div>
        )}
      </div>
    </div>
  );
}

function MatchCard({ person, onOpenRoom }) {
  const [hover, setHover] = useState(false);
  const isReady  = person.status === "ready" || person.status === "accepted";
  const isPassed = person.status === "passed";
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onOpenRoom && onOpenRoom(person.id)}
      className="fade-up"
      style={{
        textAlign:"left",
        display:"grid", gridTemplateColumns:"auto 1fr auto",
        gap:14, padding:"14px 14px",
        background: isReady ? "#000" : "#fff",
        color:      isReady ? "#fff" : "#000",
        border:"1px solid #000",
        opacity: isPassed ? 0.45 : 1,
        boxShadow: hover ? "2px 2px 0 #000" : "none",
        transform: hover ? "translate(-1px, -1px)" : "none",
        cursor: onOpenRoom ? "pointer" : "default",
        transition:"all .12s ease",
      }}>
      <Avatar name={person.name} size={36} ring={isReady}/>
      <div style={{ display:"grid", gap:3, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontFamily:"var(--mac-sans)", fontSize:15, fontWeight:600 }}>
            {person.name}
          </span>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, opacity:0.7 }}>
            · {person.location} · {person.distance}
          </span>
        </div>
        <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4 }}>
          {person.blurb}
        </div>
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize:11,
          marginTop:2, fontStyle:"italic", lineHeight:1.4, opacity:0.85,
        }}>— {person.pitchFromAgent}</div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginTop:6 }}>
          {person.signals.slice(0, 3).map(s => {
            const overlap = person.overlap.includes(s);
            return (
              <span key={s} style={{
                fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3,
                padding:"1px 6px",
                border:`1px solid ${isReady ? "#fff" : "#000"}`,
                background: overlap ? (isReady ? "#fff" : "#000") : "transparent",
                color:      overlap ? (isReady ? "#000" : "#fff") : "inherit",
              }}>{s}</span>
            );
          })}
        </div>
      </div>
      <div style={{ display:"grid", justifyItems:"end", gap:6, alignContent:"start" }}>
        <StatusBadge status={person.status} inv={isReady}/>
        <ScoreBarBW value={person.score} inv={isReady}/>
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, opacity:0.8 }}>
          {Math.round(person.score * 100)}% signal
        </span>
      </div>
    </div>
  );
}

function ScoreBarBW({ value, inv }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{
      width: 64, height: 7,
      border: `1px solid ${inv ? "#fff" : "#000"}`,
      background:"transparent",
      position:"relative", overflow:"hidden",
    }}>
      <div style={{
        width: `${pct*100}%`, height:"100%",
        backgroundImage: inv
          ? "repeating-linear-gradient(45deg, #fff 0, #fff 1px, #000 1px, #000 2px)"
          : "repeating-linear-gradient(45deg, #000 0, #000 1px, #fff 1px, #fff 2px)",
      }}/>
    </div>
  );
}

function StatusBadge({ status, inv }) {
  const map = {
    accepted:    "accepted",
    ready:       "ready · intro",
    negotiating: "negotiating",
    warm:        "discovered · warm",
    considering: "discovered",
    expired:     "expired",
    passed:      "passed",
  };
  const t = map[status] || "discovered";
  return (
    <span style={{
      fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
      textTransform:"uppercase",
      color: inv ? "#000" : "#000",
      background: inv ? "#fff" : "#fff",
      border:`1px solid ${inv ? "#fff" : "#000"}`,
      padding:"1px 6px",
    }}>{t}</span>
  );
}

/* =================== BOTTOM BAR =================== */
function BottomBar({ stats }) {
  return (
    <div style={{
      border:"1px solid #000", background:"#fff",
      display:"grid", gridTemplateColumns:"1fr auto",
      alignItems:"center",
      padding:"0 14px", gap:14,
      fontFamily:"var(--mac-mono)", fontSize:10,
      color:"#000", height:"100%",
    }}>
      <div style={{ display:"flex", gap:18, alignItems:"center" }}>
        <span style={{ letterSpacing:1.5 }}>FIELD</span>
        <span><b>{stats.online}</b> agents online</span>
        <span>·</span>
        <span>inspected <b>{stats.inspected}</b></span>
        <span>·</span>
        <span>passed <b>{stats.passed}</b></span>
      </div>
      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
        <LiveDot size={6}/>
        <span>halo · syn-0518-bk-04</span>
      </div>
    </div>
  );
}

window.MainView = MainView;
