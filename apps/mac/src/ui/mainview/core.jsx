// Main view, Mac System 6 split-window layout with full flow logic
// Same simulation logic as the original; only chrome/skin is reworked.

// Width of the window row below which three side-by-side windows stop being
// readable, the radar steps aside for the third window instead.
const THREE_COLUMN_MIN = 1020;

// How long the radar describes discovery before accepting that a signal simply
// has not matched anyone yet. Long enough to cover a slow first pass, short
// enough that an empty radar stops pretending to be busy.
const DISCOVERY_GIVE_UP_MS = 120000;

function MainView({ profile, people, setPeople, conversation, setConversation,
                    field, setField, stats, simRate, setSimRate, tweaks = {},
                    onOpenRoom, onBack, registerChats, pendingChat, onPendingHandled }) {
  // Live-only: these demo sim feeds no longer exist, so they default to empty.
  // The simulation loops below stay wired but idle on empty arrays.
  const { CLARIFIERS = [], FIELD_EVENTS = [], AMBIENT_NOTES = [] } = window.INDEX_DATA;
  // "all" opens the radar on the whole field with no stage selected, so the
  // negotiating rows are visible next to the ones awaiting you and a status
  // changing under the agents can be watched as it happens. Selecting a stage
  // still filters; nothing starts filtered.
  const [tab, setTab] = useState("all");
  // Counterparty discovery is what the radar shows while it has nothing to show
  // yet: the window between a signal going live and the first counterparty
  // landing. Deliberately not tied to having just created the signal, because
  // reopening a young signal lands in exactly the same empty state and "no one
  // here right now" is the wrong thing to say while the agents are still out.
  const [discoveryMetrics, setDiscoveryMetrics] = useState({});
  // A signal can legitimately match nobody, so discovery is not allowed to spin
  // forever: past this it gives up and the ordinary empty state takes over.
  const [discoveryExpired, setDiscoveryExpired] = useState(false);
  const [paused, setPaused] = useState(() => profile.status === "paused");
  const [pipelineMode, setPipelineMode] = useState("broad");
  const modeTimerRef = useRef(null);
  const clarifierCursor = useRef(0);
  const queuedRef = useRef(false);
  const answeredSinceRefill = useRef(0);
  const MAX_OPEN = 4;

  // ---- live backend wiring ------------------------------------------------
  // When signed in and this signal maps to a real intent, the radar, clarifiers,
  // agent chat, and H2H threads come from services/api; otherwise the simulation
  // below runs as the signed-out (browser preview) demo. The polling loop,
  // handlers, and inbox stream that consume these live below.
  const intentId = profile.intentId || null;
  const live = !!(window.IndexApp && window.IndexApp.isAuthed() && intentId);
  // Memoize the client so the polling/inbox effects don't reset every render
  // (getClient() returns a fresh object each call). The key is read lazily.
  const client = useMemo(
    () => (live && window.IndexApp.getClient ? window.IndexApp.getClient() : null),
    [live],
  );
  // Latest intent id for in-flight poll checks (closure intentId is fixed per call).
  const intentIdRef = useRef(intentId);
  intentIdRef.current = intentId;
  // Current user id (for telling "you" from "them" in H2H threads). Mirrored
  // onto INDEX_DATA.ME by app.jsx after the snapshot loads.
  const myId = (window.INDEX_DATA && window.INDEX_DATA.ME && window.INDEX_DATA.ME.id) || null;
  // Agent chat is the one PersonalAgent persona in intent scope — the
  // signal's DM. This app only ever drives that scope: api-key callers may
  // not start global chats (those are web-only), so every stream here is
  // intent-scoped. When the backend has the surface switched off there is
  // nothing to fall back to and the server answers 404; detect that from the
  // same /auth/me flag the server gates on and say so, rather than firing a
  // request that cannot succeed.
  const { features, patchIntentStatus, refreshIntents } = useIndexEnv();
  const chatPersona = "personal";
  const agentChatAvailable = !!(features && features.negotiatorChat);
  // Agent-chat session id per intent, persisted across signal switches. Keyed
  // by persona too: a session created under one persona cannot be continued
  // as another (the server rejects the mismatch).
  const chatSessions = (window.__indexChatSessions = window.__indexChatSessions || {});
  const chatKey = `${chatPersona}:${intentId}`;
  const chatSessionRef = useRef(chatSessions[chatKey] || null);
  const seenQuestionIds = useRef(new Set());   // question ids already in the feed
  const radarSeqRef = useRef(0);               // drops stale radar responses
  const convByPerson = useRef({});             // opportunityId -> conversationId
  const personByConv = useRef({});             // conversationId -> opportunityId

  const flashMode = (m, holdMs = 9000) => {
    setPipelineMode(m);
    if (modeTimerRef.current) clearTimeout(modeTimerRef.current);
    modeTimerRef.current = setTimeout(() => {
      if (m === "narrowing") setPipelineMode("focused");
      else setPipelineMode("broad");
    }, holdMs);
  };
  useEffect(() => () => modeTimerRef.current && clearTimeout(modeTimerRef.current), []);

  /* ----- ambient sim: append field events + maybe bump scores (demo only) ----- */
  useInterval(() => {
    if (paused || !FIELD_EVENTS.length) return;
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
  }, (paused || live) ? null : Math.max(800, 4200 / simRate));

  /* ----- seed feed with the first batch of clarifiers (max 4 open) ----- */
  useEffect(() => {
    if (live || !CLARIFIERS.length) return;
    if (queuedRef.current) return;
    queuedRef.current = true;
    const timers = [];
    for (let k = 0; k < MAX_OPEN; k++) {
      timers.push(setTimeout(() => pushClarifierOne(), 2400 + k * 850));
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const makeClarifier = () => {
    if (!CLARIFIERS.length) return null;
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
      const c = makeClarifier();
      return c ? [...prev, c] : prev;
    });
  };
  const pushAmbientNote = () => {
    if (!AMBIENT_NOTES.length) return;
    const n = AMBIENT_NOTES[Math.floor(Math.random() * AMBIENT_NOTES.length)];
    setConversation(prev => [
      ...prev,
      { kind:"note", id: Math.random().toString(36).slice(2), text: n, t: now() },
    ]);
  };

  // Ambient chatter disabled, the feed shows only questions + your responses.
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
  }, (paused || live) ? null : 14000 / simRate);

  /* ----- live radar + clarifier polling ----- */
  const injectClarifiers = React.useCallback((questions) => {
    const fresh = (questions || []).filter((q) => q && q.id && !seenQuestionIds.current.has(q.id));
    if (fresh.length === 0) return;
    fresh.forEach((q) => seenQuestionIds.current.add(q.id));
    const items = window.IndexApi.mapClarifiers(fresh).map((c) => ({
      kind: "clarifier", id: c.id, clarifierId: c.id,
      source: c.source, sourceMeta: c.sourceMeta, effect: "neutral",
      text: c.text, chips: c.chips, triggersHint: c.triggersHint,
      answered: false, choice: null, t: now(),
    }));
    setConversation((prev) => [...prev, ...items]);
  }, [setConversation]);

  // Server-answered questions rise into the scrollback as settled records, so
  // given answers survive app restarts and include answers from other surfaces.
  const injectAnsweredClarifiers = React.useCallback((questions) => {
    const fresh = (questions || []).filter((q) => q && q.id && !seenQuestionIds.current.has(q.id));
    if (fresh.length === 0) return;
    fresh.forEach((q) => seenQuestionIds.current.add(q.id));
    fresh.sort((a, b) => String((a.answer || {}).answeredAt || "").localeCompare(String((b.answer || {}).answeredAt || "")));
    const items = window.IndexApi.mapClarifiers(fresh).map((c) => {
      const answer = (c.apiQuestion && c.apiQuestion.answer) || {};
      const chosen = (Array.isArray(answer.selectedOptions) ? answer.selectedOptions : []).filter(Boolean);
      return {
        kind: "clarifier", id: c.id, clarifierId: c.id,
        source: c.source, sourceMeta: c.sourceMeta, effect: "neutral",
        text: c.text, answered: true, choice: chosen.join(", ") || answer.freeText || "answered", t: now(),
      };
    });
    setConversation((prev) => [...items, ...prev]);
  }, [setConversation]);

  // Intent switches keep MainView mounted; wipe the previous signal's radar
  // and clarifier dedupe set before the next poll lands.
  useEffect(() => {
    if (!live) return;
    radarSeqRef.current += 1;
    seenQuestionIds.current = new Set();
    setPeople([]);
  }, [live, intentId, setPeople]);

  const refreshRadar = React.useCallback(async () => {
    if (!live || !client || !intentId) return;
    const seq = ++radarSeqRef.current;
    const forIntent = intentId;
    // Intent radar asks for the full lifecycle (like the web app's RADAR_STATUSES),
    // otherwise the home endpoint only returns actionable rows and the
    // accepted/missed tabs stay empty. `rejected` is deliberately excluded:
    // most rejections are agent-side filtering, not user decisions, so
    // showing them implies choices the user never made.
    const radarStatuses = "latent,pending,negotiating,stalled,accepted,expired";
    const applyRadar = (radarR) => {
      if (!radarR) return;
      const items = window.IndexApp.normalizeList(radarR, "items");
      const mapped = window.IndexApi.mapPeopleFromRadarItems(items).map((p) => ({
        ...p, hidden: false, score: typeof p.score === "number" ? p.score : 0.7,
      }));
      const apply = window.IndexApi.applyRadarPeople || ((prev, next) => next);
      setPeople((prev) => apply(prev, mapped));
      setDiscoveryMetrics((prev) => ({
        ...prev,
        found: items.length,
        scored: items.filter((it) => typeof (it && it.score) === "number").length,
        advanced: mapped.filter((p) => opportunityBucket(p) !== null).length,
      }));
    };

    const skeletonR = await client.opportunities
      .radarForIntent(forIntent, { statuses: radarStatuses, presentation: "skeleton" })
      .catch(() => null);
    if (radarSeqRef.current !== seq || intentIdRef.current !== forIntent) return;
    applyRadar(skeletonR);

    const [radarR, qR, answeredR] = await Promise.all([
      client.opportunities.radarForIntent(forIntent, { statuses: radarStatuses }).catch(() => null),
      client.questions.pendingForIntent(forIntent).catch(() => null),
      client.questions.answeredForIntent(forIntent).catch(() => null),
    ]);
    if (radarSeqRef.current !== seq || intentIdRef.current !== forIntent) return;
    applyRadar(radarR);
    if (answeredR) injectAnsweredClarifiers(window.IndexApp.normalizeList(answeredR, "questions"));
    if (qR) injectClarifiers(window.IndexApp.normalizeList(qR, "questions"));
  }, [live, client, intentId, setPeople, injectClarifiers, injectAnsweredClarifiers]);

  const visiblePeople = useMemo(() => people.filter(p => !p.hidden), [people]);
  // What the radar actually lists, which is what "empty" has to mean here: a
  // person filtered out of every stage is not something the user can see.
  const shownPeople = useMemo(
    () => visiblePeople.filter(p => opportunityBucket(p) !== null),
    [visiblePeople]
  );
  const filtered = useMemo(() => [...visiblePeople].sort((a, b) => b.score - a.score), [visiblePeople]);

  // People you're still in negotiation with, anyone not yet ready/accepted/gone.
  const negotiatingPeople = useMemo(
    () => visiblePeople.filter(p => !["accepted", "ready", "expired", "passed"].includes(p.status)),
    [visiblePeople]
  );
  // Nothing on the radar and not yet given up: the agents are still out.
  const discovering = live && shownPeople.length === 0 && !discoveryExpired;

  // The clock starts per signal, and a signal that lands someone stops it for
  // good: the give-up state only exists for the empty case.
  useEffect(() => {
    setDiscoveryExpired(false);
    setDiscoveryMetrics({});
  }, [intentId]);

  useEffect(() => {
    if (!live || shownPeople.length > 0) return;
    const t = setTimeout(() => setDiscoveryExpired(true), DISCOVERY_GIVE_UP_MS);
    return () => clearTimeout(t);
  }, [live, shownPeople.length]);

  // Reach is the one stage number that does not come from the radar, so it is
  // asked for once while discovery is on screen.
  useEffect(() => {
    if (!live || !client || !discovering) return;
    let alive = true;
    client.networks.list()
      .then((r) => {
        if (!alive) return;
        const networks = window.IndexApp.normalizeList(r, "networks");
        setDiscoveryMetrics((prev) => ({ ...prev, networks: networks.length }));
      })
      .catch(() => { /* the line stays unlit rather than showing a guess */ });
    return () => { alive = false; };
  }, [live, client, discovering]);

  useEffect(() => {
    if (!live) return;
    refreshRadar();
    const t = setInterval(refreshRadar, 5000);
    return () => clearInterval(t);
  }, [live, refreshRadar]);

  // The four states an opportunity can be in for you, in the order they happen:
  // it needs you, agents are still talking, you took it, it ran out.
  // "awaiting you" leads because it is the only one you can act on.
  // Rejected/passed people are not shown: those are mostly agent-side
  // filtering decisions, and listing them reads as if the user (or the
  // other person) did the rejecting.
  const funnelStages = useMemo(() => {
    const by = (s) => visiblePeople.filter(p => opportunityBucket(p) === s).length;
    return [
      { label:"awaiting you", count: by("awaiting you"), accent:true },
      { label:"negotiating",  count: by("negotiating") },
      { label:"accepted",     count: by("accepted"), accent:true },
      { label:"missed",       count: by("missed") },
    ];
  }, [visiblePeople]);

  const answerClarifier = (item, choice) => {
    setConversation(prev => prev.map(it =>
      it.id === item.id ? { ...it, answered:true, choice } : it
    ));
    if (live) {
      if (client && item.clarifierId) {
        const isChip = Array.isArray(item.chips) && item.chips.includes(choice);
        const body = isChip ? { selectedOptions: [choice] } : { selectedOptions: [], freeText: choice };
        client.questions.answer(item.clarifierId, body)
          .then(() => setTimeout(refreshRadar, 1500))
          .catch(() => {});
      }
      return;
    }
    const clarifier = { id: item.clarifierId, effect: item.effect };
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
    if (live && client && item.clarifierId) {
      client.questions.dismiss(item.clarifierId).catch(() => {});
    }
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

    if (live && !agentChatAvailable) {
      setConversation(prev => [...prev, {
        kind: "agent",
        id: rid(),
        text: "agent chat is switched off on the server right now. your signals and radar are unaffected.",
        t: now(),
      }]);
      return;
    }

    if (live && window.IndexApp) {
      const agentMsgId = rid();
      setConversation(prev => [...prev, { kind:"agent", id: agentMsgId, text: "", t: now() }]);
      const setAgentText = (t) => setConversation(prev =>
        prev.map(it => it.id === agentMsgId ? { ...it, text: t } : it));
      let acc = "";
      // Always intent-scoped: `live` (see its definition above) is only true
      // with a truthy intentId, and this pane is per-signal. Passed straight
      // through rather than as `intentId ? "intent" : undefined`, whose false
      // branch is unreachable and reads as if unscoped were a supported mode
      // for this persona — it is not. streamChat rejects a half-supplied
      // scope, so loosening `live` surfaces as an error instead of a
      // silently-unscoped turn.
      window.IndexApp.streamChat({
        message: text,
        sessionId: chatSessionRef.current,
        scopeType: "intent",
        scopeId: intentId,
        persona: chatPersona,
        onEvent: (e) => {
          if (!e || !e.type) return;
          if (e.type === "token") { acc += e.content || ""; setAgentText(acc); }
          else if (e.type === "response_reset") { acc = ""; setAgentText(""); }
          else if (e.type === "done") { setAgentText(e.response || acc); }
          else if (e.type === "error") { setAgentText(acc || `· ${e.message || "something went wrong"}`); }
          else if (e.type === "user_question") { fetchChatQuestions(); }
        },
      }).then((sid) => {
        if (sid) { chatSessionRef.current = sid; if (intentId) chatSessions[chatKey] = sid; }
      }).catch((err) => {
        // A rejected turn (transport failure, or a 4xx such as the API
        // refusing a scopeless negotiator stream) used to be swallowed here,
        // leaving an empty agent bubble and no signal that anything broke.
        setAgentText(acc || `· ${(err && err.message) || "something went wrong"}`);
      });
      return;
    }

    // demo fallback, the agent reads what you wrote and reaches back.
    const reply = agentReplyTo(text, { profile, negotiatingPeople, people });
    setTimeout(() => {
      setConversation(prev => [
        ...prev,
        { kind:"agent", id: Math.random().toString(36).slice(2), text: reply, t: now() },
      ]);
    }, 650);
  };

  // On a blocking chat-mode question, pull it and render it inline as a clarifier.
  const fetchChatQuestions = () => {
    if (!client || !chatSessionRef.current) return;
    client.questions.pending({ conversationId: chatSessionRef.current, mode: "chat" })
      .then((res) => injectClarifiers(window.IndexApp.normalizeList(res, "questions")))
      .catch(() => {});
  };

  /* ----- chat (3rd window): opens when you click someone in the pipeline ----- */
  const [chatId, setChatId] = useState(null);
  const chatIdRef = useRef(null);
  useEffect(() => { chatIdRef.current = chatId; }, [chatId]);
  const [chats, setChats] = useState({});
  const [chatDraft, setChatDraft] = useState("");
  const [unread, setUnread] = useState({});   // personId -> unread count
  const [responses, setResponses] = useState({});      // your typed answer to each person's question
  const [summaryId, setSummaryId] = useState(null);    // expired person whose summary is open
  const [profileId, setProfileId] = useState(null);    // person whose profile is open

  const toChatMsg = (m) => {
    const parts = Array.isArray(m.parts) ? m.parts : [];
    const text = parts.map((p) => (p && typeof p === "object" && p.text) ? p.text : "")
      .filter(Boolean).join("\n");
    const who = m.senderId && myId && m.senderId === myId ? "you"
      : m.role === "agent" ? "index" : "them";
    // `at` is what the bubble reveals on hover; absent on older rows, and the
    // bubble simply shows nothing then.
    return { id: m.id || rid(), who, text, at: m.createdAt || m.created_at || null };
  };

  const openChat = (personId) => {
    setChatId(personId);
    setSummaryId(null);
    setProfileId(null);
    setUnread(prev => (prev[personId] ? { ...prev, [personId]: 0 } : prev));

    if (live && client) {
      client.opportunities.startChatForIntent(personId, intentId)
        .then((res) => {
          const cid = res && res.conversationId;
          if (!cid) return;
          convByPerson.current[personId] = cid;
          personByConv.current[cid] = personId;
          return client.conversations.messages(cid).then((msgsRes) => {
            const msgs = window.IndexApp.normalizeList(msgsRes, "messages").map(toChatMsg);
            setChats(prev => ({ ...prev, [personId]: msgs }));
          });
        })
        .catch(() => {});
      return;
    }

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
  // clears the negotiation and makes them ready, that's when the opportunity
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
  // Accepting means "I want to talk to this person", so go straight into the
  // chat instead of letting the card silently jump to the accepted tab. Match
  // the web (useOpportunityActions): in live mode the card only moves to
  // "accepted" once the server confirms, so a failed accept can't leave a
  // phantom in the accepted tab. On failure, refresh from the server so the
  // radar reflects the real state instead of the optimistic one.
  const acceptPerson = (personId) => {
    if (live && client) {
      client.opportunities.updateStatusForIntent(personId, "accepted", intentId)
        .then(() => {
          setPeople(prev => prev.map(p =>
            p.id === personId ? { ...p, status: "accepted" } : p));
          openChat(personId);
          setTimeout(refreshRadar, 1500);
        })
        .catch(() => refreshRadar());
      return;
    }
    setPeople(prev => prev.map(p =>
      p.id === personId ? { ...p, status: "accepted" } : p));
    openChat(personId);
  };
  // Pass is the other half of the ready-stage decision, decline the intro
  // instead of accepting it. They drop out of the radar into "passed". Like
  // accept, only commit the local status once the server confirms so a failed
  // reject can't hide a still-pending opportunity; refresh on failure.
  const passPerson = (personId) => {
    if (chatId === personId) closeChats();
    if (live && client) {
      client.opportunities.updateStatusForIntent(personId, "rejected", intentId)
        .then(() => {
          setPeople(prev => prev.map(p =>
            p.id === personId ? { ...p, status: "passed" } : p));
          setTimeout(refreshRadar, 1500);
        })
        .catch(() => refreshRadar());
      return;
    }
    setPeople(prev => prev.map(p =>
      p.id === personId ? { ...p, status: "passed" } : p));
  };
  const sendChat = () => {
    const text = chatDraft.trim();
    if (!text || !chatId) return;
    const id = chatId;
    setChatDraft("");
    setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"you", text, at: nowISO() }] }));

    if (live && client) {
      const cid = convByPerson.current[id];
      if (cid) client.conversations.sendMessage(cid, { parts: [{ text }] }).catch(() => {});
      return;
    }

    setTimeout(() => {
      setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"them", text: chatReplyFor(text), at: nowISO() }] }));
    }, 700);
  };

  // Agents you've already talked to occasionally ping you. If their chat isn't
  // the one you're looking at, it just bumps a quiet unread marker, no popups.
  useInterval(() => {
    if (paused) return;
    const candidates = Object.keys(chats).filter(id => id !== chatId);
    if (candidates.length === 0) return;
    const pid = candidates[Math.floor(Math.random() * candidates.length)];
    const person = people.find(p => p.id === pid);
    setChats(prev => ({ ...prev, [pid]: [...(prev[pid] || []), { id: rid(), who:"them", text: incomingPing(person), at: nowISO() }] }));
    setUnread(prev => ({ ...prev, [pid]: (prev[pid] || 0) + 1 }));
  }, (paused || live || Object.keys(chats).length === 0) ? null : 16000 / simRate);

  // Live inbox, append counterpart/agent messages to any open H2H thread.
  useEffect(() => {
    if (!live || !window.IndexApp) return;
    const sub = window.IndexApp.streamInbox((event) => {
      if (!event || event.type !== "message" || !event.message) return;
      const pid = personByConv.current[event.conversationId];
      if (!pid) return;
      const m = toChatMsg(event.message);
      if (m.who === "you") return; // don't echo our own optimistic sends
      setChats(prev => {
        const list = prev[pid] || [];
        if (list.some((x) => x.id === m.id)) return prev;
        return { ...prev, [pid]: [...list, m] };
      });
      setUnread(prev => (pid === chatIdRef.current ? prev : { ...prev, [pid]: (prev[pid] || 0) + 1 }));
    });
    return () => { if (sub && sub.close) sub.close(); };
  }, [live]);

  // Pause holds the signal: the agent stops taking on new work, but the
  // opportunities and questions it already surfaced stay put. On a live signal
  // that's a real status change, not just a local hold, revert if it doesn't
  // land so the button never claims something the backend didn't do. Also patch
  // the shared INTENTS snapshot so the hub shows paused/active without a reload.
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    if (live && client && intentId) {
      client.intents.updateStatus(intentId, next ? "PAUSED" : "ACTIVE")
        .then(() => {
          if (patchIntentStatus) patchIntentStatus(intentId, next ? "paused" : "active");
        })
        .catch(() => setPaused(!next));
    }
  };

  // Archive retires the signal and drops it off the hub. Only leave the screen
  // once the backend has taken it, otherwise you'd land back on a hub still
  // showing the signal you thought you'd just archived.
  const archiveSignal = () => {
    if (!(live && client && intentId)) { onBack && onBack(); return Promise.resolve(); }
    return client.intents.archive(intentId).then(async () => {
      if (patchIntentStatus) patchIntentStatus(intentId, "archived");
      if (refreshIntents) await refreshIntents().catch(() => null);
      onBack && onBack();
    });
  };

  // Three columns need room. Below that the third window takes the radar's
  // place rather than all three squeezing to the point where a card's name and
  // its accept/pass gadgets sit on top of each other; closing it brings the
  // radar back.
  const shellRef = useRef(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0] && entries[0].contentRect.width;
      if (w) setNarrow(w < THREE_COLUMN_MIN);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chatPerson = chatId ? people.find(p => p.id === chatId) : null;
  const summaryPerson = summaryId ? people.find(p => p.id === summaryId) : null;
  const profilePerson = profileId ? people.find(p => p.id === profileId) : null;
  const thirdOpen = !!(chatPerson || summaryPerson || profilePerson);
  const showRadar = !(thirdOpen && narrow);
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
      // deep top and bottom margins frame the windows on the desktop (and keep
      // the chrome well clear of the floating traffic lights); the sides stay
      // tight because the three columns want the width
      padding: "56px 18px 56px", gap: 8,
    }}>
      <div ref={shellRef} style={{
        display:"grid",
        // Opening a chat splits into a third column, the pipeline narrows to
        // make room rather than the chat floating on top.
        // The minimums are 0, not a px floor: a floor larger than the window
        // makes the tracks overflow the desktop and the last column runs off
        // the right edge. The windows clip their own content instead.
        gridTemplateColumns: (thirdOpen && showRadar)
          ? "minmax(0, 40fr) minmax(0, 30fr) minmax(0, 30fr)"
          : "minmax(0, 56fr) minmax(0, 44fr)",
        gridTemplateRows: "minmax(0, 1fr)",
        gap: 8, minHeight:0,
      }}>
        <MacWindow title="signal" onClose={onBack}>
          <ConversationPane
            profile={profile}
            conversation={conversation}
            onAnswer={answerClarifier}
            onDismiss={dismissClarifier}
            draft={draft} setDraft={setDraft} sendDraft={sendDraft}
            negotiatingPeople={live ? [] : negotiatingPeople}
            onRespondPerson={respondPerson}
            paused={paused}
            onTogglePause={togglePause}
            onArchive={archiveSignal}
          />
        </MacWindow>

        {showRadar && (
        <MacWindow title="radar" onClose={onBack}>
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
            discovering={discovering}
            discoveryMetrics={discoveryMetrics}
          />
        </MacWindow>
        )}

        {thirdOpen && (
          chatPerson ? (
            <ChatWindow
              person={chatPerson}
              messages={chats[chatId] || []}
              draft={chatDraft}
              setDraft={setChatDraft}
              onSend={sendChat}
              onClose={closeChats}
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
