// Main view — Mac System 6 split-window layout with full flow logic
// Same simulation logic as the original; only chrome/skin is reworked.

// How long conversations are kept before auto-deleting. Adjustable inline.
const RETENTION_OPTIONS = ["1 week", "2 weeks", "1 month", "3 months", "never"];

// Inline privacy note: chats auto-delete after a window you can change.
function RetentionNote({ retention, onChange }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6, flexWrap:"wrap",
      fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", letterSpacing:0.2,
    }}>
      <span style={{ width:6, height:6, background:"#FF8A00", border:"1px solid #000", flex:"0 0 auto" }}/>
      <span>
        {retention === "never"
          ? "conversations are kept until you delete them"
          : `conversations auto-delete after ${retention}`}
      </span>
      <button onClick={(e) => { e.stopPropagation(); onChange && onChange(); }}
        style={{
          fontFamily:"var(--mac-mono)", fontSize:10, color:"#000",
          background:"none", border:"none", padding:0, cursor:"pointer",
          textDecoration:"underline", flex:"0 0 auto",
        }}>change ›</button>
    </div>
  );
}

function MainView({ profile, people, setPeople, conversation, setConversation,
                    field, setField, stats, simRate, setSimRate, tweaks = {},
                    onOpenRoom, onBack, registerChats, pendingChat, onPendingHandled }) {
  const { EVENT, CLARIFIERS, FIELD_EVENTS, AMBIENT_NOTES } = window.HALO_DATA;
  const [tab, setTab] = useState("all");
  const [paused, setPaused] = useState(false);
  const [pipelineMode, setPipelineMode] = useState("broad");
  const modeTimerRef = useRef(null);
  const clarifierCursor = useRef(0);
  const queuedRef = useRef(false);
  const answeredSinceRefill = useRef(0);
  const MAX_OPEN = 4;

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

  /* ----- seed feed with the first batch of clarifiers (max 4 open) ----- */
  useEffect(() => {
    if (queuedRef.current) return;
    queuedRef.current = true;
    const timers = [];
    for (let k = 0; k < MAX_OPEN; k++) {
      timers.push(setTimeout(() => pushClarifierOne(), 2400 + k * 850));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const makeClarifier = () => {
    const c = CLARIFIERS[clarifierCursor.current % CLARIFIERS.length];
    clarifierCursor.current += 1;
    return {
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
    };
  };
  // Push one clarifier, but never let more than MAX_OPEN unanswered ones pile up.
  const pushClarifierOne = () => {
    setConversation(prev => {
      const open = prev.filter(it => it.kind === "clarifier" && !it.answered).length;
      if (open >= MAX_OPEN) return prev;
      return [...prev, makeClarifier()];
    });
  };
  const pushAmbientNote = () => {
    const n = AMBIENT_NOTES[Math.floor(Math.random() * AMBIENT_NOTES.length)];
    setConversation(prev => [
      ...prev,
      { kind:"note", id: Math.random().toString(36).slice(2), text: n, t: now() },
    ]);
  };

  // Ambient chatter disabled — the feed shows only questions + your responses.
  useInterval(() => {}, null);

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

  // People you're still in negotiation with — anyone not yet ready/accepted/gone.
  const negotiatingPeople = useMemo(
    () => visiblePeople.filter(p => !["accepted", "ready", "expired", "passed"].includes(p.status)),
    [visiblePeople]
  );
  const funnelStages = useMemo(() => {
    const by = (s) => visiblePeople.filter(p => p.status === s).length;
    return [
      { label:"negotiating", count: negotiatingPeople.length },
      { label:"ready",       count: by("ready"),    accent:true },
      { label:"accepted",    count: by("accepted"), accent:true },
      { label:"expired",     count: by("expired") },
    ];
  }, [visiblePeople, negotiatingPeople]);

  const answerClarifier = (item, choice) => {
    const clarifier = { id: item.clarifierId, effect: item.effect };
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered:true, choice } : it
    ));
    const effectKind = applyClarifierEffect(clarifier, choice, setPeople, setField);
    const finalKind = effectKind || (item.effect && item.effect !== "neutral" ? item.effect : "broad");
    flashMode(finalKind, finalKind === "expanding" ? 8000 : 9000);

    // Every 2 answered, top the feed back up to MAX_OPEN with fresh ones.
    answeredSinceRefill.current += 1;
    if (answeredSinceRefill.current >= 2) {
      answeredSinceRefill.current = 0;
      for (let k = 0; k < 2; k++) {
        setTimeout(() => pushClarifierOne(), 900 + k * 850);
      }
    }
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
      { kind:"user", id: Math.random().toString(36).slice(2), text, t: now() },
    ]);
    // the agent reads what you wrote and reaches back — acknowledging an
    // instruction, or answering if you asked for something.
    const reply = agentReplyTo(text, { profile, negotiatingPeople, people });
    setTimeout(() => {
      setConversation(prev => [
        ...prev,
        { kind:"agent", id: Math.random().toString(36).slice(2), text: reply, t: now() },
      ]);
    }, 650);
  };

  /* ----- chat (3rd window) — opens when you click someone in the pipeline ----- */
  const [chatId, setChatId] = useState(null);
  const [chats, setChats] = useState({});
  const [chatDraft, setChatDraft] = useState("");
  const [unread, setUnread] = useState({});   // personId -> unread count
  const [responses, setResponses] = useState({});      // your typed answer to each person's question
  const [summaryId, setSummaryId] = useState(null);    // expired person whose summary is open
  const [profileId, setProfileId] = useState(null);    // person whose profile is open
  const [retentionIdx, setRetentionIdx] = useState(1); // auto-delete window for chats
  const retention = RETENTION_OPTIONS[retentionIdx];
  const cycleRetention = () => setRetentionIdx(i => (i + 1) % RETENTION_OPTIONS.length);

  const openChat = (personId) => {
    setChatId(personId);
    setSummaryId(null);
    setProfileId(null);
    setUnread(prev => (prev[personId] ? { ...prev, [personId]: 0 } : prev));
    setChats(prev => {
      if (prev[personId]) return prev;
      const person = people.find(p => p.id === personId);
      return person ? { ...prev, [personId]: seedChat(person, responses[personId]) } : prev;
    });
  };
  const openSummary = (personId) => { setSummaryId(personId); setChatId(null); setProfileId(null); };
  const openProfile = (personId) => { setProfileId(personId); setChatId(null); setSummaryId(null); };
  const closeChats = () => { setChatId(null); setSummaryId(null); setProfileId(null); };

  // Negotiating people are waiting on a response to their question. Responding
  // clears the negotiation and makes them ready — that's when the opportunity
  // to accept appears. Accepting (only available once ready) opens the chat.
  const respondPerson = (personId, text) => {
    const person = people.find(p => p.id === personId);
    setPeople(prev => prev.map(p =>
      p.id === personId ? { ...p, status: "ready" } : p));
    if (text && text.trim()) {
      setResponses(prev => ({ ...prev, [personId]: text.trim() }));
    }
    // Leave a quiet record so the answered question rises into the scrollback
    // instead of just vanishing. Collective answers (one question, many people)
    // dedupe so they only post once.
    if (person) {
      const q = personQuestion(person);
      setConversation(prev => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "clarifier" && last.answered && last.text === q) return prev;
        return [...prev, {
          kind: "clarifier", answered: true,
          id: "pq-" + personId + "-" + prev.length,
          text: q,
          choice: (text && text.trim()) ? text.trim() : "answered",
          source: "person",
          sourceMeta: { name: person.name },
        }];
      });
    }
  };
  const acceptPerson = (personId) => {
    setPeople(prev => prev.map(p =>
      p.id === personId ? { ...p, status: "accepted" } : p));
  };
  // Pass is the other half of the ready-stage decision — decline the intro
  // instead of accepting it. They drop out of the radar into "passed".
  const passPerson = (personId) => {
    if (chatId === personId) closeChats();
    setPeople(prev => prev.map(p =>
      p.id === personId ? { ...p, status: "passed" } : p));
  };
  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text || !chatId) return;
    const id = chatId;
    setChatDraft("");
    setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"you", text }] }));
    setTimeout(() => {
      setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"them", text: chatReplyFor(text) }] }));
    }, 700);
  };

  // Agents you've already talked to occasionally ping you. If their chat isn't
  // the one you're looking at, it just bumps a quiet unread marker — no popups.
  useInterval(() => {
    if (paused) return;
    const candidates = Object.keys(chats).filter(id => id !== chatId);
    if (candidates.length === 0) return;
    const pid = candidates[Math.floor(Math.random() * candidates.length)];
    const person = people.find(p => p.id === pid);
    setChats(prev => ({ ...prev, [pid]: [...(prev[pid] || []), { id: rid(), who:"them", text: incomingPing(person) }] }));
    setUnread(prev => ({ ...prev, [pid]: (prev[pid] || 0) + 1 }));
  }, (paused || Object.keys(chats).length === 0) ? null : 16000 / simRate);

  const chatPerson = chatId ? people.find(p => p.id === chatId) : null;
  const summaryPerson = summaryId ? people.find(p => p.id === summaryId) : null;
  const profilePerson = profileId ? people.find(p => p.id === profileId) : null;
  const thirdOpen = !!(chatPerson || summaryPerson || profilePerson);
  const chatIds = Object.keys(chats);
  const unreadTotal = chatIds.reduce((a, id) => a + (unread[id] || 0), 0);
  const roster = chatIds.map(id => {
    const p = people.find(x => x.id === id);
    return { id, name: p ? p.name : id, unread: unread[id] || 0, active: id === chatId };
  });
  const conversations = chatIds.map(id => {
    const p = people.find(x => x.id === id);
    const msgs = chats[id] || [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    return {
      id, person: p, name: p ? p.name : id,
      unread: unread[id] || 0,
      last: last ? last.text : "",
      lastWho: last ? last.who : null,
    };
  }).sort((a, b) => b.unread - a.unread);

  // Publish this signal's chat list up to the top menubar (which groups by
  // signal). Keep openChat fresh via a ref; re-publish only when the list/unread
  // change (rosterKey). We don't clear on unmount, so the menu persists across
  // screens (works from the landing screen too).
  const openChatRef = useRef(openChat);
  openChatRef.current = openChat;
  const signalTitle = profile.intent || "your signal";
  const rosterKey = roster.map(r => `${r.id}:${r.unread}`).join("|");
  useEffect(() => {
    if (registerChats) registerChats(signalTitle, roster, (id) => openChatRef.current(id));
  }, [rosterKey, signalTitle]);

  // When asked to open a specific chat after resuming a signal from the menubar.
  useEffect(() => {
    if (pendingChat) {
      openChat(pendingChat);
      onPendingHandled && onPendingHandled();
    }
  }, [pendingChat]);

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid",
      gridTemplateRows:"1fr",
      // extra top margin keeps the window chrome clear of the floating
      // traffic lights; roomier margins all round frame it on the desktop
      padding: "34px 18px 18px", gap: 8,
    }}>
      <div style={{
        display:"grid",
        // Opening a chat splits into a third column — the pipeline narrows to
        // make room rather than the chat floating on top.
        gridTemplateColumns: thirdOpen
          ? "minmax(360px, 40fr) minmax(300px, 30fr) minmax(320px, 30fr)"
          : "minmax(440px, 56fr) minmax(340px, 44fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        gap: 8, minHeight:0,
      }}>
        <MacWindow title="index · your signals" onClose={onBack}>
          <ConversationPane
            profile={profile}
            conversation={conversation}
            onAnswer={answerClarifier}
            onDismiss={dismissClarifier}
            draft={draft} setDraft={setDraft} sendDraft={sendDraft}
            negotiatingPeople={negotiatingPeople}
            onRespondPerson={respondPerson}
            paused={paused}
            onTogglePause={() => setPaused(p => !p)}
            onStop={onBack}
          />
        </MacWindow>

        <MacWindow title="index · your radar" onClose={onBack}>
          <MatchFeed
            tab={tab} setTab={setTab}
            profile={profile}
            people={filtered}
            allPeople={visiblePeople}
            field={field}
            funnelStages={funnelStages}
            pipelineMode={pipelineMode}
            onOpenRoom={openChat}
            onAccept={acceptPerson}
            onPass={passPerson}
            onSummary={openSummary}
            onProfile={openProfile}
            unread={unread}
            chatIds={chatIds}
          />
        </MacWindow>

        {thirdOpen && (
          chatPerson ? (
            <ChatWindow
              person={chatPerson}
              messages={chats[chatId] || []}
              draft={chatDraft}
              setDraft={setChatDraft}
              onSend={sendChat}
              onClose={closeChats}
              retention={retention}
              onChangeRetention={cycleRetention}
            />
          ) : summaryPerson ? (
            <SummaryWindow person={summaryPerson} onClose={closeChats}/>
          ) : profilePerson ? (
            <ProfileWindow
              person={profilePerson}
              onClose={closeChats}
              onAccept={acceptPerson}
              onPass={passPerson}
              onOpenChat={openChat}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

function now() { return Date.now(); }

// Lightweight in-app responder. Reads what you wrote and reaches back in the
// agent's voice — acknowledging an instruction, declining, or answering an
// info question. Heuristic, not a model: it routes on intent words.
function agentReplyTo(raw, ctx = {}) {
  const t = (raw || "").trim().toLowerCase();
  const negCount = (ctx.negotiatingPeople || []).length;
  const ready = (ctx.people || []).filter(p => p.status === "ready").length;
  const top = (ctx.people || []).filter(p => !p.hidden && p.status !== "passed" && p.status !== "expired")
    .sort((a, b) => b.score - a.score)[0];

  const has = (...ws) => ws.some(w => t.includes(w));
  const isQuestion = /\?\s*$/.test(t) || /^(who|what|when|where|why|how|which|do|does|is|are|can|could|should|any)\b/.test(t);

  // asking for something — answer from the field
  if (isQuestion) {
    if (has("how many", "how much") && has("negotiat", "talking", "pending"))
      return `${negCount} in negotiation right now · ${ready} ready when you are.`;
    if (has("who", "best", "top", "strongest", "closest"))
      return top
        ? `closest overlap right now is ${top.name.toLowerCase()} — ${top.blurb || "strong signal on what you're tracking"}.`
        : "field's still warming up — nothing strong enough to surface yet.";
    if (has("ready"))
      return `${ready} ready to move. they're at the top of your radar, marked ready.`;
    return "looking. i'll surface what's relevant on your radar — give me a beat.";
  }

  // declining / stop / negation
  if (has("don't", "dont", "stop", "no ", "never", "drop", "ignore", "not interested", "pass on"))
    return "won't do that. i'll steer the field away from it and keep the rest moving.";

  // remember / note for later
  if (has("remember", "keep in mind", "note", "later", "for now", "fyi"))
    return "noted. i'll keep that in mind as i read the field.";

  // instruction / preference — focus, prioritize, find
  if (has("focus", "prioriti", "anchor", "narrow", "only", "more of", "find", "look for", "show me", "surface", "prefer"))
    return "okay, i'll do that — re-weighting your radar toward it now.";

  // greeting / smalltalk
  if (has("hey", "hi", "hello", "yo", "thanks", "thank you", "ok", "okay", "cool", "got it"))
    return "here · always reading the field. tell me what to anchor on whenever.";

  // default acknowledgment
  return "got it. folding that into what i'm tracking for you.";
}

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
    phrase = `passed cleanly · ${passedNames.length} candidates dropped from the radar.`;
  else if (mode === "expanding")
    phrase = changedNames ? `radar expanding · pulling ${changedNames} in.` : "radar expanding · widening the pool.";
  else if (mode === "narrowing")
    phrase = changedNames ? `radar narrowing · ${changedNames} adjusted.` : "radar narrowing · pruning the long tail.";
  else if (mode === "focused")
    phrase = changedNames ? `radar focusing · ${changedNames} locked in.` : "radar focusing · committing to the top signals.";
  else
    phrase = changedNames ? `your answer rippled · ${changedNames} updated.` : "noted. minor adjustments to the radar.";

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
        <span style={{ letterSpacing:3, textTransform:"uppercase", fontWeight:700 }}>index</span>
        <span>/</span>
        <span>always on · {EVENT.arrived} online</span>
      </div>
      <div/>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
        <span style={{ color:"var(--ink-2)" }}>sim</span>
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
// Small Workbench-style control for managing the running signal (pause / stop).
function SignalAction({ label, active = false, onClick }) {
  const [hover, setHover] = useState(false);
  const on = active || hover;
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily:"var(--mac-mono)", fontSize:11,
        padding:"2px 10px", whiteSpace:"nowrap",
        border:"1px solid #000",
        background: on ? "#000" : "#fff",
        color: on ? "#fff" : "#000",
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
      }}>{label}</button>
  );
}

function ConversationPane({ profile, conversation, onAnswer, onDismiss, draft, setDraft, sendDraft, negotiatingPeople = [], onRespondPerson, paused = false, onTogglePause, onStop }) {
  const scrollRef = useRef(null);
  const [stuck, setStuck] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(conversation.length);
  // Distance from the bottom of the feed, kept live as you scroll. We restore
  // this exact gap after any content change so answering a question (which
  // shrinks its card) never yanks the viewport around.
  const bottomGap = useRef(0);
  const pendingCount = useMemo(
    () => conversation.filter(it => it.kind === "clarifier" && !it.answered).length,
    [conversation]
  );

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = conversation.length > lastLen.current;
    if (bottomGap.current <= 24) {
      // pinned to the bottom — stay pinned, following new content
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else {
      // scrolled up — hold the same spot so nothing jumps under you
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - bottomGap.current);
      if (grew) setUnread(u => u + (conversation.length - lastLen.current));
    }
    lastLen.current = conversation.length;
  }, [conversation, negotiatingPeople]);

  const onScroll = (e) => {
    const el = e.currentTarget;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    bottomGap.current = gap;
    const atBottom = gap < 24;
    setStuck(atBottom);
    if (atBottom) setUnread(0);
  };
  const jumpToBottom = () => {
    if (scrollRef.current) {
      bottomGap.current = 0;
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setStuck(true); setUnread(0);
    }
  };

  return (
    <div style={{
      display:"grid", gridTemplateRows:"auto 1fr auto",
      flex:1, minHeight:0, position:"relative",
    }}>
      {/* fixed signal header — the signal you're tracking, plus the controls
          to pause or stop the agent working on it */}
      <div style={{
        padding:"12px 18px 12px",
        minHeight:68, boxSizing:"border-box",
        borderBottom:"1px solid #000",
        background:"#fff",
      }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
          <h2 style={{
            margin:0, fontFamily:"var(--amiga-title)", fontWeight:500,
            fontSize:17, color:"#000", letterSpacing:-0.2, lineHeight:1.2, flex:1, minWidth:0,
          }}>{profile.intent || "your signal"}</h2>
          <div style={{ display:"flex", gap:6, flex:"0 0 auto" }}>
            <SignalAction
              label={paused ? "▶ resume" : "❚❚ pause"}
              active={paused}
              onClick={() => onTogglePause && onTogglePause()}
            />
            <SignalAction label="✕ stop" onClick={() => onStop && onStop()}/>
          </div>
        </div>
        <div style={{
          marginTop:8, display:"flex", alignItems:"center", gap:8,
          fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3, color:"var(--ink-2)",
        }}>
          <span style={{
            display:"inline-flex", alignItems:"center", gap:5,
            color: paused ? "var(--ink-3)" : "#000",
          }}>
            <span style={{
              width:7, height:7, borderRadius:"50%",
              background: paused ? "var(--ink-4)" : "#1FA95B",
              boxShadow: paused ? "none" : "0 0 0 2px rgba(31,169,91,0.25)",
            }}/>
            {paused ? "paused · agent on hold" : "live · agent is looking in the background"}
          </span>
          {!paused && (pendingCount + negotiatingPeople.length) > 0 && (
            <React.Fragment>
              <span style={{ color:"var(--ink-4)" }}>·</span>
              <span style={{
                background:"#000", color:"#fff",
                padding:"1px 8px",
              }}>{pendingCount + negotiatingPeople.length} questions waiting on you</span>
            </React.Fragment>
          )}
        </div>
      </div>

      {/* feed body */}
      <div ref={scrollRef} onScroll={onScroll} className="mac-scroll" style={{
        overflowY:"auto", padding:"16px 18px 8px",
        display:"flex", flexDirection:"column",
      }}>
        {/* inner column pinned to the bottom — messages stack just above the
            input and only grow upward into the scrollback as they accumulate */}
        <div style={{
          marginTop:"auto",
          display:"flex", flexDirection:"column", gap:14,
        }}>
          {/* standing questions from people in your radar */}
          {groupQuestions(negotiatingPeople).map(g =>
            g.people.length >= 2 ? (
              <CollectiveQuestionCard key={"cq-" + g.q} question={g.q} people={g.people} onRespond={onRespondPerson}/>
            ) : (
              <PersonQuestionCard key={"pq-" + g.people[0].id} person={g.people[0]} onRespond={onRespondPerson}/>
            )
          )}

          {/* one chronological stream — questions stay exactly where they
              arrived. answering one updates it in place (shows your reply)
              instead of yanking it up to the top of the feed */}
          {conversation
            .filter(it => it.kind === "clarifier" || it.kind === "user" || it.kind === "agent")
            .map((it) =>
              it.kind === "clarifier" ? (
                <ClarifierCard key={it.id} item={it}
                  onAnswer={(choice) => onAnswer(it, choice)}
                  onDismiss={() => onDismiss(it)}/>
              ) : it.kind === "user" ? (
                <UserLine key={it.id}>{it.text}</UserLine>
              ) : (
                <AgentLine key={it.id}>{it.text}</AgentLine>
              )
            )}
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
          boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
        }}>↓ {unread} new</button>
      )}

      {/* Composer. White-on-white with a hairline rule made this read as more
          conversation rather than as the place you type, so the band gets the
          quiet fill and the 2px rule the app uses for major divisions, and the
          field itself gets the sunken well from the settings inputs. Grey
          around, white sunken inside — the input is the only editable thing
          here, so it should be the only thing that looks editable. */}
      <div style={{
        borderTop:"2px solid #000",
        padding:"10px 14px",
        background:"#F2F0EC",
      }}>
        <div style={{
          display:"flex", gap:10, alignItems:"center",
          border:"1px solid #000", background:"#fff",
          boxShadow:"inset 1px 1px 0 var(--ink-3), inset -1px -1px 0 #FFF",
          padding:"7px 11px",
        }}>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:13, color:"#000" }}>›</span>
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") sendDraft(); }}
            placeholder="message index — or just let it keep working"
            style={{
              flex:1, background:"transparent", border:"none", outline:"none",
              color:"#000", fontFamily:"var(--mac-sans)", fontSize:13,
              padding:"2px 0",
            }}
          />
          {draft.trim() && (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>↵</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* =================== CLARIFIER CARD =================== */
// Group negotiating people by the question their agent is asking, so duplicates
// surface as a single collective question instead of many identical cards.
function groupQuestions(people) {
  const m = {};
  (people || []).forEach(p => {
    const q = personQuestion(p);
    (m[q] = m[q] || []).push(p);
  });
  return Object.keys(m).map(q => ({ q, people: m[q] }));
}

/* When 2+ people's agents ask the same thing — answer once, respond to all. */
// Shared shell for every feed question. The question is the focal point;
// the source line and chrome stay quiet so the eye lands on what's being asked.
function QuestionCard({ icon, source, tag, question, chips = [], onChip, onWrite, writePlaceholder = "type your own answer" }) {
  const [draft, setDraft] = useState("");
  const submit = () => { if (!draft.trim()) return; onWrite && onWrite(draft.trim()); setDraft(""); };
  return (
    <div className="fade-up" style={{
      border:"1px solid #000", background:"#fff",
      padding:"14px 16px", display:"grid", gap:11,
    }}>
      {/* quiet source line */}
      <div style={{
        display:"flex", alignItems:"center", gap:7, minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", letterSpacing:0.3,
      }}>
        {icon}
        <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 }}>{source}</span>
        {tag && <span style={{ color:"var(--ink-4)", flex:"0 0 auto" }}>· {tag}</span>}
      </div>
      {/* the question — the hero */}
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500,
        lineHeight:1.4, color:"#000", letterSpacing:-0.1,
      }}>{question}</div>
      {/* suggested options as a lettered list, then a write-your-own row that
          shares the exact same framing — answer however you like */}
      <div style={{ display:"grid", gap:6 }}>
        {chips.map((c, i) => (
          <OptionRow key={c} letter={String.fromCharCode(65 + i)} label={c} onClick={() => onChip && onChip(c)}/>
        ))}
        <div style={{
          display:"flex", alignItems:"center", gap:10,
          border:"1px solid #000", padding:"7px 9px",
        }}>
          <span style={{
            flex:"0 0 auto", width:18,
            textAlign:"center",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-3)",
          }}>✎</span>
          <input
            value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            placeholder={writePlaceholder}
            style={{
              flex:1, background:"transparent", color:"#000",
              border:"none", outline:"none",
              fontFamily:"var(--mac-sans)", fontSize:13, padding:"2px 0",
            }}
          />
          {draft.trim() && (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-2)" }}>↵</span>
          )}
        </div>
      </div>
    </div>
  );
}

// A single stacked option — letter badge + full-width label, in the same frame
// as the write-your-own row so every answer choice reads consistently.
function OptionRow({ letter, label, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:"flex", alignItems:"center", gap:10, textAlign:"left",
        width:"100%", padding:"7px 9px", cursor:"pointer",
        border:"1px solid #000",
        background: hover ? "#000" : "#fff",
        color: hover ? "#fff" : "#000",
      }}>
      <span style={{
        flex:"0 0 auto", width:18, height:18,
        display:"grid", placeItems:"center",
        border:`1px solid ${hover ? "#fff" : "#000"}`,
        fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
      }}>{letter}</span>
      <span style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.35 }}>{label}</span>
    </button>
  );
}

function CollectiveQuestionCard({ question, people, onRespond }) {
  return (
    <QuestionCard
      icon={<span style={{ fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:700, color:"#000" }}>⁂</span>}
      source={`${people.length} people asking the same`}
      tag="collective"
      question={question}
      chips={questionChips(question)}
      onChip={(c) => people.forEach(p => onRespond && onRespond(p.id, c))}
      onWrite={(t) => people.forEach(p => onRespond && onRespond(p.id, t))}
      writePlaceholder={`answer all ${people.length} in your own words`}
    />
  );
}

/* A specific person's negotiation question, answered here in the feed.
   Answering moves them from "negotiating" to "ready" on the radar. */
function PersonQuestionCard({ person, onRespond }) {
  const q = personQuestion(person);
  return (
    <QuestionCard
      icon={<Avatar name={person.name} size={18}/>}
      source={`from ${person.name}`}
      tag="negotiating"
      question={q}
      chips={questionChips(q)}
      onChip={(c) => onRespond && onRespond(person.id, c)}
      onWrite={(t) => onRespond && onRespond(person.id, t)}
    />
  );
}

function ClarifierCard({ item, onAnswer, onDismiss }) {
  const collective = item.source === "collective" || item.source === "room";
  const meta = item.sourceMeta || {};
  const sourceLabel = collective
    ? (meta.count ? `${meta.count} ${meta.of || "agents"}` : "your circle")
    : (meta.name ? `from ${meta.name}` : "from an agent");

  // Answered clarifiers stay in place as a resolved record — same black frame
  // as a live question, with the choice you made shown as a filled answer.
  if (item.answered) {
    return (
      <div className="fade-up" style={{
        border:"1px solid #000", background:"#fff",
        padding:"12px 16px", display:"grid", gap:9,
        opacity: item.dismissed ? 0.5 : 1,
      }}>
        <div style={{
          display:"flex", alignItems:"center", gap:7, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", letterSpacing:0.3,
        }}>
          <span style={{ color:"#000", fontWeight: collective ? 700 : 400 }}>{collective ? "⁂" : "›"}</span>
          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 }}>{sourceLabel}</span>
          <div style={{ flex:1 }}/>
          <span style={{
            flex:"0 0 auto", color:"#fff", background:"#000",
            padding:"1px 8px", letterSpacing:0.3,
          }}>{item.dismissed ? "dismissed" : "✓ answered"}</span>
        </div>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:14, fontWeight:500,
          color:"#000", lineHeight:1.4, letterSpacing:-0.1,
        }}>{item.text}</div>
        {!item.dismissed && (
          <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0 }}>
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", flex:"0 0 auto" }}>you</span>
            <span style={{
              fontFamily:"var(--mac-sans)", fontSize:13,
              background:"#000", color:"#fff",
              padding:"3px 12px", lineHeight:1.35,
            }}>{item.choice}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <QuestionCard
      icon={<span style={{ fontFamily:"var(--mac-mono)", fontSize:12, fontWeight: collective ? 700 : 400, color:"#000" }}>{collective ? "⁂" : "›"}</span>}
      source={sourceLabel}
      tag={collective ? "collective" : "agent"}
      question={item.text}
      chips={item.chips}
      onChip={(c) => onAnswer(c)}
      onWrite={(t) => onAnswer(t)}
    />
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
      fontFamily:"var(--mac-mono)", fontSize:11,
      color:"var(--ink-2)", lineHeight:1.5,
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

// Monochrome robot mark — the agent's face. Stroked black on white so it
// sits in the Workbench palette next to the human avatars.
function RobotGlyph({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="#000" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter"
      style={{ display:"block" }}>
      <line x1="12" y1="3" x2="12" y2="6"/>
      <circle cx="12" cy="2.5" r="1" fill="#000" stroke="none"/>
      <rect x="4" y="6" width="16" height="12" rx="1.5"/>
      <line x1="2" y1="11" x2="4" y2="11"/>
      <line x1="20" y1="11" x2="22" y2="11"/>
      <rect x="8.5" y="10" width="2" height="2.5" fill="#000" stroke="none"/>
      <rect x="13.5" y="10" width="2" height="2.5" fill="#000" stroke="none"/>
      <line x1="9" y1="15" x2="15" y2="15"/>
    </svg>
  );
}

function AgentLine({ children, pending, highlight, collective }) {
  return (
    <div className="fade-up" style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      {collective ? (
        <div style={{
          width:22, height:22, marginTop:2,
          border:"1px solid #000",
          display:"grid", placeItems:"center", flex:"0 0 auto",
          background:"#000", color:"#fff",
        }}>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:10 }}>⁂</span>
        </div>
      ) : (
        <div style={{
          width:22, height:22, marginTop:2,
          border:"1px solid #000",
          display:"grid", placeItems:"center", flex:"0 0 auto",
          background:"#fff",
        }}>
          <RobotGlyph size={14}/>
        </div>
      )}
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize: highlight ? 14.5 : 14,
        color:"#000", lineHeight:1.45, maxWidth:520,
      }}>{children}</div>
    </div>
  );
}
// A message you typed — rendered as a sent bubble on the right, so the
// conversation reads like a chat: your words land at the bottom, distinct
// from the questions coming in on the left.
function UserLine({ children }) {
  return (
    <div className="fade-up" style={{ display:"flex", justifyContent:"flex-end" }}>
      <div style={{
        maxWidth:"78%",
        background:"#000", color:"#fff",
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4,
        padding:"8px 12px",
        border:"1px solid #000",
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
        wordBreak:"break-word",
      }}>{children}</div>
    </div>
  );
}

/* =================== RIGHT — MATCH FEED =================== */
function MatchFeed({ tab, setTab, people, field, funnelStages, pipelineMode, onOpenRoom, onAccept, onPass, onSummary, onProfile, unread = {}, chatIds = [], profile = {} }) {
  const bucket = (p) => {
    if (p.status === "accepted") return "accepted";
    if (p.status === "expired")  return "expired";
    if (p.status === "ready")    return "ready";
    if (p.status === "passed")   return "passed";
    return "negotiating";
  };
  const peopleForTab = tab === "all" ? people : people.filter(p => bucket(p) === tab);
  return (
    <div style={{ display:"grid", gridTemplateRows:"auto 1fr", flex:1, minHeight:0 }}>
      <div style={{
        padding:"0 22px", minHeight:68, boxSizing:"border-box",
        display:"flex", alignItems:"center",
        borderBottom:"1px solid #000",
      }}>
        <div style={{ flex:1, minWidth:0 }}>
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
        display:"grid", gap:8, alignContent:"start",
      }}>
        {peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} onOpenRoom={onOpenRoom} onAccept={onAccept} onPass={onPass} onSummary={onSummary} onProfile={onProfile}
            hasChat={chatIds.includes(p.id)} unreadCount={unread[p.id] || 0}/>
        ))}
        {peopleForTab.length === 0 && (
          <div style={{
            padding:28, textAlign:"center",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
            border:"1px dashed #000",
          }}>{
            tab === "accepted" ? "no one accepted yet — accept someone from your ready list."
            : tab === "expired" ? "nothing expired — these are people the moment passed on."
            : tab === "ready"   ? "no one ready yet — answer their questions in the feed first."
            : "no one here right now. the field keeps moving — check back."
          }</div>
        )}
      </div>
    </div>
  );
}

// Each negotiation question carries a few predefined responses (chips) plus the
// option to write your own.
const PERSON_QUESTIONS = [
  { q: "before we talk — are you hiring, collaborating, or just comparing notes?",
    chips: ["hiring", "collaborating", "comparing notes"] },
  { q: "what's the timeline you're working with?",
    chips: ["soon", "this quarter", "no rush"] },
  { q: "what would make an intro worth your time?",
    chips: ["strong overlap", "a warm intro", "a shared goal"] },
  { q: "are you exploring, or ready to move on something?",
    chips: ["exploring", "ready to move", "still deciding"] },
];
function personQuestionEntry(person) {
  const s = person.id || person.name || "x";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PERSON_QUESTIONS[h % PERSON_QUESTIONS.length];
}
function personQuestion(person) { return personQuestionEntry(person).q; }
function questionChips(question) {
  const e = PERSON_QUESTIONS.find(x => x.q === question);
  return e ? (e.chips || []) : [];
}

// Small reusable answer chip (matches the feed clarifier chips).
function AnswerChip({ label, onClick }) {
  return (
    <button onClick={onClick}
      style={{
        padding:"2px 12px",
        fontFamily:"var(--mac-sans)", fontSize:12,
        border:"1px solid #000", background:"transparent", color:"#000",
        borderRadius:9, cursor:"pointer",
      }}
      onMouseDown={(e) => { e.currentTarget.style.background = "#000"; e.currentTarget.style.color = "#fff"; }}
      onMouseUp={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#000"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#000"; }}
    >{label}</button>
  );
}

function MatchCard({ person, onOpenRoom, onAccept, onPass, onSummary, onProfile, hasChat = false, unreadCount = 0 }) {
  const openProfile = (e) => { e.stopPropagation(); onProfile && onProfile(person.id); };
  const [hover, setHover] = useState(false);
  const accepted = person.status === "accepted";
  const readyStage = person.status === "ready";   // opportunity to accept
  const isPassed = person.status === "passed";
  const isExpired = person.status === "expired";
  // everyone else discovered is still in negotiation — they have an open question
  const negotiating = !accepted && !readyStage && !isPassed && !isExpired;
  const cardClickable = accepted || isExpired;    // accepted opens chat; expired opens summary
  const handleClick = accepted
    ? () => onOpenRoom && onOpenRoom(person.id)
    : isExpired
      ? () => onSummary && onSummary(person.id)
      : undefined;
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={handleClick}
      className="fade-up"
      style={{
        textAlign:"left",
        display:"grid", gridTemplateColumns:"auto 1fr auto",
        gap:14, padding:"14px 14px",
        background:"#fff", color:"#000",
        border:"1px solid #000",
        borderLeft: accepted ? "3px solid #FF8A00" : "1px solid #000",
        // filter (not opacity) — the .fade-up animation ends at opacity:1 and would override it
        filter: (isPassed || isExpired) ? "opacity(0.45)" : "none",
        boxShadow: (cardClickable && hover) ? "2px 2px 0 rgba(0,0,0,0.22)" : "none",
        transform: (cardClickable && hover) ? "translate(-1px, -1px)" : "none",
        cursor: cardClickable ? "pointer" : "default",
        transition:"all .12s ease",
      }}>
      <span onClick={openProfile} title="view profile" style={{ cursor:"pointer", lineHeight:0 }}>
        <Avatar name={person.name} size={36} ring={accepted}/>
      </span>
      <div style={{ display:"grid", gap:3, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span onClick={openProfile} title="view profile" style={{
            fontFamily:"var(--mac-sans)", fontSize:15, fontWeight:600, cursor:"pointer",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
          onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}>
            {person.name}
          </span>
        </div>
        <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4 }}>
          {person.blurb}
        </div>
      </div>
      <div style={{ display:"grid", justifyItems:"end", gap:6, alignContent:"start" }}>
        {accepted ? (
          <React.Fragment>
            {unreadCount > 0 && (
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
                background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"0 5px",
              }}>{unreadCount} new</span>
            )}
            <button
              className="amiga-gadget primary"
              onClick={(e) => { e.stopPropagation(); onOpenRoom && onOpenRoom(person.id); }}
              style={{ fontFamily:"var(--mac-mono)", fontSize:10, padding:"3px 12px" }}
            >{hasChat ? "open chat ›" : "send message"}</button>
          </React.Fragment>
        ) : readyStage ? (
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <button
              className="amiga-gadget primary"
              onClick={(e) => { e.stopPropagation(); onAccept && onAccept(person.id); }}
              style={{ fontFamily:"var(--mac-mono)", fontSize:10, padding:"2px 12px" }}
            >accept</button>
            <button
              className="amiga-gadget"
              onClick={(e) => { e.stopPropagation(); onPass && onPass(person.id); }}
              style={{ fontFamily:"var(--mac-mono)", fontSize:10, padding:"2px 12px" }}
            >pass</button>
          </div>
        ) : negotiating ? (
          <span style={{
            display:"flex", alignItems:"center", gap:5,
            fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1,
            textTransform:"uppercase", color:"var(--ink-2)",
          }}>
            <span style={{ width:6, height:6, background:"#FF8A00", border:"1px solid #000", flex:"0 0 auto" }}/>
            negotiating
          </span>
        ) : isExpired ? (
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, opacity:0.75 }}>
            expired · summary ›
          </span>
        ) : (
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, opacity:0.5 }}>
            {person.status}
          </span>
        )}
      </div>
    </div>
  );
}

/* =================== CHAT WINDOW (3rd window) =================== */
function rid() { return Math.random().toString(36).slice(2); }

function seedChat(person, priorAnswer) {
  const ov = (person.overlap && person.overlap[0]) || null;
  const msgs = [
    { who: "index",
      text: `you're connected with ${person.name}. ${person.pitchFromAgent || ""}`.trim() },
  ];
  if (priorAnswer) {
    // Carry the negotiation question + your typed answer into the chat.
    msgs.push({ who: "them", text: personQuestion(person) });
    msgs.push({ who: "you",  text: priorAnswer });
    msgs.push({ who: "them",
      text: ov
        ? `thanks — and we've both got '${ov}' in common, so this should be easy. when works to talk?`
        : `thanks for that. when works to talk?` });
  } else {
    msgs.push({ who: "them",
      text: ov
        ? `hi — good to meet you. looks like we've both got '${ov}' in common, so this might be easy. what are you hoping to get out of this?`
        : `hi — good to meet you. looks like our signals line up. what are you hoping to get out of this?` });
  }
  return msgs.map(m => ({ id: rid(), ...m }));
}

function chatReplyFor(text) {
  const t = text.toLowerCase();
  if (t.includes("meet") || t.includes("call") || t.includes("time") || t.includes("week") || t.includes("coffee"))
    return "i've got a couple of openings this week — want to grab 20 minutes?";
  if (t.includes("no") || t.includes("pass") || t.includes("not interested"))
    return "all good — i'll keep an eye out if anything changes.";
  if (t.includes("?"))
    return "good question — let me think on it and get back to you.";
  return "got it. anything you'd want me to know up front?";
}

function incomingPing(person) {
  const lines = [
    "quick follow-up — i freed up some time this week if you want it.",
    "i just re-read your signal. still keen.",
    "small nudge: i'd love to compare notes when you're free.",
    "i'm around tomorrow afternoon if that helps.",
    "wanted to check — would you want a warm intro first?",
  ];
  return lines[Math.floor(Math.random() * lines.length)];
}

function initials(name) {
  return (name || "")
    .split(/\s+/)
    .map(s => s[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Inbox({ conversations, onOpen, onClose, retention, onChangeRetention }) {
  const totalUnread = conversations.reduce((a, c) => a + (c.unread || 0), 0);
  return (
    <MacWindow title="index · messages" onClose={onClose} style={{ minHeight:0 }}>
      <div style={{ display:"grid", gridTemplateRows:"auto 1fr auto", flex:1, minHeight:0 }}>
        {/* header */}
        <div style={{ padding:"12px 16px", borderBottom:"1px solid #000", background:"#fff" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{
              fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
              textTransform:"uppercase", color:"#000",
            }}>your conversations</span>
            <div style={{ flex:1 }}/>
            {totalUnread > 0 && (
              <span style={{
                fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
                background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"0 6px",
              }}>{totalUnread} new</span>
            )}
          </div>
          <h2 style={{
            margin:"6px 0 0", fontFamily:"var(--amiga-title)", fontWeight:500,
            fontSize:17, color:"#000", letterSpacing:-0.2,
          }}>messages</h2>
        </div>

        {/* conversation list */}
        <div className="mac-scroll" style={{ overflowY:"auto", padding:"10px 12px", display:"grid", gap:8, alignContent:"start" }}>
          {conversations.length === 0 ? (
            <div style={{
              padding:24, textAlign:"center",
              fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
              border:"1px dashed #000",
            }}>no conversations yet — open someone from your radar to start one.</div>
          ) : conversations.map(c => (
            <button key={c.id} onClick={() => onOpen(c.id)} style={{
              textAlign:"left", display:"grid", gridTemplateColumns:"auto 1fr auto",
              gap:12, alignItems:"center", padding:"10px 12px",
              border:"1px solid #000", background:"#fff", cursor:"pointer",
              boxShadow: c.unread > 0
                ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 rgba(0,0,0,0.2)"
                : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3), 1px 1px 0 rgba(0,0,0,0.2)",
            }}>
              <Avatar name={c.name} size={32}/>
              <div style={{ display:"grid", gap:3, minWidth:0 }}>
                <div style={{ fontFamily:"var(--amiga-title)", fontSize:14, fontWeight:600, color:"#000" }}>
                  {c.name}
                </div>
                <div style={{
                  fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-2)",
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                }}>
                  {c.lastWho === "you" ? "you: " : ""}{c.last}
                </div>
              </div>
              {c.unread > 0 ? (
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
                  background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"0 6px",
                  flex:"0 0 auto",
                }}>{c.unread}</span>
              ) : (
                <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", flex:"0 0 auto" }}>›</span>
              )}
            </button>
          ))}
        </div>

        {/* retention note */}
        <div style={{ borderTop:"1px solid #000", padding:"10px 14px", background:"#fff" }}>
          <RetentionNote retention={retention} onChange={onChangeRetention}/>
        </div>
      </div>
    </MacWindow>
  );
}

// Deterministic "why it expired" line for the summary view.
function expiryReason(person) {
  const R = [
    "the moment passed — they committed to something else before you replied.",
    "they went quiet, and your agent stopped surfacing them after a few days.",
    "the overlap cooled as your signal sharpened — your edges drifted apart.",
    "they matched elsewhere first; your agent closed the thread to keep the radar clean.",
  ];
  const s = person.id || person.name || "x";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return R[h % R.length];
}

function SummarySection({ label, children }) {
  return (
    <div style={{ display:"grid", gap:6 }}>
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5,
        textTransform:"uppercase", color:"#000",
      }}>— {label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000" }}>
        {children}
      </div>
    </div>
  );
}

/* Summary of an expired person — opens in the 3rd window when you click one. */
function SummaryWindow({ person, onClose }) {
  return (
    <MacWindow title={`summary · ${person.name}`} onClose={onClose} style={{ minHeight:0 }}>
      <div style={{ display:"grid", gridTemplateRows:"auto 1fr", flex:1, minHeight:0 }}>
        <div style={{
          padding:"12px 16px", borderBottom:"1px solid #000",
          display:"flex", gap:12, alignItems:"center", background:"#fff",
        }}>
          <Avatar name={person.name} size={34}/>
          <div style={{ display:"grid", gap:2, minWidth:0 }}>
            <div style={{ fontFamily:"var(--amiga-title)", fontSize:15, fontWeight:600, color:"#000" }}>
              {person.name}
            </div>
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
              letterSpacing:1, textTransform:"uppercase",
            }}>expired · {person.location}</div>
          </div>
        </div>

        <div className="mac-scroll" style={{
          overflowY:"auto", padding:"16px", display:"grid", gap:16,
          alignContent:"start", background:"#fff",
        }}>
          <SummarySection label="what your agent found">
            {person.pitchFromAgent || person.blurb}
          </SummarySection>
          <SummarySection label="signals">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {(person.signals || []).map(s => (
                <span key={s} style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3,
                  padding:"1px 6px", border:"1px solid #000",
                }}>{s}</span>
              ))}
            </div>
          </SummarySection>
          {person.overlap && person.overlap.length > 0 && (
            <SummarySection label="what you shared">
              {person.overlap.join(" · ")}
            </SummarySection>
          )}
          <SummarySection label="why it closed">
            {expiryReason(person)}
          </SummarySection>
          <SummarySection label="last seen">
            {person.distance}
          </SummarySection>
        </div>
      </div>
    </MacWindow>
  );
}

function statusWord(status) {
  return {
    accepted: "accepted", ready: "ready to accept",
    negotiating: "in negotiation", warm: "in negotiation", considering: "in negotiation",
    expired: "expired", passed: "passed",
  }[status] || "discovered";
}

/* Full profile for a person — opens in the 3rd window when you click their
   name or avatar on the radar. */
function ProfileWindow({ person, onClose, onAccept, onPass, onOpenChat }) {
  const status = person.status;
  const isReady = status === "ready";
  const isAccepted = status === "accepted";
  const isExpired = status === "expired";
  return (
    <MacWindow title={`profile · ${person.name}`} onClose={onClose} style={{ minHeight:0 }}>
      <div style={{ display:"grid", gridTemplateRows:"auto 1fr auto", flex:1, minHeight:0 }}>
        {/* header */}
        <div style={{
          padding:"14px 16px", borderBottom:"1px solid #000",
          display:"flex", gap:12, alignItems:"center", background:"#fff",
        }}>
          <Avatar name={person.name} size={42} ring={isAccepted}/>
          <div style={{ display:"grid", gap:3, minWidth:0 }}>
            <div style={{ fontFamily:"var(--amiga-title)", fontSize:17, fontWeight:600, color:"#000" }}>
              {person.name}
            </div>
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
              letterSpacing:1, textTransform:"uppercase",
            }}>{statusWord(status)}</div>
          </div>
        </div>

        {/* body */}
        <div className="mac-scroll" style={{
          overflowY:"auto", padding:"16px", display:"grid", gap:16,
          alignContent:"start", background:"#fff",
        }}>
          <SummarySection label="about">{person.blurb}</SummarySection>
          {person.pitchFromAgent && (
            <SummarySection label="what your agent sees">{person.pitchFromAgent}</SummarySection>
          )}
          <SummarySection label="signals">
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {(person.signals || []).map(s => (
                <span key={s} style={{
                  fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3,
                  padding:"1px 6px", border:"1px solid #000",
                }}>{s}</span>
              ))}
            </div>
          </SummarySection>
          {person.overlap && person.overlap.length > 0 && (
            <SummarySection label="what you share">{person.overlap.join(" · ")}</SummarySection>
          )}
          <SummarySection label="details">
            <div style={{ display:"grid", gap:4, fontFamily:"var(--mac-mono)", fontSize:11, color:"#000" }}>
              {person.location && <div>· {person.location}</div>}
              {person.distance && <div>· {person.distance}</div>}
              {typeof person.mutuals === "number" && <div>· {person.mutuals} mutual{person.mutuals === 1 ? "" : "s"}</div>}
              {person.introVia && <div>· intro via {person.introVia}</div>}
            </div>
          </SummarySection>
          {isExpired && (
            <SummarySection label="why it closed">{expiryReason(person)}</SummarySection>
          )}
        </div>

        {/* footer CTA — matches the radar stage */}
        <div style={{
          borderTop:"1px solid #000", padding:"10px 14px", background:"#fff",
          display:"flex", alignItems:"center", gap:10,
        }}>
          {isReady ? (
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              <button className="amiga-gadget primary"
                onClick={() => onAccept && onAccept(person.id)}
                style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"4px 14px" }}>accept</button>
              <button className="amiga-gadget"
                onClick={() => onPass && onPass(person.id)}
                style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"4px 14px" }}>pass</button>
            </div>
          ) : isAccepted ? (
            <button className="amiga-gadget primary"
              onClick={() => onOpenChat && onOpenChat(person.id)}
              style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"4px 14px" }}>send message</button>
          ) : isExpired ? (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)" }}>this signal closed.</span>
          ) : (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"var(--ink-3)" }}>
              answer their question in your feed to move forward.
            </span>
          )}
        </div>
      </div>
    </MacWindow>
  );
}

function ChatWindow({ person, messages, draft, setDraft, onSend, onClose, retention, onChangeRetention }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);
  return (
    <MacWindow title={`chat · ${person.name}`} onClose={onClose} style={{ minHeight:0 }}>
        <div style={{
          display:"grid",
          gridTemplateRows: "auto 1fr auto",
          flex:1, minHeight:0,
        }}>
          {/* header */}
          <div style={{
            padding:"12px 16px", borderBottom:"1px solid #000",
            display:"flex", gap:12, alignItems:"center", background:"#fff",
          }}>
            <Avatar name={person.name} size={34}/>
            <div style={{ display:"grid", gap:2, minWidth:0 }}>
              <div style={{ fontFamily:"var(--amiga-title)", fontSize:15, fontWeight:600, color:"#000" }}>
                {person.name}
              </div>
              <div style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)" }}>
                {person.location}
              </div>
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="mac-scroll" style={{
            overflowY:"auto", padding:"14px 16px",
            display:"flex", flexDirection:"column", gap:10, background:"#fff",
          }}>
            {messages.map(m => <ChatBubble key={m.id} m={m}/>)}
          </div>

          {/* input + retention note */}
          <div style={{ borderTop:"1px solid #000", background:"#fff" }}>
            {retention && (
              <div style={{ padding:"7px 12px 0" }}>
                <RetentionNote retention={retention} onChange={onChangeRetention}/>
              </div>
            )}
            <div style={{ padding:"7px 12px 8px", display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontFamily:"var(--mac-mono)", color:"#000" }}>›</span>
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") onSend(); }}
                placeholder={`message ${person.name}…`}
                style={{
                  flex:1, background:"transparent", border:"none", outline:"none",
                  color:"#000", fontFamily:"var(--mac-sans)", fontSize:13, padding:"4px 0",
                }}
              />
              <button className="amiga-gadget" onClick={onSend} style={{ padding:"3px 12px" }}>send</button>
            </div>
          </div>
        </div>
    </MacWindow>
  );
}

function ChatBubble({ m }) {
  if (m.who === "index") {
    return (
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
        textAlign:"center", letterSpacing:0.3, lineHeight:1.5, padding:"0 8px",
      }}>{m.text}</div>
    );
  }
  const you = m.who === "you";
  return (
    <div style={{ display:"flex", justifyContent: you ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth:"82%",
        border:"1px solid #000",
        background: you ? "#000" : "#fff",
        color:      you ? "#fff" : "#000",
        padding:"8px 11px",
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4,
        boxShadow: you ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
      }}>{m.text}</div>
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
        <span>index · syn-0518-bk-04</span>
      </div>
    </div>
  );
}

window.MainView = MainView;
