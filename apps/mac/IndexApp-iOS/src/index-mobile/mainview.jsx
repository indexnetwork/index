// Main view — mobile. The desktop's three side-by-side windows (conversation,
// radar, chat) become three bottom-tab panes (signals, radar, messages) with
// chat / profile / summary opening as full-screen sheets. All simulation logic
// is shared from logic.jsx, so behavior matches the desktop build exactly.

const RETENTION_OPTIONS = ["1 week", "2 weeks", "1 month", "3 months", "never"];

function RetentionNote({ retention, onChange }) {
  return (
    <div style={{
      display:"flex", alignItems:"center", gap:6, flexWrap:"wrap",
      fontFamily:"var(--mac-mono)", fontSize:10, color:"#888", letterSpacing:0.2,
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
                    field, setField, simRate, setSimRate, onBack }) {
  const { CLARIFIERS, FIELD_EVENTS, AMBIENT_NOTES } = window.INDEX_DATA;
  const [activeTab, setActiveTab] = useState("signals");   // bottom-nav tab
  const [radarFilter, setRadarFilter] = useState("all");   // within-radar filter
  const [paused] = useState(false);
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
      setPipelineMode(m === "narrowing" ? "focused" : "broad");
    }, holdMs);
  };
  useEffect(() => () => modeTimerRef.current && clearTimeout(modeTimerRef.current), []);

  /* ----- ambient sim: append field events + maybe bump scores ----- */
  useInterval(() => {
    if (paused) return;
    const ev = FIELD_EVENTS[Math.floor(Math.random() * FIELD_EVENTS.length)];
    setField(prev => [{ ...ev, id: rid(), t: now() }, ...prev].slice(0, 50));
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

  /* ----- seed feed with the first batch of clarifiers ----- */
  useEffect(() => {
    if (queuedRef.current) return;
    queuedRef.current = true;
    const timers = [];
    for (let k = 0; k < MAX_OPEN; k++) timers.push(setTimeout(() => pushClarifierOne(), 2400 + k * 850));
    return () => timers.forEach(clearTimeout);
  }, []);

  const makeClarifier = () => {
    const c = CLARIFIERS[clarifierCursor.current % CLARIFIERS.length];
    clarifierCursor.current += 1;
    return {
      kind:"clarifier", id: `${c.id}-${rid().slice(0,4)}`, clarifierId: c.id,
      source: c.source, sourceMeta: c.sourceMeta, effect: c.effect || "neutral",
      text: c.text, chips: c.chips, triggersHint: c.triggersHint,
      answered: false, choice: null, t: now(),
    };
  };
  const pushClarifierOne = () => {
    setConversation(prev => {
      const open = prev.filter(it => it.kind === "clarifier" && !it.answered).length;
      if (open >= MAX_OPEN) return prev;
      return [...prev, makeClarifier()];
    });
  };

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
      setField(prev => [{ kind:"warm", text: lines[Math.floor(Math.random()*lines.length)], id: rid(), t: now() }, ...prev].slice(0, 50));
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
      setField(prev => [{ kind:"passed", text:"a candidate just expired · they left or the moment closed.", id: rid(), t: now() }, ...prev].slice(0, 50));
    }
  }, paused ? null : 14000 / simRate);

  const visiblePeople = useMemo(() => people.filter(p => !p.hidden), [people]);
  const filtered = useMemo(() => [...visiblePeople].sort((a, b) => b.score - a.score), [visiblePeople]);

  const negotiatingPeople = useMemo(
    () => visiblePeople.filter(p => !["accepted", "ready", "expired", "passed"].includes(p.status)),
    [visiblePeople]
  );
  const readyCount = useMemo(() => visiblePeople.filter(p => p.status === "ready").length, [visiblePeople]);
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
    setConversation(prev => prev.map(it => it.id === item.id ? { ...it, answered:true, choice } : it));
    const effectKind = applyClarifierEffect(clarifier, choice, setPeople, setField);
    const finalKind = effectKind || (item.effect && item.effect !== "neutral" ? item.effect : "broad");
    flashMode(finalKind, finalKind === "expanding" ? 8000 : 9000);
    answeredSinceRefill.current += 1;
    if (answeredSinceRefill.current >= 2) {
      answeredSinceRefill.current = 0;
      for (let k = 0; k < 2; k++) setTimeout(() => pushClarifierOne(), 900 + k * 850);
    }
  };
  const dismissClarifier = (item) => {
    setConversation(prev => prev.map(it => it.id === item.id ? { ...it, answered:true, choice:"(dismissed)", dismissed:true } : it));
  };

  const [draft, setDraft] = useState("");
  const sendDraft = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    setDraft("");
    setConversation(prev => [...prev, { kind:"user", id: rid(), text, t: now() }]);
  };

  /* ----- chats / sheets ----- */
  const [sheet, setSheet] = useState(null);            // { kind:"chat"|"profile"|"summary", id }
  const [chats, setChats] = useState({});
  const [chatDraft, setChatDraft] = useState("");
  const [unread, setUnread] = useState({});
  const [responses, setResponses] = useState({});
  const [retentionIdx, setRetentionIdx] = useState(1);
  const retention = RETENTION_OPTIONS[retentionIdx];
  const cycleRetention = () => setRetentionIdx(i => (i + 1) % RETENTION_OPTIONS.length);

  const chatId = sheet && sheet.kind === "chat" ? sheet.id : null;

  const openChat = (personId) => {
    setUnread(prev => (prev[personId] ? { ...prev, [personId]: 0 } : prev));
    setChats(prev => {
      if (prev[personId]) return prev;
      const person = people.find(p => p.id === personId);
      return person ? { ...prev, [personId]: seedChat(person, responses[personId]) } : prev;
    });
    setSheet({ kind:"chat", id: personId });
  };
  const openSummary = (personId) => setSheet({ kind:"summary", id: personId });
  const openProfile = (personId) => setSheet({ kind:"profile", id: personId });
  const closeSheet = () => setSheet(null);

  const respondPerson = (personId, text) => {
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, status: "ready" } : p));
    if (text && text.trim()) setResponses(prev => ({ ...prev, [personId]: text.trim() }));
  };
  const acceptPerson = (personId) => setPeople(prev => prev.map(p => p.id === personId ? { ...p, status: "accepted" } : p));
  const passPerson = (personId) => {
    if (chatId === personId) closeSheet();
    setPeople(prev => prev.map(p => p.id === personId ? { ...p, status: "passed" } : p));
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

  // already-open chats occasionally ping you (quiet unread bump)
  useInterval(() => {
    if (paused) return;
    const candidates = Object.keys(chats).filter(id => id !== chatId);
    if (candidates.length === 0) return;
    const pid = candidates[Math.floor(Math.random() * candidates.length)];
    const person = people.find(p => p.id === pid);
    setChats(prev => ({ ...prev, [pid]: [...(prev[pid] || []), { id: rid(), who:"them", text: incomingPing(person) }] }));
    setUnread(prev => ({ ...prev, [pid]: (prev[pid] || 0) + 1 }));
  }, (paused || Object.keys(chats).length === 0) ? null : 16000 / simRate);

  const chatIds = Object.keys(chats);
  const unreadTotal = chatIds.reduce((a, id) => a + (unread[id] || 0), 0);
  const conversations = chatIds.map(id => {
    const p = people.find(x => x.id === id);
    const msgs = chats[id] || [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    return { id, person: p, name: p ? p.name : id, unread: unread[id] || 0,
             last: last ? last.text : "", lastWho: last ? last.who : null };
  }).sort((a, b) => b.unread - a.unread);

  const pendingCount = useMemo(
    () => conversation.filter(it => it.kind === "clarifier" && !it.answered).length,
    [conversation]
  );

  const sheetPerson = sheet ? people.find(p => p.id === sheet.id) : null;

  const tabs = [
    { key:"signals",  glyph:"›",  label:"signals",  badge: pendingCount + negotiatingPeople.length },
    { key:"radar",    glyph:"◎",  label:"radar",     badge: readyCount },
    { key:"messages", glyph:"≋",  label:"messages",  badge: unreadTotal },
  ];

  return (
    <React.Fragment>
      <div className="mob-desktop" style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
        {/* active pane */}
        <div style={{ flex:1, minHeight:0, position:"relative" }}>
          {activeTab === "signals" && (
            <ConversationPane
              profile={profile}
              conversation={conversation}
              onAnswer={answerClarifier}
              onDismiss={dismissClarifier}
              draft={draft} setDraft={setDraft} sendDraft={sendDraft}
              negotiatingPeople={negotiatingPeople}
              onRespondPerson={respondPerson}
              pendingCount={pendingCount}
            />
          )}
          {activeTab === "radar" && (
            <MatchFeed
              radarFilter={radarFilter} setRadarFilter={setRadarFilter}
              profile={profile}
              people={filtered}
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
          )}
          {activeTab === "messages" && (
            <Inbox
              conversations={conversations}
              onOpen={openChat}
              retention={retention}
              onChangeRetention={cycleRetention}
            />
          )}
        </div>

        {/* bottom tab bar */}
        <BottomNav tabs={tabs} active={activeTab} onChange={setActiveTab}/>
      </div>

      {/* sheets, over everything */}
      {sheet && sheetPerson && sheet.kind === "chat" && (
        <ChatSheet
          person={sheetPerson} messages={chats[chatId] || []}
          draft={chatDraft} setDraft={setChatDraft} onSend={sendChat} onClose={closeSheet}
          retention={retention} onChangeRetention={cycleRetention}
        />
      )}
      {sheet && sheetPerson && sheet.kind === "summary" && (
        <SummarySheet person={sheetPerson} onClose={closeSheet}/>
      )}
      {sheet && sheetPerson && sheet.kind === "profile" && (
        <ProfileSheet person={sheetPerson} onClose={closeSheet}
          onAccept={acceptPerson} onPass={passPerson} onOpenChat={openChat}/>
      )}
    </React.Fragment>
  );
}

/* =================== SIGNALS PANE (questions feed) =================== */
function ConversationPane({ profile, conversation, onAnswer, onDismiss, draft, setDraft, sendDraft,
                            negotiatingPeople = [], onRespondPerson, pendingCount }) {
  const scrollRef = useRef(null);
  const waiting = pendingCount + negotiatingPeople.length;
  return (
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
      <PanelHeader
        title={profile.intent || "your signal"}
        right={waiting > 0 ? (
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:10, background:"#000", color:"#fff",
            padding:"2px 8px", letterSpacing:0.3, whiteSpace:"nowrap",
          }}>{waiting} waiting</span>
        ) : null}
      />

      <div ref={scrollRef} className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        padding:"14px 16px 10px", display:"flex", flexDirection:"column", gap:14, background:"#fff",
      }}>
        {groupQuestions(negotiatingPeople).map(g =>
          g.people.length >= 2
            ? <CollectiveQuestionCard key={"cq-" + g.q} question={g.q} people={g.people} onRespond={onRespondPerson}/>
            : <PersonQuestionCard key={"pq-" + g.people[0].id} person={g.people[0]} onRespond={onRespondPerson}/>
        )}
        {conversation
          .filter(it => it.kind === "clarifier" || it.kind === "user")
          .map((it) =>
            it.kind === "clarifier"
              ? <ClarifierCard key={it.id} item={it} onAnswer={(c) => onAnswer(it, c)} onDismiss={() => onDismiss(it)}/>
              : <UserLine key={it.id}>{it.text}</UserLine>
          )}
        {waiting === 0 && conversation.filter(it => it.kind === "clarifier").length === 0 && (
          <div style={{
            padding:24, textAlign:"center", marginTop:8,
            fontFamily:"var(--mac-mono)", fontSize:12, color:"#555", border:"1px dashed #000",
          }}>your agent is listening. questions will land here as agents negotiate.</div>
        )}
      </div>

      <div style={{
        flex:"0 0 auto", borderTop:"2px solid #000", padding:"8px 14px calc(8px + var(--safe-bottom))",
        background:"#fff", display:"flex", gap:10, alignItems:"center",
      }}>
        <span style={{ fontFamily:"var(--mac-mono)", color:"#000" }}>›</span>
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") sendDraft(); }}
          placeholder="tell index something. or just wait."
          style={{
            flex:1, background:"transparent", border:"none", outline:"none",
            color:"#000", fontFamily:"var(--mac-sans)", fontSize:14, padding:"6px 0",
          }}
        />
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"#555" }}>↵</span>
      </div>
    </div>
  );
}

/* shared question card */
function QuestionCard({ icon, source, tag, question, chips = [], onChip, onWrite, writePlaceholder = "or write your own ↵" }) {
  const [draft, setDraft] = useState("");
  const submit = () => { if (!draft.trim()) return; onWrite && onWrite(draft.trim()); setDraft(""); };
  return (
    <div className="fade-up" style={{ border:"1px solid #000", background:"#fff", padding:"14px 15px", display:"grid", gap:11 }}>
      <div style={{
        display:"flex", alignItems:"center", gap:7, minWidth:0,
        fontFamily:"var(--mac-mono)", fontSize:10.5, color:"#999", letterSpacing:0.3,
      }}>
        {icon}
        <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", minWidth:0 }}>{source}</span>
        {tag && <span style={{ color:"#bbb", flex:"0 0 auto" }}>· {tag}</span>}
      </div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:16, fontWeight:500, lineHeight:1.4, color:"#000", letterSpacing:-0.1 }}>{question}</div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
        {chips.map(c => <AnswerChip key={c} label={c} onClick={() => onChip && onChip(c)}/>)}
      </div>
      <input
        value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") submit(); }}
        placeholder={writePlaceholder}
        style={{
          display:"block", width:"100%",
          background:"transparent", color:"#000",
          border:"none", borderBottom:"1px solid #ccc",
          fontFamily:"var(--mac-sans)", fontSize:13, padding:"4px 0", outline:"none",
        }}
      />
    </div>
  );
}

function CollectiveQuestionCard({ question, people, onRespond }) {
  return (
    <QuestionCard
      icon={<span style={{ fontFamily:"var(--mac-mono)", fontSize:12, fontWeight:700, color:"#000" }}>Σ</span>}
      source={`${people.length} people asking the same`} tag="collective" question={question}
      chips={questionChips(question)}
      onChip={(c) => people.forEach(p => onRespond && onRespond(p.id, c))}
      onWrite={(t) => people.forEach(p => onRespond && onRespond(p.id, t))}
      writePlaceholder={`or answer all ${people.length} ↵`}
    />
  );
}

function PersonQuestionCard({ person, onRespond }) {
  const q = personQuestion(person);
  return (
    <QuestionCard
      icon={<Avatar name={person.name} size={18}/>}
      source={`from ${person.name}`} tag="negotiating" question={q}
      chips={questionChips(q)}
      onChip={(c) => onRespond && onRespond(person.id, c)}
      onWrite={(t) => onRespond && onRespond(person.id, t)}
    />
  );
}

function ClarifierCard({ item, onAnswer }) {
  const collective = item.source === "collective" || item.source === "room";
  const meta = item.sourceMeta || {};
  const sourceLabel = collective
    ? (meta.count ? `${meta.count} ${meta.of || "agents"}` : "your circle")
    : (meta.name ? `from ${meta.name}` : "from an agent");
  if (item.answered) {
    return (
      <div className="fade-up" style={{
        border:"1px solid #ccc", background:"#fff", padding:"11px 15px", display:"grid", gap:6,
        opacity: item.dismissed ? 0.4 : 1,
      }}>
        <div style={{ fontFamily:"var(--mac-mono)", fontSize:10.5, color:"#999" }}>{sourceLabel}</div>
        <div style={{ fontFamily:"var(--mac-sans)", fontSize:13.5, color:"#666", lineHeight:1.4 }}>{item.text}</div>
        <div style={{ fontFamily:"var(--mac-mono)", fontSize:11, display:"flex", gap:8 }}>
          <span style={{ color:"#999" }}>your reply</span>
          <span style={{ color:"#000" }}>"{item.choice}"</span>
        </div>
      </div>
    );
  }
  return (
    <QuestionCard
      icon={<span style={{ fontFamily:"var(--mac-mono)", fontSize:12, fontWeight: collective ? 700 : 400, color:"#000" }}>{collective ? "Σ" : "›"}</span>}
      source={sourceLabel} tag={collective ? "collective" : "agent"} question={item.text}
      chips={item.chips} onChip={(c) => onAnswer(c)} onWrite={(t) => onAnswer(t)}
    />
  );
}

function AnswerChip({ label, onClick }) {
  const [down, press] = usePress();
  return (
    <button onClick={onClick} {...press}
      style={{
        padding:"5px 14px", fontFamily:"var(--mac-sans)", fontSize:13,
        border:"1px solid #000", background: down ? "#000" : "transparent",
        color: down ? "#fff" : "#000", borderRadius:9, cursor:"pointer",
      }}>{label}</button>
  );
}

function UserLine({ children }) {
  return (
    <div className="fade-up" style={{ display:"flex", gap:10, marginLeft:24 }}>
      <span style={{ color:"#555", fontFamily:"var(--mac-mono)", fontSize:13, marginTop:2 }}>›</span>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:13.5, color:"#444", fontStyle:"italic" }}>"{children}"</div>
    </div>
  );
}

/* =================== RADAR PANE =================== */
function MatchFeed({ radarFilter, setRadarFilter, people, field, funnelStages, pipelineMode,
                     onOpenRoom, onAccept, onPass, onSummary, onProfile, unread = {}, chatIds = [], profile = {} }) {
  const bucket = (p) => {
    if (p.status === "accepted") return "accepted";
    if (p.status === "expired")  return "expired";
    if (p.status === "ready")    return "ready";
    if (p.status === "passed")   return "passed";
    return "negotiating";
  };
  const peopleForTab = radarFilter === "all" ? people : people.filter(p => bucket(p) === radarFilter);
  return (
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
      <div style={{ flex:"0 0 auto", padding:"12px 16px 12px", borderBottom:"2px solid #000", background:"#fff" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <h2 style={{
            margin:0, fontFamily:"var(--amiga-title)", fontWeight:500, fontSize:16, color:"#000",
            letterSpacing:-0.2, lineHeight:1.2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
          }}>{profile.intent || "your signal"}</h2>
        </div>
        <div style={{ marginTop:8, height:18 }}>
          <Ticker items={field.slice(0, 8).length > 0 ? field.slice(0, 8) : [{ text:"warming up…" }]} intervalMs={2600}/>
        </div>
        <div style={{ marginTop:10 }}>
          <PipelineFunnel stages={funnelStages} onClickStage={(label) => setRadarFilter(label)} activeStage={radarFilter}/>
        </div>
      </div>

      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto",
        padding:"12px 16px calc(20px + var(--safe-bottom))",
        display:"grid", gap:8, alignContent:"start", background:"#fff",
      }}>
        {peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} onOpenRoom={onOpenRoom} onAccept={onAccept} onPass={onPass}
            onSummary={onSummary} onProfile={onProfile}
            hasChat={chatIds.includes(p.id)} unreadCount={unread[p.id] || 0}/>
        ))}
        {peopleForTab.length === 0 && (
          <div style={{
            padding:24, textAlign:"center", fontFamily:"var(--mac-mono)", fontSize:12,
            color:"#555", border:"1px dashed #000",
          }}>{
            radarFilter === "accepted" ? "no one accepted yet — accept someone from your ready list."
            : radarFilter === "expired" ? "nothing expired — these are people the moment passed on."
            : radarFilter === "ready" ? "no one ready yet — answer their questions in signals first."
            : "no one here right now. the field keeps moving — check back."
          }</div>
        )}
      </div>
    </div>
  );
}

function MatchCard({ person, onOpenRoom, onAccept, onPass, onSummary, onProfile, hasChat = false, unreadCount = 0 }) {
  const openProfile = (e) => { e.stopPropagation(); onProfile && onProfile(person.id); };
  const accepted = person.status === "accepted";
  const readyStage = person.status === "ready";
  const isPassed = person.status === "passed";
  const isExpired = person.status === "expired";
  const negotiating = !accepted && !readyStage && !isPassed && !isExpired;
  const cardClickable = accepted || isExpired;
  const handleClick = accepted
    ? () => onOpenRoom && onOpenRoom(person.id)
    : isExpired ? () => onSummary && onSummary(person.id) : undefined;
  return (
    <div onClick={handleClick} className="fade-up"
      style={{
        textAlign:"left", display:"grid", gridTemplateColumns:"auto 1fr", gap:12, padding:"13px 13px",
        background:"#fff", color:"#000", border:"1px solid #000",
        borderLeft: accepted ? "3px solid #FF8A00" : "1px solid #000",
        filter: (isPassed || isExpired) ? "opacity(0.5)" : "none",
        cursor: cardClickable ? "pointer" : "default",
      }}>
      <span onClick={openProfile} style={{ cursor:"pointer", lineHeight:0 }}>
        <Avatar name={person.name} size={38} ring={accepted}/>
      </span>
      <div style={{ display:"grid", gap:6, minWidth:0 }}>
        <div onClick={openProfile} style={{ fontFamily:"var(--mac-sans)", fontSize:15, fontWeight:600, cursor:"pointer" }}>
          {person.name}
        </div>
        <div style={{ fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4 }}>{person.blurb}</div>

        {/* action row */}
        <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:2, flexWrap:"wrap" }}>
          {accepted ? (
            <React.Fragment>
              <button className="amiga-gadget primary"
                onClick={(e) => { e.stopPropagation(); onOpenRoom && onOpenRoom(person.id); }}
                style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"6px 14px" }}>
                {hasChat ? "open chat ›" : "send message"}
              </button>
              {unreadCount > 0 && (
                <span style={{
                  fontFamily:"var(--mac-mono)", fontSize:9, fontWeight:700,
                  background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"2px 6px",
                }}>{unreadCount} new</span>
              )}
            </React.Fragment>
          ) : readyStage ? (
            <React.Fragment>
              <button className="amiga-gadget primary"
                onClick={(e) => { e.stopPropagation(); onAccept && onAccept(person.id); }}
                style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"6px 16px" }}>accept</button>
              <button className="amiga-gadget"
                onClick={(e) => { e.stopPropagation(); onPass && onPass(person.id); }}
                style={{ fontFamily:"var(--mac-mono)", fontSize:11, padding:"6px 16px" }}>pass</button>
            </React.Fragment>
          ) : negotiating ? (
            <span style={{
              display:"flex", alignItems:"center", gap:5,
              fontFamily:"var(--mac-mono)", fontSize:9.5, letterSpacing:1, textTransform:"uppercase", color:"#555",
            }}>
              <span style={{ width:6, height:6, background:"#FF8A00", border:"1px solid #000", flex:"0 0 auto" }}/>
              negotiating
            </span>
          ) : isExpired ? (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:9.5, opacity:0.75 }}>expired · tap for summary ›</span>
          ) : (
            <span style={{ fontFamily:"var(--mac-mono)", fontSize:9.5, opacity:0.5 }}>{person.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* =================== MESSAGES PANE =================== */
function Inbox({ conversations, onOpen, retention, onChangeRetention }) {
  const totalUnread = conversations.reduce((a, c) => a + (c.unread || 0), 0);
  return (
    <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column" }}>
      <PanelHeader
        title="messages"
        right={totalUnread > 0 ? (
          <span style={{
            fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
            background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"1px 7px",
          }}>{totalUnread} new</span>
        ) : null}
      />
      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto", padding:"12px 16px", display:"grid", gap:8, alignContent:"start", background:"#fff",
      }}>
        {conversations.length === 0 ? (
          <div style={{
            padding:24, textAlign:"center", fontFamily:"var(--mac-mono)", fontSize:12, color:"#555", border:"1px dashed #000",
          }}>no conversations yet — accept someone on your radar to start one.</div>
        ) : conversations.map(c => (
          <ConvRow key={c.id} c={c} onOpen={() => onOpen(c.id)}/>
        ))}
      </div>
      <div style={{ flex:"0 0 auto", borderTop:"2px solid #000", padding:"10px 14px calc(10px + var(--safe-bottom))", background:"#fff" }}>
        <RetentionNote retention={retention} onChange={onChangeRetention}/>
      </div>
    </div>
  );
}

function ConvRow({ c, onOpen }) {
  const [down, press] = usePress();
  return (
    <button onClick={onOpen} {...press}
      style={{
        textAlign:"left", display:"grid", gridTemplateColumns:"auto 1fr auto", gap:12, alignItems:"center",
        padding:"12px 12px", border:"1px solid #000", background:"#fff", cursor:"pointer",
        boxShadow: c.unread > 0
          ? "inset 1px 1px 0 #FFD7A0, inset -1px -1px 0 #8A4500, 1px 1px 0 #000"
          : (down ? "inset 1px 1px 0 #888, inset -1px -1px 0 #fff" : "inset 1px 1px 0 #fff, inset -1px -1px 0 #888, 1px 1px 0 #000"),
      }}>
      <Avatar name={c.name} size={34}/>
      <div style={{ display:"grid", gap:3, minWidth:0 }}>
        <div style={{ fontFamily:"var(--amiga-title)", fontSize:14, fontWeight:600, color:"#000" }}>{c.name}</div>
        <div style={{ fontFamily:"var(--mac-sans)", fontSize:12.5, color:"#555", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
          {c.lastWho === "you" ? "you: " : ""}{c.last}
        </div>
      </div>
      {c.unread > 0 ? (
        <span style={{
          fontFamily:"var(--mac-mono)", fontSize:9.5, fontWeight:700,
          background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"1px 6px", flex:"0 0 auto",
        }}>{c.unread}</span>
      ) : (
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#888", flex:"0 0 auto" }}>›</span>
      )}
    </button>
  );
}

/* =================== SHEETS =================== */
function SummarySection({ label, children }) {
  return (
    <div style={{ display:"grid", gap:6 }}>
      <div style={{ fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:1.5, textTransform:"uppercase", color:"#000" }}>— {label}</div>
      <div style={{ fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.5, color:"#000" }}>{children}</div>
    </div>
  );
}

function PersonHeader({ person, sub, ring }) {
  return (
    <div style={{
      flex:"0 0 auto", padding:"14px 16px", borderBottom:"1px solid #000",
      display:"flex", gap:12, alignItems:"center", background:"#fff",
    }}>
      <Avatar name={person.name} size={40} ring={ring}/>
      <div style={{ display:"grid", gap:2, minWidth:0 }}>
        <div style={{ fontFamily:"var(--amiga-title)", fontSize:16, fontWeight:600, color:"#000" }}>{person.name}</div>
        <div style={{ fontFamily:"var(--mac-mono)", fontSize:10, color:"#555", letterSpacing:1, textTransform:"uppercase" }}>{sub}</div>
      </div>
    </div>
  );
}

function SummarySheet({ person, onClose }) {
  return (
    <Sheet title={`summary · ${person.name}`} onClose={onClose}>
      <PersonHeader person={person} sub={`expired · ${person.location}`}/>
      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto", padding:"16px", display:"grid", gap:16, alignContent:"start", background:"#fff",
      }}>
        <SummarySection label="what your agent found">{person.pitchFromAgent || person.blurb}</SummarySection>
        <SummarySection label="signals">
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {(person.signals || []).map(s => (
              <span key={s} style={{ fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3, padding:"2px 7px", border:"1px solid #000" }}>{s}</span>
            ))}
          </div>
        </SummarySection>
        {person.overlap && person.overlap.length > 0 && (
          <SummarySection label="what you shared">{person.overlap.join(" · ")}</SummarySection>
        )}
        <SummarySection label="why it closed">{expiryReason(person)}</SummarySection>
        <SummarySection label="last seen">{person.distance}</SummarySection>
      </div>
    </Sheet>
  );
}

function ProfileSheet({ person, onClose, onAccept, onPass, onOpenChat }) {
  const status = person.status;
  const isReady = status === "ready";
  const isAccepted = status === "accepted";
  const isExpired = status === "expired";
  const footer = (
    <div style={{
      flex:"0 0 auto", borderTop:"2px solid #000",
      padding:"10px 14px calc(10px + var(--safe-bottom))", background:"#fff",
      display:"flex", alignItems:"center", gap:10,
    }}>
      {isReady ? (
        <React.Fragment>
          <Btn primary small onClick={() => onAccept && onAccept(person.id)}>accept</Btn>
          <Btn small onClick={() => onPass && onPass(person.id)}>pass</Btn>
        </React.Fragment>
      ) : isAccepted ? (
        <Btn primary small onClick={() => { onClose(); onOpenChat && onOpenChat(person.id); }}>send message</Btn>
      ) : isExpired ? (
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#888" }}>this signal closed.</span>
      ) : (
        <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#888" }}>answer their question in signals to move forward.</span>
      )}
    </div>
  );
  return (
    <Sheet title={`profile · ${person.name}`} onClose={onClose} footer={footer}>
      <PersonHeader person={person} sub={statusWord(status)} ring={isAccepted}/>
      <div className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto", padding:"16px", display:"grid", gap:16, alignContent:"start", background:"#fff",
      }}>
        <SummarySection label="about">{person.blurb}</SummarySection>
        {person.pitchFromAgent && <SummarySection label="what your agent sees">{person.pitchFromAgent}</SummarySection>}
        <SummarySection label="signals">
          <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
            {(person.signals || []).map(s => (
              <span key={s} style={{ fontFamily:"var(--mac-mono)", fontSize:10, letterSpacing:0.3, padding:"2px 7px", border:"1px solid #000" }}>{s}</span>
            ))}
          </div>
        </SummarySection>
        {person.overlap && person.overlap.length > 0 && (
          <SummarySection label="what you share">{person.overlap.join(" · ")}</SummarySection>
        )}
        <SummarySection label="details">
          <div style={{ display:"grid", gap:4, fontFamily:"var(--mac-mono)", fontSize:11.5, color:"#000" }}>
            {person.location && <div>· {person.location}</div>}
            {person.distance && <div>· {person.distance}</div>}
            {typeof person.mutuals === "number" && <div>· {person.mutuals} mutual{person.mutuals === 1 ? "" : "s"}</div>}
            {person.introVia && <div>· intro via {person.introVia}</div>}
          </div>
        </SummarySection>
        {isExpired && <SummarySection label="why it closed">{expiryReason(person)}</SummarySection>}
      </div>
    </Sheet>
  );
}

function ChatSheet({ person, messages, draft, setDraft, onSend, onClose, retention, onChangeRetention }) {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);
  const footer = (
    <div style={{ flex:"0 0 auto", borderTop:"2px solid #000", background:"#fff" }}>
      {retention && <div style={{ padding:"7px 12px 0" }}><RetentionNote retention={retention} onChange={onChangeRetention}/></div>}
      <div style={{ padding:"7px 12px calc(8px + var(--safe-bottom))", display:"flex", gap:10, alignItems:"center" }}>
        <span style={{ fontFamily:"var(--mac-mono)", color:"#000" }}>›</span>
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") onSend(); }}
          placeholder={`message ${person.name}…`}
          style={{ flex:1, background:"transparent", border:"none", outline:"none", color:"#000", fontFamily:"var(--mac-sans)", fontSize:14, padding:"5px 0" }}
        />
        <button className="amiga-gadget" onClick={onSend} style={{ padding:"6px 14px" }}>send</button>
      </div>
    </div>
  );
  return (
    <Sheet title={`chat · ${person.name}`} onClose={onClose} footer={footer}>
      <PersonHeader person={person} sub={person.location}/>
      <div ref={scrollRef} className="mac-scroll" style={{
        flex:1, minHeight:0, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:10, background:"#fff",
      }}>
        {messages.map(m => <ChatBubble key={m.id} m={m}/>)}
      </div>
    </Sheet>
  );
}

function ChatBubble({ m }) {
  if (m.who === "index") {
    return (
      <div style={{ fontFamily:"var(--mac-mono)", fontSize:10.5, color:"#555", textAlign:"center", letterSpacing:0.3, lineHeight:1.5, padding:"0 8px" }}>{m.text}</div>
    );
  }
  const you = m.who === "you";
  return (
    <div style={{ display:"flex", justifyContent: you ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth:"82%", border:"1px solid #000",
        background: you ? "#000" : "#fff", color: you ? "#fff" : "#000",
        padding:"9px 12px", fontFamily:"var(--mac-sans)", fontSize:13.5, lineHeight:1.4,
        boxShadow: you ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 #888",
      }}>{m.text}</div>
    </div>
  );
}

window.MainView = MainView;
