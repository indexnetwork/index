// Main view, Mac System 6 split-window layout with full flow logic
// Same simulation logic as the original; only chrome/skin is reworked.

// How long conversations are kept before auto-deleting. Adjustable inline.
const RETENTION_OPTIONS = ["1 week", "2 weeks", "1 month", "3 months", "never"];

// Width of the window row below which three side-by-side windows stop being
// readable, the radar steps aside for the third window instead.
const THREE_COLUMN_MIN = 1020;

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
  // Live-only: these demo sim feeds no longer exist, so they default to empty.
  // The simulation loops below stay wired but idle on empty arrays.
  const { CLARIFIERS = [], FIELD_EVENTS = [], AMBIENT_NOTES = [] } = window.INDEX_DATA;
  // "awaiting you" is the default tab: it is the only stage the user can act
  // on, so the radar opens on the decisions rather than the whole field.
  const [tab, setTab] = useState("awaiting you");
  const [paused, setPaused] = useState(false);
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
  // Current user id (for telling "you" from "them" in H2H threads). Mirrored
  // onto INDEX_DATA.ME by app.jsx after the snapshot loads.
  const myId = (window.INDEX_DATA && window.INDEX_DATA.ME && window.INDEX_DATA.ME.id) || null;
  // Agent chat runs the negotiator persona when the backend enables it: the
  // negotiator drops list_opportunities in intent-pinned chats (the Radar
  // beside this pane owns opportunity listing), while api-key callers without
  // a persona fall back to the orchestrator's unrestricted toolset.
  const { features } = useIndexEnv();
  const chatPersona = features && features.negotiatorChat ? "negotiator" : null;
  // Agent-chat session id per intent, persisted across signal switches. Keyed
  // by persona too: a session created under one persona cannot be continued
  // as another (the server rejects the mismatch).
  const chatSessions = (window.__indexChatSessions = window.__indexChatSessions || {});
  const chatKey = chatPersona ? `${chatPersona}:${intentId}` : intentId;
  const chatSessionRef = useRef(chatSessions[chatKey] || null);
  const seenQuestionIds = useRef(new Set());   // question ids already in the feed
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

  const refreshRadar = React.useCallback(async () => {
    if (!live || !client) return;
    // Intent radar asks for the full lifecycle (like the web app's RADAR_STATUSES),
    // otherwise the home endpoint only returns actionable rows and the
    // accepted/missed tabs stay empty. `rejected` is deliberately excluded:
    // most rejections are agent-side filtering, not user decisions, so
    // showing them implies choices the user never made.
    const radarStatuses = "latent,pending,negotiating,stalled,accepted,expired";
    const [radarR, qR, answeredR] = await Promise.all([
      (intentId ? client.opportunities.radarForIntent(intentId, { statuses: radarStatuses }) : client.opportunities.radar()).catch(() => null),
      (intentId ? client.questions.pendingForIntent(intentId) : client.questions.pending()).catch(() => null),
      (intentId ? client.questions.answeredForIntent(intentId) : client.questions.answered()).catch(() => null),
    ]);
    if (radarR) {
      const items = window.IndexApp.normalizeList(radarR, "items");
      const mapped = window.IndexApi.mapPeopleFromRadarItems(items).map((p) => ({
        ...p, hidden: false, score: typeof p.score === "number" ? p.score : 0.7,
      }));
      setPeople(mapped);
    }
    if (answeredR) injectAnsweredClarifiers(window.IndexApp.normalizeList(answeredR, "questions"));
    if (qR) injectClarifiers(window.IndexApp.normalizeList(qR, "questions"));
  }, [live, client, intentId, setPeople, injectClarifiers, injectAnsweredClarifiers]);

  useEffect(() => {
    if (!live) return;
    refreshRadar();
    const t = setInterval(refreshRadar, 45000);
    return () => clearInterval(t);
  }, [live, refreshRadar]);

  const visiblePeople = useMemo(() => people.filter(p => !p.hidden), [people]);
  const filtered = useMemo(() => [...visiblePeople].sort((a, b) => b.score - a.score), [visiblePeople]);

  // People you're still in negotiation with, anyone not yet ready/accepted/gone.
  const negotiatingPeople = useMemo(
    () => visiblePeople.filter(p => !["accepted", "ready", "expired", "passed"].includes(p.status)),
    [visiblePeople]
  );
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

    if (live && window.IndexApp) {
      const agentMsgId = rid();
      setConversation(prev => [...prev, { kind:"agent", id: agentMsgId, text: "", t: now() }]);
      const setAgentText = (t) => setConversation(prev =>
        prev.map(it => it.id === agentMsgId ? { ...it, text: t } : it));
      let acc = "";
      window.IndexApp.streamChat({
        message: text,
        sessionId: chatSessionRef.current,
        scopeType: intentId ? "intent" : undefined,
        scopeId: intentId || undefined,
        persona: chatPersona || undefined,
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
      }).catch(() => {});
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
  const [retentionIdx, setRetentionIdx] = useState(1); // auto-delete window for chats
  const retention = RETENTION_OPTIONS[retentionIdx];
  const cycleRetention = () => setRetentionIdx(i => (i + 1) % RETENTION_OPTIONS.length);

  const toChatMsg = (m) => {
    const parts = Array.isArray(m.parts) ? m.parts : [];
    const text = parts.map((p) => (p && typeof p === "object" && p.text) ? p.text : "")
      .filter(Boolean).join("\n");
    const who = m.senderId && myId && m.senderId === myId ? "you"
      : m.role === "agent" ? "index" : "them";
    return { id: m.id || rid(), who, text };
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
    setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"you", text }] }));

    if (live && client) {
      const cid = convByPerson.current[id];
      if (cid) client.conversations.sendMessage(cid, { parts: [{ text }] }).catch(() => {});
      return;
    }

    setTimeout(() => {
      setChats(prev => ({ ...prev, [id]: [...(prev[id] || []), { id: rid(), who:"them", text: chatReplyFor(text) }] }));
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
    setChats(prev => ({ ...prev, [pid]: [...(prev[pid] || []), { id: rid(), who:"them", text: incomingPing(person) }] }));
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
  // land so the button never claims something the backend didn't do.
  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    if (live && client && intentId) {
      client.intents.updateStatus(intentId, next ? "PAUSED" : "ACTIVE")
        .catch(() => setPaused(!next));
    }
  };

  // Archive retires the signal and drops it off the hub. Only leave the screen
  // once the backend has taken it, otherwise you'd land back on a hub still
  // showing the signal you thought you'd just archived.
  const archiveSignal = () => {
    if (!(live && client && intentId)) { onBack && onBack(); return Promise.resolve(); }
    return client.intents.archive(intentId).then(() => { onBack && onBack(); });
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
// agent's voice, acknowledging an instruction, declining, or answering an
// info question. Heuristic, not a model: it routes on intent words.
function agentReplyTo(raw, ctx = {}) {
  const t = (raw || "").trim().toLowerCase();
  const negCount = (ctx.negotiatingPeople || []).length;
  const ready = (ctx.people || []).filter(p => p.status === "ready").length;
  const top = (ctx.people || []).filter(p => !p.hidden && p.status !== "passed" && p.status !== "expired")
    .sort((a, b) => b.score - a.score)[0];

  const has = (...ws) => ws.some(w => t.includes(w));
  const isQuestion = /\?\s*$/.test(t) || /^(who|what|when|where|why|how|which|do|does|is|are|can|could|should|any)\b/.test(t);

  // asking for something, answer from the field
  if (isQuestion) {
    if (has("how many", "how much") && has("negotiat", "talking", "pending"))
      return `${negCount} in negotiation right now · ${ready} ready when you are.`;
    if (has("who", "best", "top", "strongest", "closest"))
      return top
        ? `closest overlap right now is ${top.name.toLowerCase()}, ${top.blurb || "strong signal on what you're tracking"}.`
        : "field's still warming up. nothing strong enough to surface yet.";
    if (has("ready"))
      return `${ready} ready to move. they're at the top of your radar, marked ready.`;
    return "looking. i'll surface what's relevant on your radar. give me a beat.";
  }

  // declining / stop / negation
  if (has("don't", "dont", "stop", "no ", "never", "drop", "ignore", "not interested", "pass on"))
    return "won't do that. i'll steer the field away from it and keep the rest moving.";

  // remember / note for later
  if (has("remember", "keep in mind", "note", "later", "for now", "fyi"))
    return "noted. i'll keep that in mind as i read the field.";

  // instruction / preference, focus, prioritize, find
  if (has("focus", "prioriti", "anchor", "narrow", "only", "more of", "find", "look for", "show me", "surface", "prefer"))
    return "okay, i'll do that. re-weighting your radar toward it now.";

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
    "q4/decline politely":  "declined for tonight. ren's still open to meet, no press attached.",
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
    "q20/let me see her thread first": "opening her room now. check the right column.",
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

/* applyClarifierEffect, full mapping from original */
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
        <span>always on</span>
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

/* =================== LEFT, CONVERSATION =================== */
// Small Workbench-style control for managing the running signal (pause / stop).
// `danger` carries the app's destructive treatment (--ink-warn, same as the
// delete-account gadget in settings): warn-red outline at rest so archiving
// never looks like the pause next to it, a red wash on hover, and a solid red
// fill once it's armed, the point of no return is the only thing that fills.
function SignalAction({ label, active = false, onClick, danger = false }) {
  const [hover, setHover] = useState(false);
  const on = active || hover;
  const edge = danger ? "var(--ink-warn)" : "#000";
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        fontFamily:"var(--mac-mono)", fontSize:11,
        padding:"2px 10px", whiteSpace:"nowrap",
        border:`1px solid ${edge}`,
        background: danger
          ? (active ? "var(--ink-warn)" : hover ? "#FFF3F3" : "#fff")
          : (on ? "#000" : "#fff"),
        color: danger
          ? (active ? "#fff" : "var(--ink-warn)")
          : (on ? "#fff" : "#000"),
        fontWeight: danger && active ? 700 : 400,
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
      }}>{label}</button>
  );
}

function ConversationPane({ profile, conversation, onAnswer, onDismiss, draft, setDraft, sendDraft, negotiatingPeople = [], onRespondPerson, paused = false, onTogglePause, onArchive }) {
  const scrollRef = useRef(null);
  // Archiving takes the signal off the hub and there's no way back to it from
  // here, so the first click arms the button and the second one commits. It
  // disarms itself after a few seconds if you meant to click something else.
  const [armed, setArmed] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const armTimer = useRef(null);
  useEffect(() => () => armTimer.current && clearTimeout(armTimer.current), []);
  const clickArchive = () => {
    if (archiving) return;
    if (armTimer.current) clearTimeout(armTimer.current);
    if (!armed) {
      setArmed(true);
      armTimer.current = setTimeout(() => setArmed(false), 4000);
      return;
    }
    setArmed(false);
    setArchiving(true);
    Promise.resolve(onArchive && onArchive())
      .catch(() => {})
      .then(() => setArchiving(false));
  };
  const [stuck, setStuck] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(conversation.length);
  // Distance from the bottom of the feed, kept live as you scroll. We restore
  // this exact gap after any content change so answering a question (which
  // shrinks its card) never yanks the viewport around.
  const bottomGap = useRef(0);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = conversation.length > lastLen.current;
    if (bottomGap.current <= 24) {
      // pinned to the bottom, stay pinned, following new content
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else {
      // scrolled up, hold the same spot so nothing jumps under you
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
      // an explicit minmax(0,1fr) column, the implicit `auto` one is floored
      // at the widest row's min-content and would push past the window frame
      gridTemplateColumns:"minmax(0, 1fr)",
      flex:1, minHeight:0, minWidth:0, position:"relative",
    }}>
      {/* fixed signal header, the signal you're tracking, plus the controls
          to pause or stop the agent working on it */}
      <div style={{
        padding:"12px 18px 12px",
        minHeight:68, boxSizing:"border-box",
        borderBottom:"1px solid #000",
        background:"#fff",
      }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
          {/* Capped at three lines. A long signal used to grow this header
              without limit, and opening the third window narrowed the column
              enough that the title pushed the status line straight through the
              header's bottom rule. It clips to an ellipsis instead, and the
              whole signal is one hover away. */}
          <h2
            title={profile.intent || "your signal"}
            style={{
              margin:0, fontFamily:"var(--amiga-title)", fontWeight:500,
              fontSize:17, color:"#000", letterSpacing:-0.2, lineHeight:1.2,
              flex:1, minWidth:0,
              display:"-webkit-box", WebkitBoxOrient:"vertical", WebkitLineClamp:3,
              overflow:"hidden",
            }}>{profile.intent || "your signal"}</h2>
          <div style={{ display:"flex", gap:6, flex:"0 0 auto" }}>
            <SignalAction
              label={paused ? "▶ resume" : "❚❚ pause"}
              active={paused}
              onClick={() => onTogglePause && onTogglePause()}
            />
            <SignalAction
              danger
              label={archiving ? "archiving…" : armed ? "archive · confirm" : "archive"}
              active={armed || archiving}
              onClick={clickArchive}
            />
          </div>
        </div>
        {/* Just what the signal is doing. The questions are right below in the
            feed, each one asking for itself, so a count of them up here was
            saying the same thing twice. */}
        <div style={{
          marginTop:8, display:"flex", alignItems:"center", gap:8, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3, color:"var(--ink-2)",
        }}>
          <span
            title={paused ? "paused · agent on hold" : "live · agent is looking in the background"}
            style={{
              display:"inline-flex", alignItems:"center", gap:5,
              minWidth:0, flex:"0 1 auto",
              color: paused ? "var(--ink-3)" : "#000",
            }}>
            <span style={{
              width:7, height:7, borderRadius:"50%", flex:"0 0 auto",
              background: paused ? "var(--ink-4)" : "#1FA95B",
              boxShadow: paused ? "none" : "0 0 0 2px rgba(31,169,91,0.25)",
            }}/>
            <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", minWidth:0 }}>
              {paused ? "paused · agent on hold" : "live · agent is looking in the background"}
            </span>
          </span>
        </div>
      </div>

      {/* feed body */}
      <div ref={scrollRef} onScroll={onScroll} className="mac-scroll" style={{
        overflowY:"auto", padding:"16px 18px 8px",
        display:"flex", flexDirection:"column",
      }}>
        {/* inner column pinned to the bottom, messages stack just above the
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

          {/* one chronological stream, questions stay exactly where they
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
                <AgentLine key={it.id}><AgentMarkdown text={it.text}/></AgentLine>
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
          around, white sunken inside, the input is the only editable thing
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
            placeholder="message index, or just let it keep working"
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

/* When 2+ people's agents ask the same thing, answer once, respond to all. */
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
      {/* the question, the hero */}
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500,
        lineHeight:1.4, color:"#000", letterSpacing:-0.1,
      }}>{question}</div>
      {/* suggested options as a lettered list, then a write-your-own row that
          shares the exact same framing, answer however you like */}
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

// A single stacked option, letter badge + full-width label, in the same frame
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
      icon={<AgentAvatar size={18} collective title={`${people.length} agents asking the same`}/>}
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
      icon={<AgentAvatar size={18} seed={agentOwner(person.name)} title={agentLabel(person.name)}/>}
      source={`from ${agentLabel(person.name)}`}
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
    : `from ${agentLabel(meta.name)}`;
  // a named counterpart's agent wears its own face; an unnamed one is yours,
  // and yours is the negotiator identity from the agents page
  const owner = agentOwner(meta.name);
  const mark = (size, style) => collective
    ? <AgentAvatar size={size} collective title={sourceLabel} style={style}/>
    : owner
      ? <AgentAvatar size={size} seed={owner} title={sourceLabel} style={style}/>
      : <MyAgentAvatar size={size} title={sourceLabel} style={style}/>;

  // An answered clarifier is a record, not a control, so nothing in it carries
  // a fill, in this app a filled black block is something you press (the
  // options above, the send gadget), and the answer you already gave read as a
  // button you could press again. It's typography and a rule instead: the
  // frame drops to a hairline so settled cards recede behind live questions,
  // the question steps back to secondary ink now that it's been dealt with,
  // and the answer is quoted under a black rule, the one black thing left,
  // because your words are the point of the card once it's resolved.
  if (item.answered) {
    return (
      <div className="fade-up" style={{
        border:"1px solid var(--ink-4)", background:"#fff",
        padding:"11px 15px", display:"grid", gap:8,
        opacity: item.dismissed ? 0.55 : 1,
      }}>
        <div style={{
          display:"flex", alignItems:"center", gap:7, minWidth:0,
          fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", letterSpacing:0.3,
        }}>
          {mark(16, { opacity:0.75 })}
          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 }}>{sourceLabel}</span>
          <div style={{ flex:1 }}/>
          <span style={{ flex:"0 0 auto", letterSpacing:0.3 }}>
            {item.dismissed ? "dismissed" : "✓ answered"}
          </span>
        </div>
        <div style={{
          fontFamily:"var(--mac-sans)", fontSize:13.5, fontWeight:400,
          color:"var(--ink-2)", lineHeight:1.45, letterSpacing:-0.1,
        }}>{item.text}</div>
        {!item.dismissed && (
          <div style={{
            display:"grid", gap:3, minWidth:0,
            borderLeft:"2px solid #000", paddingLeft:10,
          }}>
            <span style={{
              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)", letterSpacing:0.3,
            }}>you said</span>
            <span style={{
              fontFamily:"var(--mac-sans)", fontSize:13.5, color:"#000", lineHeight:1.4,
            }}>{item.choice}</span>
          </div>
        )}
      </div>
    );
  }
  return (
    <QuestionCard
      icon={mark(18)}
      source={sourceLabel}
      // the mark and the label already say whose agent this is, an "agent"
      // tag next to "from katherine's agent" is just the word twice
      tag={collective ? "collective" : null}
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

// The agent mark itself lives in primitives as AgentAvatar, every surface
// where something speaks on your behalf uses that one visual.

// Agent replies arrive as markdown; render them through the vendored marked
// UMD (window.marked). `<` is escaped first so raw HTML in model output never
// reaches the DOM — only markdown-generated tags do. Falls back to plain text
// if marked is missing or throws (e.g. on a half-streamed construct).
function AgentMarkdown({ text }) {
  const html = useMemo(() => {
    if (!window.marked || !text) return null;
    try {
      return window.marked.parse(String(text).replace(/</g, "&lt;"), { breaks: true, async: false });
    } catch (e) { return null; }
  }, [text]);
  if (html == null) return text || null;
  return <div className="agent-md" dangerouslySetInnerHTML={{ __html: html }}/>;
}

function AgentLine({ children, pending, highlight, collective }) {
  return (
    <div className="fade-up" style={{ display:"flex", gap:10, alignItems:"flex-start" }}>
      {collective
        ? <AgentAvatar size={22} collective style={{ marginTop:2, boxShadow:"none" }}/>
        : <MyAgentAvatar size={22} style={{ marginTop:2 }}/>}
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize: highlight ? 14.5 : 14,
        color:"#000", lineHeight:1.45, maxWidth:520,
      }}>{children}</div>
    </div>
  );
}
// A message you typed, rendered as a sent bubble on the right, so the
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

/* Which tab a person belongs under. The internal statuses are the older
   vocabulary (`ready`, `passed`, `expired`); these are the names the rest of
   the product uses, so the tabs say what the state means to you rather than
   what the record is called. */
function opportunityBucket(p) {
  switch (p.status) {
    case "accepted": return "accepted";
    case "ready":    return "awaiting you";
    case "passed":   return null; // hidden — see funnelStages comment
    case "expired":  return "missed";
    default:         return "negotiating";
  }
}

/* =================== RIGHT, MATCH FEED =================== */
// Below this the radar column no longer fits a name, a blurb and the gadgets on
// one line, so the cards stack their actions instead.
const MATCH_CARD_ROW_MIN = 340;

function MatchFeed({ tab, setTab, people, field, funnelStages, pipelineMode, onOpenRoom, onAccept, onPass, onSummary, onProfile, unread = {}, chatIds = [], profile = {} }) {
  const shownPeople = people.filter(p => opportunityBucket(p) !== null);
  const peopleForTab = tab === "all"
    ? shownPeople
    : shownPeople.filter(p => opportunityBucket(p) === tab);
  const listRef = useRef(null);
  const compact = useNarrow(listRef, MATCH_CARD_ROW_MIN);
  return (
    <div style={{
      display:"grid", gridTemplateRows:"auto 1fr", gridTemplateColumns:"minmax(0, 1fr)",
      flex:1, minHeight:0, minWidth:0,
    }}>
      <div style={{
        padding:"0 22px", minHeight:68, boxSizing:"border-box",
        display:"flex", alignItems:"center", minWidth:0,
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

      <div ref={listRef} className="mac-scroll" style={{
        overflowY:"auto", padding:"14px 22px 24px",
        display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:8, alignContent:"start",
      }}>
        {peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} onOpenRoom={onOpenRoom} onAccept={onAccept} onPass={onPass} onSummary={onSummary} onProfile={onProfile}
            hasChat={chatIds.includes(p.id)} unreadCount={unread[p.id] || 0} compact={compact}/>
        ))}
        {peopleForTab.length === 0 && (
          <div style={{
            padding:28, textAlign:"center",
            fontFamily:"var(--mac-mono)", fontSize:12, color:"var(--ink-2)",
            border:"1px dashed #000",
          }}>{
            tab === "awaiting you" ? "nothing waiting on you. answer their questions in the feed first."
            : tab === "negotiating" ? "no negotiations open. your agent starts one when it finds an overlap."
            : tab === "accepted"    ? "no one accepted yet. accept someone from the awaiting-you list."
            : tab === "missed"      ? "nothing missed. these are people the moment passed on."
            : "no one here right now. the field keeps moving, so check back."
          }</div>
        )}
      </div>
    </div>
  );
}

// Each negotiation question carries a few predefined responses (chips) plus the
// option to write your own.
const PERSON_QUESTIONS = [
  { q: "before we talk, are you hiring, collaborating, or just comparing notes?",
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

function MatchCard({ person, onOpenRoom, onAccept, onPass, onSummary, onProfile, hasChat = false, unreadCount = 0, compact = false }) {
  const openProfile = (e) => { e.stopPropagation(); onProfile && onProfile(person.id); };
  const [hover, setHover] = useState(false);
  const accepted = person.status === "accepted";
  const readyStage = person.status === "ready";   // opportunity to accept
  const isPassed = person.status === "passed";
  const isExpired = person.status === "expired";
  // everyone else discovered is still in negotiation, they have an open question
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
        // Narrow column: the gadgets drop to their own row under the avatar and
        // the blurb, rather than eating the width the name needs.
        display:"grid",
        gridTemplateColumns: compact ? "auto minmax(0, 1fr)" : "auto minmax(0, 1fr) auto",
        gap: compact ? "10px 12px" : 14,
        padding:"14px 14px", minWidth:0,
        background:"#fff", color:"#000",
        border:"1px solid #000",
        borderLeft: accepted ? "3px solid #FF8A00" : "1px solid #000",
        // filter (not opacity), the .fade-up animation ends at opacity:1 and would override it
        filter: (isPassed || isExpired) ? "opacity(0.45)" : "none",
        boxShadow: (cardClickable && hover) ? "2px 2px 0 rgba(0,0,0,0.22)" : "none",
        transform: (cardClickable && hover) ? "translate(-1px, -1px)" : "none",
        cursor: cardClickable ? "pointer" : "default",
        transition:"all .12s ease",
      }}>
      <span onClick={openProfile} title="view profile" style={{ cursor:"pointer", lineHeight:0 }}>
        <Avatar name={person.name} photo={person.photo} size={36} ring={accepted}/>
      </span>
      <div style={{ display:"grid", gap:3, minWidth:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", minWidth:0 }}>
          <span onClick={openProfile} title="view profile" style={{
            fontFamily:"var(--mac-sans)", fontSize:15, fontWeight:600, cursor:"pointer",
            minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
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
      <div style={{
        display:"grid", gap:6, alignContent:"start",
        justifyItems: compact ? "start" : "end",
        ...(compact ? { gridColumn:"2 / -1" } : null),
      }}>
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
          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
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
        ? `thanks, and we've both got '${ov}' in common, so this should be easy. when works to talk?`
        : `thanks for that. when works to talk?` });
  } else {
    msgs.push({ who: "them",
      text: ov
        ? `hi, good to meet you. looks like we've both got '${ov}' in common, so this might be easy. what are you hoping to get out of this?`
        : `hi, good to meet you. looks like our signals line up. what are you hoping to get out of this?` });
  }
  return msgs.map(m => ({ id: rid(), ...m }));
}

function chatReplyFor(text) {
  const t = text.toLowerCase();
  if (t.includes("meet") || t.includes("call") || t.includes("time") || t.includes("week") || t.includes("coffee"))
    return "i've got a couple of openings this week. want to grab 20 minutes?";
  if (t.includes("no") || t.includes("pass") || t.includes("not interested"))
    return "all good. i'll keep an eye out if anything changes.";
  if (t.includes("?"))
    return "good question. let me think on it and get back to you.";
  return "got it. anything you'd want me to know up front?";
}

function incomingPing(person) {
  const lines = [
    "quick follow-up: i freed up some time this week if you want it.",
    "i just re-read your signal. still keen.",
    "small nudge: i'd love to compare notes when you're free.",
    "i'm around tomorrow afternoon if that helps.",
    "wanted to check: would you want a warm intro first?",
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
    <MacWindow title="messages" onClose={onClose} style={{ minHeight:0 }}>
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
            }}>no conversations yet, open someone from your radar to start one.</div>
          ) : conversations.map(c => (
            <button key={c.id} onClick={() => onOpen(c.id)} style={{
              textAlign:"left", display:"grid", gridTemplateColumns:"auto 1fr auto",
              gap:12, alignItems:"center", padding:"10px 12px",
              border:"1px solid #000", background:"#fff", cursor:"pointer",
              boxShadow: c.unread > 0
                ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 rgba(0,0,0,0.2)"
                : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3), 1px 1px 0 rgba(0,0,0,0.2)",
            }}>
              <Avatar name={c.name} photo={c.person ? c.person.photo : null} size={32}/>
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
    "the moment passed. they committed to something else before you replied.",
    "they went quiet, and your agent stopped surfacing them after a few days.",
    "the overlap cooled as your signal sharpened, and your edges drifted apart.",
    "they matched elsewhere first; your agent closed the thread to keep the radar clean.",
  ];
  const s = person.id || person.name || "x";
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return R[h % R.length];
}

// A plain bold heading in the reading face. The em-dash-and-tracked-caps
// treatment this replaced dressed up ordinary section labels as machine
// output; a heading over a paragraph is just a heading over a paragraph.
function SummarySection({ label, children }) {
  return (
    <div style={{ display:"grid", gap:5 }}>
      <div style={{
        fontFamily:"var(--mac-sans)", fontSize:12.5, fontWeight:700,
        color:"#000", letterSpacing:-0.1,
      }}>{label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"#000" }}>
        {children}
      </div>
    </div>
  );
}

/* Summary of an expired person, opens in the 3rd window when you click one. */
function SummaryWindow({ person, onClose }) {
  return (
    <MacWindow title="summary" onClose={onClose} dismiss style={{ minHeight:0 }}>
      <div style={{ display:"grid", gridTemplateRows:"auto 1fr", gridTemplateColumns:"minmax(0, 1fr)", flex:1, minHeight:0, minWidth:0 }}>
        <div style={{
          padding:"12px 16px", borderBottom:"1px solid #000",
          display:"flex", gap:12, alignItems:"center", background:"#fff",
        }}>
          <Avatar name={person.name} photo={person.photo} size={34}/>
          <div style={{ display:"grid", gap:2, minWidth:0 }}>
            <div style={{ fontFamily:"var(--amiga-title)", fontSize:15, fontWeight:600, color:"#000" }}>
              {person.name}
            </div>
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
              letterSpacing:1, textTransform:"uppercase",
            }}>expired{person.location ? ` · ${person.location}` : ""}</div>
          </div>
        </div>

        <div className="mac-scroll" style={{
          overflowY:"auto", padding:"16px", display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:16,
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

/* The card's fields overlap heavily by construction, the API mappers build
   `overlap` out of the same headline as `blurb`, and `signals` out of the same
   two strings as `location`/`distance`, so rendering every field gave the
   profile the same sentence three times under three different headings. This
   walks the fields in order of importance and drops anything already said. */
function normText(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, " ");
}

// "Feedback on Collaborative Interfaces: Luc Baracat", the header two lines
// up already says whose profile this is.
function stripSelfName(text, name) {
  const t = String(text || "").trim();
  const n = String(name || "").trim();
  if (!t || !n) return t;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return t.replace(new RegExp("\\s*[:\\u2013\\u2014-]\\s*" + esc + "\\s*$", "i"), "").trim() || t;
}

function profileContent(person) {
  const seen = new Set();
  const block = (v) => { const k = normText(v); if (k) seen.add(k); };
  const take = (v) => {
    const k = normText(v);
    if (!k || seen.has(k)) return null;
    seen.add(k);
    return String(v).trim();
  };

  // The headline and the shared-signal chips are both the system's summary of
  // this person, and neither is theirs. What the profile shows is the intro
  // they wrote about themselves, so the card's own blurb is only blocked here
  // to keep it from reappearing through another field.
  block(person.blurb);
  const bio = take(person.bio);
  const note = take(person.pitchFromAgent);
  const socials = (person.socials || []).filter(s => s && s.handle);

  // `location` and `distance` are not what they sound like on a home card: the
  // mapper fills them with the section heading the card was grouped under and
  // its mutual-intents label, which is how "MEET THESE NEW CONNECTIONS ·
  // Aligned goals" ended up reading as this person's details. Both are the
  // system describing its own grouping, so neither belongs on their profile.
  const meta = [];
  if (person.mutuals > 0) {
    meta.push(`${person.mutuals} mutual${person.mutuals === 1 ? "" : "s"}`);
  }
  const via = String(person.introVia || "").trim();
  // "intro via Index" is the product telling you it's the product
  if (via && !/^index(\s*network)?$/i.test(via)) meta.push(`intro via ${via}`);

  return { bio, note, socials, meta };
}

/* A social link: the platform's mark and the username, nothing else. The
   normalizing lives in primitives so this and the settings editor agree on what
   a handle is. Bordered like a gadget rather than like the flat share chips
   above, because unlike those these are pressable. */
function SocialLink({ social }) {
  const [hover, setHover] = useState(false);
  const platform = socialPlatformOf(social);
  const href = socialHrefOf(social);
  const ink = hover ? "#fff" : "#000";
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
      title={`${platform} · ${href}`}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:"inline-flex", alignItems:"center", gap:6,
        fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:0.2,
        padding:"4px 9px", border:"1px solid #000", textDecoration:"none",
        background: hover ? "#000" : "#fff",
        color: ink,
        boxShadow:"1px 1px 0 rgba(0,0,0,0.2)",
      }}>
      <SocialGlyph id={platform} size={13} color={ink}/>
      <span>{socialHandleOf(social)}</span>
    </a>
  );
}

/* A card opened from outside the app (an index:// link or a universal link).
   The route can land on any screen, including the hub where no signal is open
   and the radar's selection state does not exist, so it floats above whatever
   is showing instead. It only wraps the windows the radar already uses:
   an expired opportunity reads as its summary, anything else as the profile.
   Read-only, because accept/pass/chat belong to the signal that surfaced the
   card and a deep link does not say which signal that was. */
function DeepLinkWindow({ person, route, onClose }) {
  const expired = route === "card" && person.status === "expired";
  return (
    <div
      onClick={onClose}
      style={{
        position:"fixed", inset:0, zIndex:900,
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:"56px 18px",
      }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ display:"flex", width:"min(460px, 100%)", maxHeight:"100%", minHeight:0 }}>
        {expired
          ? <SummaryWindow person={person} onClose={onClose}/>
          : <ProfileWindow person={person} onClose={onClose} actions={false}/>}
      </div>
    </div>
  );
}

/* Full profile for a person, opens in the 3rd window when you click their
   name or avatar on the radar. `actions` off drops the stage CTA, for a
   profile opened outside a signal (see DeepLinkWindow) where accepting or
   passing has no scope to act in. */
function ProfileWindow({ person, onClose, onAccept, onPass, onOpenChat, actions = true }) {
  const status = person.status;
  const isReady = status === "ready";
  const isAccepted = status === "accepted";
  const isExpired = status === "expired";
  // The intro someone wrote in their profile settings does not travel on an
  // opportunity card, so it is fetched here from GET /users/:id and merged
  // under anything the card already carried.
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    setFetched(null);
    const userId = person.userId;
    if (!userId || !window.IndexApp || !window.IndexApp.isAuthed()) return;
    const client = window.IndexApp.getClient();
    if (!client || !client.users || !client.users.get) return;
    let cancelled = false;
    client.users.get(userId)
      .then((res) => {
        if (cancelled) return;
        const u = (res && res.user) || res;
        if (u) setFetched(window.IndexApi.mapCounterpartProfile(u));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [person.userId]);

  const merged = fetched
    ? {
        ...person,
        bio: person.bio || fetched.bio,
        photo: person.photo || fetched.photo,
        socials: (person.socials && person.socials.length) ? person.socials : fetched.socials,
      }
    : person;
  const { bio, note, socials, meta } = profileContent(merged);
  return (
    <MacWindow title="profile" onClose={onClose} dismiss style={{ minHeight:0 }}>
      <div style={{ display:"grid", gridTemplateRows:"auto 1fr auto", gridTemplateColumns:"minmax(0, 1fr)", flex:1, minHeight:0, minWidth:0 }}>
        {/* header, just who this is. the stage they're at is already said by
            the footer (accept/pass vs send message), and a match percentage is
            the agent grading a person at you */}
        <div style={{
          padding:"14px 16px", borderBottom:"1px solid #000",
          display:"flex", gap:12, alignItems:"center", background:"#fff",
        }}>
          <Avatar name={person.name} photo={merged.photo} size={42} ring={isAccepted}/>
          <div style={{
            fontFamily:"var(--amiga-title)", fontSize:17, fontWeight:600, color:"#000",
            minWidth:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
          }}>{person.name}</div>
        </div>

        {/* body, the person's own intro first, then why your agent surfaced
            them, then where else to find them. Anything the system generated
            about them is dropped upstream rather than repeated under a label */}
        <div className="mac-scroll" style={{
          overflowY:"auto", padding:"16px", display:"grid", gridTemplateColumns:"minmax(0, 1fr)", gap:15,
          alignContent:"start", background:"#fff",
        }}>
          {bio && (
            <SummarySection label="bio">
              <div style={{ display:"grid", gap:9 }}>
                {bio.split(/\n{2,}/).map((para, i) => (
                  <div key={i}>{para.trim()}</div>
                ))}
              </div>
            </SummarySection>
          )}

          {note && (
            <SummarySection label="why your agent surfaced them">{note}</SummarySection>
          )}

          {socials.length > 0 && (
            <SummarySection label="elsewhere">
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {socials.map(s => <SocialLink key={`${s.id}${s.handle}`} social={s}/>)}
              </div>
            </SummarySection>
          )}

          {isExpired && (
            <SummarySection label="why it closed">{expiryReason(person)}</SummarySection>
          )}

          {/* the leftovers, one quiet line, not four bullets under a heading */}
          {meta.length > 0 && (
            <div style={{
              fontFamily:"var(--mac-mono)", fontSize:10.5, color:"var(--ink-3)",
              letterSpacing:0.3, lineHeight:1.6,
            }}>{meta.join("  ·  ")}</div>
          )}
        </div>

        {/* footer CTA, matches the radar stage */}
        {actions && (
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
        )}
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
    <MacWindow title="chat" onClose={onClose} dismiss style={{ minHeight:0 }}>
        <div style={{
          display:"grid",
          gridTemplateRows: "auto 1fr auto",
          gridTemplateColumns: "minmax(0, 1fr)",
          flex:1, minHeight:0, minWidth:0,
        }}>
          {/* header */}
          <div style={{
            padding:"12px 16px", borderBottom:"1px solid #000",
            display:"flex", gap:12, alignItems:"center", background:"#fff",
          }}>
            <Avatar name={person.name} photo={person.photo} size={34}/>
            <div style={{ display:"grid", gap:2, minWidth:0 }}>
              <div style={{ fontFamily:"var(--amiga-title)", fontSize:15, fontWeight:600, color:"#000" }}>
                {person.name}
              </div>
              {person.location && (
                <div style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)" }}>
                  {person.location}
                </div>
              )}
            </div>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="mac-scroll" style={{
            overflowY:"auto", padding:"14px 16px",
            display:"flex", flexDirection:"column", gap:10, background:"#fff",
          }}>
            <ChatOpener person={person}/>
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

/* The whole opportunity, at the top of the thread: what it is, and what these
   two can do for each other. Without it the chat opens as a blank page
   addressed to a stranger, and the one-line headline was too thin to act on.
   It scrolls away with the log, because it is the first thing said rather than
   part of the chrome.

   The card's long write-up carries the substance; the headline sits above it
   when it says something the write-up does not already open with. */
function ChatOpener({ person }) {
  const headline = String(person.blurb || "").trim();
  const detail = String(person.detail || person.pitchFromAgent || "").trim();
  const body = detail || headline;
  if (!body) return null;
  const showHeadline = headline && normText(headline) !== normText(body);
  return (
    <div style={{
      border:"1px solid var(--ink-4)", background:"#FBFAF7",
      padding:"12px 14px", display:"grid", gap:7, marginBottom:6,
    }}>
      {showHeadline && (
        <span style={{
          fontFamily:"var(--mac-sans)", fontSize:13.5, fontWeight:600,
          color:"#000", lineHeight:1.35, letterSpacing:-0.1,
        }}>{headline}</span>
      )}
      <span style={{
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.5, color:"var(--ink-2)",
      }}>{body}</span>
    </div>
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
window.DeepLinkWindow = DeepLinkWindow;
