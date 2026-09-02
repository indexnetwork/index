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

function ConversationPane({ profile, conversation, onAnswer, onDismiss, negotiatingPeople = [], onRespondPerson, paused = false, onTogglePause, onArchive }) {
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
              whole signal is one hover away.

              maxHeight repeats the cap the line-clamp already implies, because
              the clamp alone does not reliably constrain the box's layout
              height in WebKit the way it does in Blink: the title rendered its
              third line while the header had been sized for less, and the
              status line came out through the rule again. lineHeight is 1.2, so
              three lines is 3.6em, and this is what actually holds the header
              open. Keep the two in step if either changes. */}
          <h2
            title={profile.intent || "your signal"}
            style={{
              margin:0, fontFamily:"var(--amiga-title)", fontWeight:500,
              fontSize:17, color:"#000", letterSpacing:-0.2, lineHeight:1.2,
              flex:1, minWidth:0,
              display:"-webkit-box", WebkitBoxOrient:"vertical", WebkitLineClamp:3,
              maxHeight:"3.6em",
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
            {/* The same LiveDot the shelf puts on a running signal, rather than
                a green pill only this header drew: one signal, two screens, one
                mark for "working". Paused shows no dot, matching the shelf,
                where the mark is what says it is running. */}
            {!paused && <LiveDot size={6}/>}
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
// The agent mark itself lives in primitives as AgentAvatar, every surface
// where something speaks on your behalf uses that one visual.

// Agent replies are untrusted model output. The shared renderer escapes raw
// HTML, then allowlists the markdown tree and only retains normalized http(s)
// links. WKNavigationDelegate sends those links to NSWorkspace, never into this
// credential-bearing document.
function AgentMarkdown({ text }) {
  const html = useMemo(() => {
    try {
      return window.IndexApi.renderAgentMarkdown(window.marked, window.DOMParser, text);
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
