// Main view — split-screen ambient interface
const { useState: _useStateMV, useEffect: _useEffectMV, useRef: _useRefMV, useMemo: _useMemoMV } = React;

function MainView({ profile, people, setPeople, conversation, setConversation, field, setField, stats, simRate, setSimRate, tweaks = {} }) {
  const { EVENT, CLARIFIERS, FIELD_EVENTS } = window.HALO_DATA;

  const [tab, setTab] = useState("all"); // all | warm | considering | negotiating | ready
  const [paused, setPaused] = useState(false);
  const [pipelineMode, setPipelineMode] = useState("broad"); // broad | expanding | narrowing | focused
  const modeTimerRef = useRef(null);
  const clarifierCursor = useRef(0);
  const queuedRef = useRef(false); // ensures first clarifier seeded quickly
  const { AMBIENT_NOTES } = window.HALO_DATA;

  // mode helper: set + auto-decay back to broad
  const flashMode = (m, holdMs = 9000) => {
    setPipelineMode(m);
    if (modeTimerRef.current) clearTimeout(modeTimerRef.current);
    modeTimerRef.current = setTimeout(() => {
      if (m === "narrowing") setPipelineMode("focused");
      else setPipelineMode("broad");
    }, holdMs);
  };
  useEffect(() => () => modeTimerRef.current && clearTimeout(modeTimerRef.current), []);

  // sim: every N seconds, append field event + maybe bump someone
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

  // FEED: proactively push clarifiers into the feed every ~14s/simRate
  // (cycles through CLARIFIERS; loops back so the feed never runs dry)
  useEffect(() => {
    if (queuedRef.current) return;
    queuedRef.current = true;
    // seed the feed with an initial clarifier shortly after entry
    const t = setTimeout(() => pushClarifier(), 2400);
    return () => clearTimeout(t);
  }, []);

  const pushClarifier = () => {
    const c = CLARIFIERS[clarifierCursor.current % CLARIFIERS.length];
    clarifierCursor.current += 1;
    setConversation(prev => [
      ...prev,
      {
        kind: "clarifier",
        id: `${c.id}-${Math.random().toString(36).slice(2,6)}`,
        clarifierId: c.id,
        source: c.source,
        sourceMeta: c.sourceMeta,
        effect: c.effect || "neutral",
        text: c.text,
        chips: c.chips,
        triggersHint: c.triggersHint,
        answered: false,
        choice: null,
        t: now(),
      },
    ]);
  };

  const pushAmbientNote = () => {
    const n = AMBIENT_NOTES[Math.floor(Math.random() * AMBIENT_NOTES.length)];
    setConversation(prev => [
      ...prev,
      { kind: "note", id: Math.random().toString(36).slice(2), text: n, t: now() },
    ]);
  };

  // Clarifier injection cadence
  useInterval(() => {
    if (paused) return;
    pushClarifier();
  }, paused ? null : 16000 / simRate);

  // Ambient note cadence — between clarifiers, fills the feed quietly
  useInterval(() => {
    if (paused) return;
    if (Math.random() < 0.7) pushAmbientNote();
  }, paused ? null : 9000 / simRate);

  // spontaneous pipeline breathing — discovered ticks up ambiently
  useInterval(() => {
    if (paused) return;
    const choice = Math.random();
    if (choice < 0.55) {
      // ambient discovery — unhide 1 (sometimes 2) hidden pool members
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
      const arrivalLines = [
        "field widened · a new candidate just walked in.",
        "ambient discovery · agent caught a new signal nearby.",
        "someone new just got an agent online · indexing.",
        "passing-by candidate just opted into the field.",
      ];
      setField(prev => [{
        kind: "warm",
        text: arrivalLines[Math.floor(Math.random() * arrivalLines.length)],
        id: Math.random().toString(36).slice(2), t: now(),
      }, ...prev].slice(0, 50));
    } else if (choice < 0.7) {
      flashMode("narrowing", 5000);
    } else {
      // expire a stale candidate
      setPeople(prev => {
        const stale = prev
          .filter(p => !p.hidden && (p.status === "considering" || p.status === "warm") && p.score < 0.72);
        if (stale.length === 0) return prev;
        stale.sort((a, b) => a.score - b.score);
        const victim = stale[0];
        const idx = prev.indexOf(victim);
        const next = [...prev];
        next[idx] = { ...victim, status: "expired" };
        return next;
      });
      setField(prev => [{
        kind: "passed",
        text: "a candidate just expired · they left or the moment closed.",
        id: Math.random().toString(36).slice(2), t: now(),
      }, ...prev].slice(0, 50));
    }
  }, paused ? null : 14000 / simRate);

  // derived
  const visiblePeople = useMemo(() => people.filter(p => !p.hidden), [people]);
  // sorted visible list — bucket filtering happens inside MatchFeed
  const filtered = useMemo(() => {
    return [...visiblePeople].sort((a, b) => b.score - a.score);
  }, [visiblePeople]);

  // funnel stages: discovered → negotiating → accepted, plus expired & passed terminals
  const funnelStages = useMemo(() => {
    const by = (s) => visiblePeople.filter(p => p.status === s).length;
    return [
      { label: "discovered",  count: by("warm") + by("considering") + by("ready") },
      { label: "negotiating", count: by("negotiating"), accent: true },
      { label: "accepted",    count: by("accepted"), accent: true },
      { label: "expired",     count: by("expired") },
      { label: "passed",      count: by("passed") },
    ];
  }, [visiblePeople]);

  const activeClarifier = null; // legacy slot — feed handles all clarifiers now

  // handle answering a clarifier in the feed — mark it answered, push agent reply
  const answerClarifier = (item, choice) => {
    const clarifier = { id: item.clarifierId, effect: item.effect };
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered: true, choice } : it
    ).concat([
      { kind: "agent", id: Math.random().toString(36).slice(2), text: agentAckFor(clarifier, choice), t: now(), pending: true },
    ]));
    const effectKind = applyClarifierEffect(clarifier, choice, setPeople, setField);
    const finalKind = effectKind || (item.effect && item.effect !== "neutral" ? item.effect : "broad");
    flashMode(finalKind, finalKind === "expanding" ? 8000 : 9000);
  };

  // dismiss without answering
  const dismissClarifier = (item) => {
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered: true, choice: "(dismissed)", dismissed: true } : it
    ));
  };

  // free-text input on left
  const [draft, setDraft] = useState("");
  const sendDraft = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    setConversation(prev => [
      ...prev,
      { kind: "user", id: Math.random().toString(36).slice(2), text, t: now() },
      { kind: "agent", id: Math.random().toString(36).slice(2), text: improvAgentReply(text), t: now(), pending: true },
    ]);
  };

  // grid rows/cols flex with which bars+panes are visible
  const rows = [
    tweaks.showTopBar !== false ? "48px" : null,
    "1fr",
    tweaks.showBottomBar !== false ? "36px" : null,
  ].filter(Boolean).join(" ");
  const showLeft  = tweaks.showConversationPane !== false;
  const showRight = tweaks.showMatchFeed !== false;
  const cols = showLeft && showRight
    ? "minmax(380px, 38fr) minmax(620px, 62fr)"
    : "1fr";

  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "grid",
      gridTemplateRows: rows,
    }}>
      {/* TOP BAR */}
      {tweaks.showTopBar !== false && (
        <TopBar stats={stats} paused={paused} setPaused={setPaused} simRate={simRate} setSimRate={setSimRate} />
      )}

      {/* SPLIT */}
      <div style={{
        display: "grid", gridTemplateColumns: cols,
        overflow: "hidden",
        borderTop: tweaks.showTopBar !== false ? "1px solid var(--line)" : "none",
      }}>
        {/* LEFT: conversation */}
        {showLeft && (
          <ConversationPane
            profile={profile}
            conversation={conversation}
            onAnswer={answerClarifier}
            onDismiss={dismissClarifier}
            draft={draft}
            setDraft={setDraft}
            sendDraft={sendDraft}
            tweaks={tweaks}
          />
        )}

        {/* RIGHT: matches feed */}
        {showRight && (
          <MatchFeed
            tab={tab} setTab={setTab}
            people={filtered}
            allPeople={visiblePeople}
            field={field}
            funnelStages={funnelStages}
            pipelineMode={pipelineMode}
            tweaks={tweaks}
          />
        )}
      </div>

      {/* BOTTOM BAR — ambient stats ticker */}
      {tweaks.showBottomBar !== false && (
        <BottomBar stats={stats} field={field} />
      )}
    </div>
  );
}

function now() { return Date.now(); }

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

    "q5/widen":             "widening. pulling 3 founder-leaning people from the deep pool. expect the right column to grow.",
    "q5/keep it tight":     "kept tight. dropping the bottom 2 from the pipeline.",
    "q5/only if signal's strong": "filtering hard. one founder candidate surfaces, the rest stay pooled.",

    "q6/go closer":         "rerouting your pipeline upstairs. phoebe-adjacent cluster getting attention.",
    "q6/queue them":        "queued. low priority. i won't interrupt you for it.",
    "q6/ignore ambient":    "dropping ambient pickups for tonight. won't surface unverified overheard signals.",

    "q7/go upstairs":       "rerouting upstairs. surfacing theo + yael · narrowing on the convergence.",
    "q7/stay here":         "held. the upstairs cluster gets dropped. you stay in your current corner.",
    "q7/split the difference": "compromise · surfacing theo only. yael stays pooled.",

    "q8/queue me":          "queued. kai's slot 3. expect a tap in ~18 minutes.",
    "q8/not tonight":       "passed. kai's agent says no hard feelings.",
    "q8/tell me more":      "pulling his deck and his three previous attempts. one sec.",

    "q9/lean in":           "leaning into the saas-tired cluster · 5 candidates rising fast.",
    "q9/branch wider":      "branching · widening into 7 unrelated edges. you'll see strangers surface.",
    "q9/ignore the cluster":"dropping it. i'll route you away from the saas chorus.",

    "q10/yes, drop noise":  "noise dropped. only 3 candidates left in front of you.",
    "q10/keep them":        "kept. i'll keep the field busy.",
    "q10/tighten gradually":"easing it in · pruning one candidate per 5 min.",

    "q11/follow them":      "following. pipeline narrowing to the patio cluster · 4 candidates drop.",
    "q11/stay put":         "held. i'll let the cluster move and re-scan from here.",
    "q11/send me a tap when they settle": "queued. tap incoming when the cluster locks down.",

    "q12/just here to wind down": "told her plainly. she'll meet you.",
    "q12/honestly mixed":   "told her honestly. she said 'i appreciate that' and is still open.",
    "q12/be honest with her": "thanks. honesty bumped her trust score · she's softening.",

    "q13/surface her":      "surfaced. sasha is on the right column.",
    "q13/show me the reasoning": "pulling the four reports. you'll see them in the room view.",
    "q13/skip":             "skipped. the four agents stay on it without your input.",

    "q14/find them":        "scanning · 2 candidates queued behind context.",
    "q14/let it stay ambient": "ambient it is. i'll mention if either gets closer.",
    "q14/tell me who first": "two names landing in 30 seconds.",

    "q15/maren":            "focusing on maren · ilya stays warm but on hold.",
    "q15/ilya":             "focusing on ilya · maren stays warm but on hold.",
    "q15/you pick":         "i picked maren · she's higher signal right now.",

    "q16/cut short at 22:00": "noted. pipeline narrows to top 2 only. everything else fades.",
    "q16/extend if signal stays": "extending. pool re-opens. expect more candidates after the dip.",
    "q16/hold steady":      "steady. i won't shape your night around the pattern.",

    "q17/trust theo":       "trusted. 3 new candidates surface, pre-vetted by him.",
    "q17/filter it through you": "filtering · i'll re-rank his three and surface the strongest.",
    "q17/show me the list": "list incoming. you'll see all three in the right column.",

    "q18/keep me away":     "routed away. pipeline re-anchors upstairs.",
    "q18/i can handle it":  "noted. i'll only nudge if someone steps over your line.",
    "q18/show me the cluster": "flagged · you'll see them as a dim cluster on the right.",

    "q19/ping them":        "pinging both · expect a status update in 90 seconds.",
    "q19/let them breathe": "letting them breathe. they may expire if nothing moves.",
    "q19/ping just one":    "pinged the warmer of the two.",

    "q20/commit":           "committed. pipeline focuses on maren only · everyone else stays warm.",
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
  // generic fallback by effect
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

// returns one of: "expanding" | "narrowing" | "focused" | undefined
function applyClarifierEffect(clarifier, choice, setPeople, setField) {
  let mode;
  const k = `${clarifier.id}/${choice}`;

  const updates = (() => {
    switch (k) {
      // q1 — anchor on 'leaving big-co' cluster
      case "q1/anchor me there":
        mode = "narrowing";
        return {
          maren:  { score: 0.96, status: "warm" },
          phoebe: { score: 0.82, status: "warm" },
          ilya:   { score: 0.55 },
          ren:    { status: "considering", score: 0.6 },
          ola:    { status: "passed" },
          kai:    { status: "passed" },
        };
      case "q1/stay broad":
        mode = "expanding";
        return {
          yael: { hidden: false },
          dani: { hidden: false },
        };
      case "q1/show me the cluster":
        mode = "focused";
        return { maren: { score: 0.96 }, phoebe: { score: 0.82 } };

      // q2 — ilya 1-pager
      case "q2/yes, send it":
      case "q2/skim it for me":
        mode = "focused";
        return { ilya: { status: "negotiating", score: 0.86 } };
      case "q2/skip the prep":
        return { ilya: { status: "warm", score: 0.72 } };

      // q3 — room cluster split
      case "q3/upstairs":
        mode = "expanding";
        return {
          theo: { hidden: false }, yael: { hidden: false }, tomas: { hidden: false },
          ilya: { score: 0.84 }, kai: { status: "passed" },
        };
      case "q3/downstairs":
        mode = "narrowing";
        return {
          maren: { score: 0.96 }, kai: { score: 0.78, status: "warm" },
          ilya: { status: "passed" }, theo: { hidden: true }, yael: { hidden: true },
        };
      case "q3/let me float":
        return {};

      // q4 — ren camera
      case "q4/mention it casually": return { ren: { status: "warm", score: 0.84 } };
      case "q4/decline politely":    return { ren: { status: "passed" } };
      case "q4/hold for later":      return { ren: { status: "considering", score: 0.6 } };

      // q5 — co-founder collective signal
      case "q5/widen":
        mode = "expanding";
        return { yael: { hidden: false }, dani: { hidden: false }, sasha: { hidden: false } };
      case "q5/keep it tight":
        mode = "narrowing";
        return { ola: { status: "passed" }, ren: { status: "considering", score: 0.55 }, vik: { status: "passed" } };
      case "q5/only if signal's strong":
        mode = "narrowing";
        return { yael: { hidden: false } };

      // q6 — overheard saas
      case "q6/go closer":
        mode = "expanding";
        return { phoebe: { score: 0.86, status: "warm" }, theo: { hidden: false } };
      case "q6/queue them": return { phoebe: { status: "considering" } };
      case "q6/ignore ambient":
        mode = "narrowing";
        return {};

      // q7 — agents converging upstairs
      case "q7/go upstairs":
        mode = "expanding";
        return { theo: { hidden: false }, yael: { hidden: false }, ilya: { score: 0.86, status: "warm" } };
      case "q7/stay here":
        mode = "narrowing";
        return { theo: { hidden: true }, yael: { hidden: true }, ola: { status: "passed" } };
      case "q7/split the difference":
        return { theo: { hidden: false } };

      // q8 — kai
      case "q8/queue me":     return { kai: { status: "negotiating", score: 0.74 } };
      case "q8/not tonight":  return { kai: { status: "passed" } };
      case "q8/tell me more": return { kai: { status: "warm", score: 0.7 } };

      // q9 — saas cluster
      case "q9/lean in":
        mode = "expanding";
        return { phoebe: { score: 0.9, status: "warm" }, theo: { hidden: false }, nia: { hidden: false } };
      case "q9/branch wider":
        mode = "expanding";
        return { jules: { score: 0.7 }, mira: { score: 0.7 }, omar: { hidden: false }, harper: { hidden: false } };
      case "q9/ignore the cluster":
        return { phoebe: { status: "passed" }, noor: { status: "passed" } };

      // q10 — your energy
      case "q10/yes, drop noise":
        mode = "narrowing";
        return { ola: { status: "passed" }, jules: { status: "passed" }, vik: { status: "passed" }, mira: { status: "passed" }, noor: { status: "passed" } };
      case "q10/keep them": return {};
      case "q10/tighten gradually":
        mode = "narrowing";
        return { ola: { status: "passed" }, vik: { status: "passed" } };

      // q11 — bar cluster moving
      case "q11/follow them":
        mode = "narrowing";
        return { ilya: { status: "passed" }, vik: { status: "passed" }, ren: { score: 0.85 } };
      case "q11/stay put": return {};
      case "q11/send me a tap when they settle": return {};

      // q12 — phoebe gating
      case "q12/just here to wind down":
        mode = "focused";
        return { phoebe: { status: "accepted", score: 0.95 } };
      case "q12/honestly mixed":
        return { phoebe: { status: "warm" } };
      case "q12/be honest with her":
        mode = "focused";
        return { phoebe: { status: "accepted", score: 0.92 } };

      // q13 — 4 agents flagging sasha
      case "q13/surface her":
        mode = "expanding";
        return { sasha: { hidden: false } };
      case "q13/show me the reasoning":
        return { sasha: { hidden: false } };
      case "q13/skip": return {};

      // q14 — your last project mentioned
      case "q14/find them":
        mode = "expanding";
        return { dani: { hidden: false }, harper: { hidden: false } };
      case "q14/let it stay ambient": return {};
      case "q14/tell me who first":
        mode = "expanding";
        return { dani: { hidden: false } };

      // q15 — pick maren or ilya
      case "q15/maren":
        mode = "focused";
        return { maren: { status: "accepted", score: 0.97 }, ilya: { status: "warm" } };
      case "q15/ilya":
        mode = "focused";
        return { ilya: { status: "accepted", score: 0.92 }, maren: { status: "warm" } };
      case "q15/you pick":
        mode = "focused";
        return { maren: { status: "accepted", score: 0.96 } };

      // q16 — second-hour pattern
      case "q16/cut short at 22:00":
        mode = "narrowing";
        return { ola: { status: "passed" }, jules: { status: "passed" }, vik: { status: "passed" }, mira: { status: "passed" } };
      case "q16/extend if signal stays":
        mode = "expanding";
        return { omar: { hidden: false }, harper: { hidden: false } };
      case "q16/hold steady": return {};

      // q17 — theo's list
      case "q17/trust theo":
        mode = "expanding";
        return { dani: { hidden: false }, nia: { hidden: false }, tomas: { hidden: false } };
      case "q17/filter it through you":
        mode = "expanding";
        return { dani: { hidden: false } };
      case "q17/show me the list":
        mode = "expanding";
        return { dani: { hidden: false }, nia: { hidden: false }, tomas: { hidden: false } };

      // q18 — off-limits cluster
      case "q18/keep me away":
        mode = "narrowing";
        return { vik: { status: "passed" } };
      case "q18/i can handle it": return {};
      case "q18/show me the cluster": return {};

      // q19 — warm candidates idle
      case "q19/ping them":
        return { jules: { score: 0.65 }, noor: { score: 0.7 } };
      case "q19/let them breathe":
        mode = "narrowing";
        return { jules: { status: "expired" }, vik: { status: "expired" } };
      case "q19/ping just one":
        return { jules: { score: 0.65 } };

      // q20 — commit to maren
      case "q20/commit":
        mode = "focused";
        return {
          maren: { status: "accepted", score: 0.98 },
          phoebe: { status: "warm" }, ilya: { status: "warm" },
          jules: { status: "passed" }, vik: { status: "passed" }, mira: { status: "passed" },
        };
      case "q20/keep options":
        mode = "expanding";
        return { yael: { hidden: false } };
      case "q20/let me see her thread first":
        return {};

      // q21 — dani's friends
      case "q21/accept blind":
        mode = "expanding";
        return {
          harper: { hidden: false, status: "accepted", score: 0.86 },
          omar:   { hidden: false, status: "accepted", score: 0.82 },
        };
      case "q21/vet first":
        mode = "expanding";
        return { harper: { hidden: false }, omar: { hidden: false } };
      case "q21/decline politely":
        return {};

      // q22 — quiet circle
      case "q22/slip in":
        mode = "focused";
        return { jules: { status: "accepted", score: 0.88 }, noor: { status: "accepted", score: 0.84 } };
      case "q22/observe from nearby":
        return { jules: { score: 0.7 }, noor: { score: 0.7 } };
      case "q22/pass":
        return { jules: { status: "passed" }, noor: { status: "passed" } };

      default:
        return {};
    }
  })();

  // Apply the specific updates
  setPeople(prev => prev.map(p => updates[p.id] ? { ...p, ...updates[p.id] } : p));

  // If nothing specific happened and the clarifier has an effect type, apply a generic shape change
  const hasSpecific = Object.keys(updates).length > 0;
  if (!hasSpecific && clarifier.effect && clarifier.effect !== "neutral") {
    mode = clarifier.effect;
    applyGenericEffect(clarifier.effect, setPeople);
  }

  // Field event narrating the shape change — call out accepts and passes by name
  const acceptedNames = Object.entries(updates)
    .filter(([_, u]) => u.status === "accepted")
    .map(([id]) => id);
  const passedNames = Object.entries(updates)
    .filter(([_, u]) => u.status === "passed")
    .map(([id]) => id);
  const changedNames = Object.keys(updates).slice(0, 3).join(", ");

  let phrase;
  if (acceptedNames.length > 0) {
    phrase = `accepted · ${acceptedNames.join(", ")} ${acceptedNames.length === 1 ? "is" : "are"} heading toward you.`;
  } else if (passedNames.length >= 2) {
    phrase = `passed cleanly · ${passedNames.length} candidates dropped from the pipeline.`;
  } else if (mode === "expanding") {
    phrase = changedNames ? `pipeline expanding · pulling ${changedNames} in.` : "pipeline expanding · widening the pool.";
  } else if (mode === "narrowing") {
    phrase = changedNames ? `pipeline narrowing · ${changedNames} adjusted.` : "pipeline narrowing · pruning the long tail.";
  } else if (mode === "focused") {
    phrase = changedNames ? `pipeline focusing · ${changedNames} locked in.` : "pipeline focusing · committing to the top signals.";
  } else {
    phrase = changedNames ? `your answer rippled · ${changedNames} updated.` : "noted. minor adjustments to the pipeline.";
  }
  setField(prev => [{ kind: "negotiate", text: phrase, id: Math.random().toString(36).slice(2), t: now() }, ...prev].slice(0, 50));

  return mode;
}

// Generic shape changes when a clarifier has no specific mapping
function applyGenericEffect(effect, setPeople) {
  setPeople(prev => {
    const next = [...prev];
    if (effect === "expanding") {
      // unhide up to 2 random hidden pool members
      const hiddenIdxs = next.map((p, i) => p.hidden ? i : -1).filter(i => i >= 0);
      for (let n = 0; n < Math.min(2, hiddenIdxs.length); n++) {
        const j = hiddenIdxs[Math.floor(Math.random() * hiddenIdxs.length)];
        next[j] = { ...next[j], hidden: false };
      }
    } else if (effect === "narrowing") {
      // expire up to 2 lowest-score visible warm/considering
      const stale = next
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.hidden && (p.status === "considering" || p.status === "warm"))
        .sort((a, b) => a.p.score - b.p.score)
        .slice(0, 2);
      stale.forEach(({ i }) => { next[i] = { ...next[i], status: "expired" }; });
    } else if (effect === "focused") {
      // boost the highest-score visible; gently drop others
      const vis = next
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => !p.hidden && p.status !== "passed" && p.status !== "expired")
        .sort((a, b) => b.p.score - a.p.score);
      if (vis[0]) next[vis[0].i] = { ...vis[0].p, score: Math.min(0.98, vis[0].p.score + 0.06) };
      vis.slice(1).forEach(({ i, p }) => { next[i] = { ...p, score: Math.max(0.4, p.score - 0.03) }; });
    }
    return next;
  });
}

// --- TOP BAR -----------------------------------------------------------
function TopBar({ stats, paused, setPaused, simRate, setSimRate }) {
  const { EVENT } = window.HALO_DATA;
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto 1fr auto",
      alignItems: "center",
      padding: "0 20px", gap: 18,
      background: "var(--bg-1)",
      fontFamily: "var(--mono)", fontSize: 11.5,
      color: "var(--text-2)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <LiveDot size={8} />
        <span style={{ letterSpacing: 3, textTransform: "uppercase", color: "var(--text)" }}>halo</span>
        <span style={{ color: "var(--dim-2)" }}>/</span>
        <span style={{ color: "var(--dim)" }}>{EVENT.name} · {EVENT.venue}</span>
      </div>
      <div />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: "var(--dim)" }}>sim</span>
        {[1, 2, 4].map(r => (
          <button key={r} onClick={() => setSimRate(r)} style={{
            fontFamily: "var(--mono)", fontSize: 10.5,
            color: simRate === r ? "var(--orange)" : "var(--dim)",
            padding: "2px 6px",
            border: `1px solid ${simRate === r ? "rgba(255,122,26,0.4)" : "var(--line)"}`,
          }}>{r}×</button>
        ))}
        <button onClick={() => setPaused(p => !p)} style={{
          fontFamily: "var(--mono)", fontSize: 10.5,
          color: paused ? "var(--orange)" : "var(--dim)",
          padding: "2px 8px",
          border: "1px solid var(--line)",
          marginLeft: 6,
        }}>{paused ? "▶ play" : "❚❚ pause"}</button>
      </div>
    </div>
  );
}
function MiniStat({ label, v, accent, dim }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{
        color: accent ? "var(--orange-2)" : (dim ? "var(--dim-2)" : "var(--text)"),
        fontVariantNumeric: "tabular-nums",
      }}>{v}</span>
      <span style={{ color: "var(--dim-2)", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" }}>{label}</span>
    </div>
  );
}

// --- LEFT PANE ---------------------------------------------------------
function ConversationPane({ profile, conversation, onAnswer, onDismiss, draft, setDraft, sendDraft, tweaks = {} }) {
  const scrollRef = useRef(null);
  const [stuck, setStuck] = useState(true); // user is anchored at the bottom
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(conversation.length);
  const pendingCount = useMemo(
    () => conversation.filter(it => it.kind === "clarifier" && !it.answered).length,
    [conversation]
  );

  // auto-scroll only if stuck at bottom
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
      setStuck(true);
      setUnread(0);
    }
  };

  return (
    <div style={{
      display: "grid", gridTemplateRows: "auto 1fr auto",
      borderRight: "1px solid var(--line)",
      background: "var(--bg)",
      overflow: "hidden",
      position: "relative",
    }}>
      {/* header */}
      <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: 1.4,
            textTransform: "uppercase", color: "var(--dim)",
          }}>your feed · proactive</div>
          <div style={{ flex: 1 }} />
          {pendingCount > 0 && tweaks.showPendingPill !== false && (
            <span style={{
              fontFamily: "var(--mono)", fontSize: 10.5,
              color: "var(--orange-2)",
              border: "1px solid rgba(255,122,26,0.4)",
              padding: "2px 8px",
              background: "rgba(255,122,26,0.06)",
              letterSpacing: 0.3,
            }}>{pendingCount} waiting on you</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <h2 style={{
            margin: 0, fontFamily: "var(--sans)", fontWeight: 300,
            fontSize: 18, color: "var(--text)", letterSpacing: -0.3,
          }}>halo is listening</h2>
          <Tag color="var(--orange)" glow>active</Tag>
        </div>
      </div>

      {/* feed body */}
      <div ref={scrollRef} onScroll={onScroll} className="scroll" style={{
        overflowY: "auto", padding: "18px 24px 12px",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        {/* opening note */}
        <AgentLine pending={false}>
          <StreamText text={`you're in. ${HELLO_FOR(profile)}`} speed={12} />
        </AgentLine>

        {conversation.map((it) => {
          if (it.kind === "clarifier") {
            return (
              <ClarifierCard
                key={it.id} item={it}
                onAnswer={(choice) => onAnswer(it, choice)}
                onDismiss={() => onDismiss(it)}
                showSourceBadge={tweaks.showSourceBadges !== false}
              />
            );
          }
          if (it.kind === "note") {
            if (tweaks.showAmbientNotes === false) return null;
            return <NoteLine key={it.id}>{it.text}</NoteLine>;
          }
          if (it.kind === "user") {
            return <UserLine key={it.id}>{it.text}</UserLine>;
          }
          // agent
          return (
            <AgentLine key={it.id} pending={it.pending}>
              <StreamText text={it.text} speed={14} />
            </AgentLine>
          );
        })}

        {/* tail breathing indicator */}
        <div style={{
          marginLeft: 32, marginTop: 0,
          fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim-2)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>halo's listening · more will surface as the field changes</span>
          <span style={{ animation: "blink 1.4s steps(1) infinite", color: "var(--orange-dim)" }}>·</span>
        </div>
      </div>

      {/* jump-to-bottom pill */}
      {!stuck && unread > 0 && (
        <button onClick={jumpToBottom} style={{
          position: "absolute", left: "50%", transform: "translateX(-50%)",
          bottom: 80,
          fontFamily: "var(--mono)", fontSize: 11,
          padding: "6px 12px",
          border: "1px solid rgba(255,122,26,0.5)",
          background: "rgba(20,10,4,0.92)",
          color: "var(--orange-2)",
          letterSpacing: 0.4,
          boxShadow: "0 0 24px rgba(255,122,26,0.25)",
          zIndex: 5,
        }}>↓ {unread} new</button>
      )}

      {/* input */}
      <div style={{
        borderTop: "1px solid var(--line)",
        padding: "12px 16px",
        background: "var(--bg-1)",
        display: "flex", gap: 10, alignItems: "center",
      }}>
        <span style={{ color: "var(--orange)", fontFamily: "var(--mono)" }}>›</span>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendDraft(); }}
          placeholder="tell halo something. or just wait."
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "var(--text)", fontFamily: "var(--sans)", fontSize: 14,
            padding: "6px 0",
          }}
        />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)" }}>↵</span>
      </div>
    </div>
  );
}

// === Clarifier feed card ==============================================
function ClarifierCard({ item, onAnswer, onDismiss, showSourceBadge = true }) {
  const [hover, setHover] = useState(false);
  const collective = item.source === "collective" || item.source === "room";
  const answered = item.answered;
  const dismissed = item.dismissed;
  const effect = item.effect || "neutral";

  // effect-driven visual treatment
  const fx = {
    expanding: {
      leftBar:   "linear-gradient(180deg, rgba(255,122,26,0.65), rgba(255,122,26,0.15))",
      bg:        answered ? "transparent" : "linear-gradient(180deg, rgba(255,122,26,0.04), rgba(255,122,26,0.08))",
      border:    answered ? "var(--line)" : "rgba(255,122,26,0.32)",
      glow:      answered ? "none" : "0 0 26px rgba(255,122,26,0.08)",
      chipColor: "var(--orange-2)",
      chipBg:    "rgba(255,122,26,0.08)",
      chipBorder:"rgba(255,122,26,0.35)",
      symbol:    "↔",
      label:     "expands the pipeline",
    },
    narrowing: {
      leftBar:   "linear-gradient(180deg, rgba(150,148,140,0.45), rgba(150,148,140,0.05))",
      bg:        answered ? "transparent" : "linear-gradient(0deg, rgba(255,255,255,0.018), rgba(255,255,255,0.04))",
      border:    answered ? "var(--line)" : "rgba(150,148,140,0.22)",
      glow:      "none",
      chipColor: "var(--text-2)",
      chipBg:    "rgba(255,255,255,0.04)",
      chipBorder:"var(--line-2)",
      symbol:    "→ ←",
      label:     "narrows the pipeline",
    },
    focused: {
      leftBar:   "linear-gradient(180deg, var(--orange) 0%, var(--orange) 100%)",
      bg:        answered ? "transparent" : "rgba(255,122,26,0.08)",
      border:    answered ? "var(--line)" : "rgba(255,122,26,0.55)",
      glow:      answered ? "none" : "0 0 28px rgba(255,122,26,0.18), inset 0 0 0 1px rgba(255,122,26,0.10)",
      chipColor: "var(--orange)",
      chipBg:    "rgba(255,122,26,0.12)",
      chipBorder:"rgba(255,122,26,0.5)",
      symbol:    "◉",
      label:     "focuses the pipeline",
    },
    neutral: {
      leftBar:   "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0))",
      bg:        answered ? "transparent" : (hover ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)"),
      border:    answered ? "var(--line)" : "var(--line-2)",
      glow:      "none",
      chipColor: "var(--dim)",
      chipBg:    "transparent",
      chipBorder:"var(--line)",
      symbol:    "·",
      label:     "no big shift",
    },
  }[effect];

  return (
    <div
      className="fade-up"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: "14px 18px 14px 18px",
        background: fx.bg,
        border: `1px solid ${fx.border}`,
        borderLeft: `3px solid transparent`,
        boxShadow: fx.glow,
        position: "relative",
        opacity: dismissed ? 0.45 : 1,
        transition: "all .25s ease",
      }}>
      {/* effect-coded left bar */}
      <div style={{
        position: "absolute", left: -1, top: -1, bottom: -1, width: 3,
        background: fx.leftBar,
        pointerEvents: "none",
      }} />

      {/* top row: source + effect chip + time + dismiss */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {showSourceBadge ? (
          <SourceBadge source={item.source || "agent"} sourceMeta={item.sourceMeta} />
        ) : (
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)", letterSpacing: 0.4 }}>question</span>
        )}
        {effect !== "neutral" && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "3px 8px",
            border: `1px solid ${fx.chipBorder}`,
            background: fx.chipBg,
            fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.5,
            color: fx.chipColor, textTransform: "lowercase",
          }}>
            <span style={{ letterSpacing: 0, fontSize: 10 }}>{fx.symbol}</span>
            <span>{fx.label}</span>
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)" }}>
          {timeAgo(item.t)}
        </span>
        {!answered && (
          <button onClick={onDismiss} style={{
            fontFamily: "var(--mono)", fontSize: 10, color: "var(--dim-2)",
            padding: "2px 6px", border: "1px solid var(--line)",
            background: "transparent",
            opacity: hover ? 1 : 0.45, transition: "opacity .15s",
          }}>dismiss</button>
        )}
      </div>

      {/* effect preview: tiny diagram showing what answering will do to the pipeline */}
      {!answered && effect !== "neutral" && (
        <EffectPreview effect={effect} />
      )}

      {/* question text */}
      <div style={{
        display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 10,
      }}>
        <div style={{
          width: 22, height: 22, marginTop: 2,
          border: `1px solid ${answered ? "rgba(255,122,26,0.25)" : "rgba(255,122,26,0.55)"}`,
          display: "grid", placeItems: "center", flex: "0 0 auto",
          background: collective ? "rgba(255,122,26,0.06)" : "transparent",
        }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--orange)" }}>
            {collective ? "Σ" : "h"}
          </span>
        </div>
        <div style={{
          fontFamily: "var(--sans)",
          fontSize: 15, fontWeight: 300,
          color: answered ? "var(--text-2)" : "var(--text)",
          lineHeight: 1.45,
        }}>{item.text}</div>
      </div>

      {/* chips or answered state */}
      {!answered ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginLeft: 32 }}>
            {item.chips.map(chip => (
              <Chip key={chip} onClick={() => onAnswer(chip)}>{chip}</Chip>
            ))}
          </div>
          {item.triggersHint && (
            <div style={{
              marginLeft: 32, marginTop: 8,
              fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)",
              letterSpacing: 0.3,
            }}>
              → {item.triggersHint}
            </div>
          )}
        </>
      ) : (
        <div style={{
          marginLeft: 32,
          fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
          display: "flex", alignItems: "baseline", gap: 8,
        }}>
          <span style={{ color: "var(--dim-2)" }}>your reply</span>
          <span style={{ color: dismissed ? "var(--dim-2)" : "var(--orange-2)" }}>
            "{item.choice}"
          </span>
        </div>
      )}
    </div>
  );
}

// A tiny preview row that visually telegraphs the pipeline shape change.
// Expanding: more dots after.  Narrowing: fewer dots after.  Focused: one bright dot after.
function EffectPreview({ effect }) {
  const before = [0.35, 0.55, 0.75, 0.55, 0.35];
  const after = effect === "expanding"
    ? [0.4, 0.55, 0.75, 0.95, 0.75, 0.55, 0.4]
    : effect === "narrowing"
    ? [0.6, 0.85, 0.6]
    : [1.0]; // focused

  const Dots = ({ heights, accent = false }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
    }}>
      {heights.map((h, i) => (
        <span key={i} style={{
          width: 4 + h * 4, height: 4 + h * 4,
          borderRadius: 999,
          background: accent
            ? `rgba(255,122,26,${0.35 + h * 0.55})`
            : `rgba(235,231,223,${0.15 + h * 0.25})`,
          boxShadow: accent ? `0 0 ${4 + h * 6}px rgba(255,122,26,${0.2 + h * 0.3})` : "none",
        }} />
      ))}
    </div>
  );

  return (
    <div style={{
      marginLeft: 32, marginBottom: 12,
      display: "flex", alignItems: "center", gap: 12,
      fontFamily: "var(--mono)", fontSize: 10,
      color: "var(--dim-2)", letterSpacing: 0.4,
    }}>
      <span style={{ minWidth: 50, color: "var(--dim-2)" }}>before</span>
      <Dots heights={before} />
      <span style={{ color: "var(--orange-dim)", padding: "0 4px" }}>›</span>
      <span style={{ minWidth: 40, color: "var(--dim)" }}>after</span>
      <Dots heights={after} accent />
    </div>
  );
}

function NoteLine({ children }) {
  return (
    <div className="fade-up" style={{
      marginLeft: 32,
      fontFamily: "var(--mono)", fontSize: 11.5,
      color: "var(--dim)", lineHeight: 1.5,
      display: "flex", gap: 8, alignItems: "baseline",
    }}>
      <span style={{ color: "var(--dim-2)" }}>·</span>
      <span style={{ fontStyle: "italic" }}>{children}</span>
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
  if (profile.shape === "quiet") return "i'll stay quiet. expect one or two intros at most.";
  if (profile.shape === "active") return "field's busy tonight. i'll keep the right column moving.";
  return "i'll surface a handful and check in before negotiating.";
}

function AgentLine({ children, pending, highlight, collective }) {
  // For collective/room clarifiers, swap the avatar glyph
  const glyph = collective ? "Σ" : "h";
  return (
    <div className="fade-up" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <div style={{
        width: 22, height: 22, marginTop: 2,
        border: `1px solid ${highlight ? "rgba(255,122,26,0.55)" : "rgba(255,122,26,0.3)"}`,
        display: "grid", placeItems: "center", flex: "0 0 auto",
        boxShadow: highlight ? "0 0 14px rgba(255,122,26,0.25)" : "none",
        background: collective ? "rgba(255,122,26,0.06)" : "transparent",
      }}>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--orange)" }}>{glyph}</span>
      </div>
      <div style={{
        fontFamily: "var(--sans)", fontSize: highlight ? 15 : 14,
        color: highlight ? "var(--text)" : "var(--text-2)",
        lineHeight: 1.45, maxWidth: 520, fontWeight: 300,
      }}>{children}</div>
    </div>
  );
}
function UserLine({ children }) {
  return (
    <div className="fade-up" style={{
      display: "flex", gap: 10, marginLeft: 32,
    }}>
      <span style={{ color: "var(--dim-2)", fontFamily: "var(--mono)", fontSize: 13, marginTop: 2 }}>›</span>
      <div style={{
        fontFamily: "var(--sans)", fontSize: 13.5,
        color: "var(--text-2)", maxWidth: 460, fontStyle: "italic",
      }}>"{children}"</div>
    </div>
  );
}

// --- RIGHT PANE — MATCH FEED ------------------------------------------
function MatchFeed({ tab, setTab, people, allPeople, field, funnelStages, pipelineMode, tweaks = {} }) {
  const bucket = (p) => {
    if (p.status === "accepted") return "accepted";
    if (p.status === "expired")  return "expired";
    if (p.status === "passed")   return "passed";
    if (p.status === "negotiating") return "negotiating";
    return "discovered"; // warm / considering / ready
  };
  const peopleForTab = tab === "all" ? people : people.filter(p => bucket(p) === tab);
  return (
    <div style={{
      display: "grid", gridTemplateRows: "auto auto auto 1fr",
      overflow: "hidden",
      background: "var(--bg-1)",
    }}>
      {/* header */}
      <div style={{ padding: "20px 36px 16px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11, letterSpacing: 1.6,
            textTransform: "uppercase", color: "var(--dim)",
          }}>live field</div>
          {tweaks.showModeBadge !== false && (
            <ModeBadge mode={pipelineMode} />
          )}
          <div style={{ flex: 1 }} />
          {tweaks.showFieldTicker !== false && (
            <Ticker items={field.slice(0, 8).length > 0 ? field.slice(0, 8) : [{ text: "warming up…" }]} intervalMs={2600} />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
          <h2 style={{
            margin: 0, fontFamily: "var(--sans)", fontWeight: 300,
            fontSize: 24, color: "var(--text)", letterSpacing: -0.5,
          }}>your pipeline · running</h2>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--dim)" }}>
            sorted by signal · breathes with the room
          </span>
        </div>

        {/* pipeline funnel — also acts as the filter */}
        {tweaks.showPipelineFunnel !== false && (
          <div style={{ marginTop: 18 }}>
            <PipelineFunnel
              stages={funnelStages}
              mode={pipelineMode}
              onClickStage={(label) => setTab(label)}
              activeStage={tab}
            />
          </div>
        )}
      </div>

      {/* spacer row, kept for grid alignment */}
      <div />

      {/* cards */}
      <div className="scroll" style={{
        overflowY: "auto",
        padding: "18px 36px 32px",
        display: "grid", gap: 10,
      }}>
        {peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} tweaks={tweaks} />
        ))}
        {peopleForTab.length === 0 && (
          <div style={{
            padding: 40, textAlign: "center",
            fontFamily: "var(--mono)", fontSize: 12, color: "var(--dim-2)",
          }}>
            no one in this state. the field keeps moving — check back.
          </div>
        )}
      </div>
    </div>
  );
}

function MatchCard({ person, tweaks = {} }) {
  const [hover, setHover] = useState(false);
  const isReady = person.status === "ready" || person.status === "accepted";
  const isPassed = person.status === "passed";
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="fade-up"
      style={{
        textAlign: "left",
        display: "grid", gridTemplateColumns: "auto 1fr auto",
        gap: 16, padding: "16px 18px",
        background: isReady ? "rgba(255,122,26,0.04)" : "transparent",
        border: `1px solid ${isReady ? "rgba(255,122,26,0.35)" : "var(--line)"}`,
        opacity: isPassed ? 0.4 : 1,
        boxShadow: isReady ? "inset 2px 0 0 var(--orange), 0 0 24px rgba(255,122,26,0.06)" : "none",
        transition: "all .18s ease",
        position: "relative",
      }}>
      <Avatar name={person.name} size={36} ring={isReady} />
      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--sans)", fontSize: 15, color: "var(--text)", fontWeight: 400 }}>
            {person.name}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)" }}>
            · {person.location} · {person.distance}
          </span>
        </div>
        <div style={{ fontFamily: "var(--sans)", fontSize: 13, color: "var(--text-2)", lineHeight: 1.4, fontWeight: 300 }}>
          {person.blurb}
        </div>
        {tweaks.showMatchPitch !== false && (
          <div style={{
            fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
            marginTop: 2, fontStyle: "italic", lineHeight: 1.4,
          }}>
            — {person.pitchFromAgent}
          </div>
        )}
        {tweaks.showMatchSignals !== false && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {person.signals.slice(0, 3).map(s => (
              <span key={s} style={{
                fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.3,
                color: person.overlap.includes(s) ? "var(--orange-2)" : "var(--dim)",
                padding: "1px 6px",
                border: `1px solid ${person.overlap.includes(s) ? "rgba(255,122,26,0.3)" : "var(--line)"}`,
              }}>{s}</span>
            ))}
          </div>
        )}
      </div>
      <div style={{
        display: "grid", justifyItems: "end", gap: 8, alignContent: "start",
      }}>
        <StatusBadge status={person.status} />
        {tweaks.showMatchScore !== false && (
          <>
            <ScoreBar value={person.score} w={64} />
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--dim-2)" }}>
              {Math.round(person.score * 100)}% signal
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    accepted:    { c: "var(--orange)",   t: "accepted" },
    ready:       { c: "var(--orange)",   t: "ready · intro" },
    negotiating: { c: "var(--orange-2)", t: "negotiating" },
    warm:        { c: "var(--text-2)",   t: "discovered · warm" },
    considering: { c: "var(--dim)",      t: "discovered" },
    expired:     { c: "var(--dim-2)",    t: "expired" },
    passed:      { c: "var(--dim-2)",    t: "passed" },
  };
  const cfg = map[status] || map.considering;
  return <Tag color={cfg.c} glow={status === "ready" || status === "accepted"}>{cfg.t}</Tag>;
}

// --- BOTTOM BAR --------------------------------------------------------
function BottomBar({ stats, field }) {
  return (
    <div style={{
      background: "var(--bg-1)",
      borderTop: "1px solid var(--line)",
      display: "grid", gridTemplateColumns: "1fr auto",
      alignItems: "center",
      padding: "0 20px", gap: 14,
      fontFamily: "var(--mono)", fontSize: 11, color: "var(--dim)",
    }}>
      <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
        <span style={{ color: "var(--dim-2)" }}>FIELD</span>
        <span><span style={{ color: "var(--text-2)" }}>{stats.online}</span> agents online</span>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <LiveDot size={6} />
        <span>halo · syn-0518-bk-04</span>
      </div>
    </div>
  );
}

window.MainView = MainView;
