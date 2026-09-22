/* =================== LEFT, CONVERSATION =================== */
// Small Workbench-style control for managing the running signal (pause / stop).
// `danger` carries the app's destructive treatment (--ink-warn, same as the
// delete-account gadget in settings): warn-red outline at rest so archiving
// never looks like the pause next to it, a red wash on hover, and a solid red
// fill once it's armed, the point of no return is the only thing that fills.
/* The gap the feed keeps above the composer, and the distance within which it
   still counts as "at the bottom". The threshold has to clear the spacer:
   resting on it is resting at the end of the thread, not scrolling up. */
const FEED_BOTTOM_SPACER = 28;
const FEED_BOTTOM_PIN = FEED_BOTTOM_SPACER + 20;

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

function ConversationPane({ profile, conversation, negotiatingPeople = [], onRespondPerson,
                            agentMessages = null, agentQuestions = [], onSendAgent, onSendAnswers,
                            focusQuestion = 0, paused = false, onTogglePause, onArchive }) {
  const scrollRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [selections, setSelections] = useState({});
  const [writing, setWriting] = useState({});
  const [sending, setSending] = useState(false);
  const inbox = agentMessages != null;
  const questions = inbox ? (agentQuestions || []) : [];
  const inboxFeed = useMemo(() => buildInboxFeed(agentMessages || []), [agentMessages]);
  const chosen = questions.filter((q) => typeof selections[q.id] === "string" && selections[q.id].trim());
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
  // A notification tap lands on the signal, not on the question inside it, so
  // the card brings itself into view. Keyed on the tap rather than the question
  // so tapping again re-focuses one that is already open.
  const agentQuestionRef = useRef(null);
  useEffect(() => {
    if (!focusQuestion || !agentQuestionRef.current) return;
    agentQuestionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusQuestion, questions.length]);
  useEffect(() => { setSelections({}); setWriting({}); }, [profile && profile.intentId]);
  const feedLen = inbox ? agentMessages.length + questions.length : conversation.length;

  const [stuck, setStuck] = useState(true);
  const [unread, setUnread] = useState(0);
  const lastLen = useRef(feedLen);
  // Distance from the bottom of the feed, kept live as you scroll. We restore
  // this exact gap after any content change so answering a question (which
  // shrinks its card) never yanks the viewport around.
  const bottomGap = useRef(0);

  React.useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = feedLen > lastLen.current;
    if (bottomGap.current <= FEED_BOTTOM_PIN) {
      // pinned to the bottom, stay pinned, following new content
      el.scrollTop = el.scrollHeight;
      setUnread(0);
    } else {
      // scrolled up, hold the same spot so nothing jumps under you
      el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight - bottomGap.current);
      if (grew) setUnread(u => u + (feedLen - lastLen.current));
    }
    lastLen.current = feedLen;
  }, [feedLen, negotiatingPeople, questions.length]);

  // The composer grows with what you type and stops at three lines, after
  // which it scrolls: 13px text at 1.4 plus the field's own padding.
  const draftRef = useRef(null);
  const COMPOSER_MAX = Math.round(13 * 1.4 * 3) + 8;
  React.useLayoutEffect(() => {
    const el = draftRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX)}px`;
  }, [draft, COMPOSER_MAX]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setSending(true);
    onSendAgent(text, () => setSending(false));
  };

  const onScroll = (e) => {
    const el = e.currentTarget;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    bottomGap.current = gap;
    const atBottom = gap < FEED_BOTTOM_PIN;
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
        overflowY:"auto", padding:"20px",
        display:"flex", flexDirection:"column",
      }}>
        {inbox ? (
          <div style={{ display:"flex", flexDirection:"column", gap:22, minHeight:0, flex:"0 0 auto" }}>
            {agentMessages.length === 0 ? (
              <div style={{
                fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)", lineHeight:1.45,
              }}>Ask about your matches, share a preference, or give your agent direction for this signal.</div>
            ) : inboxFeed.map((it) => {
              if (it.kind === "user") return <UserLine key={it.id}>{it.text}</UserLine>;
              if (it.kind === "decisions") return <DecisionGroup key={it.id} items={it.items}/>;
              if (it.kind === "negotiation-logs") return <NegotiationLogGroup key={it.id} items={it.items}/>;
              if (it.kind === "answered-question") return <AnsweredQuestion key={it.id} item={it}/>;
              if (it.kind === "progress") return <ProgressLine key={it.id} text={it.text}/>;
              return <AgentNote key={it.id} item={it}/>;
            })}
            {questions.length > 0 && (
              <div ref={agentQuestionRef} style={{ display:"flex", flexDirection:"column", gap:22 }}>
                {questions.map((question) => {
                  const options = Array.isArray(question.options) ? question.options : [];
                  const answer = selections[question.id] || "";
                  const asker = questionAsker(question);
                  const own = options.indexOf(answer) < 0 && answer;
                  const write = writing[question.id] || !options.length;
                  return (
                    <article key={question.id} style={{ display:"flex", gap:12 }}>
                      {asker.owner
                        ? <TheirAgentAvatar owner={asker.owner} size={30} style={{ marginTop:2 }}/>
                        : <MyAgentAvatar size={30} style={{ marginTop:2 }}/>}
                      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:10 }}>
                        <div>
                          <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:5 }}>
                            <span style={{
                              background:"#111", color:"#fff", padding:"2px 6px", borderRadius:3,
                              fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:600, letterSpacing:"0.05em",
                            }}>QUESTION</span>
                            <span style={{
                              fontFamily:"var(--mac-mono)", fontSize:11, color:"#8f8f88",
                              textTransform:"uppercase", letterSpacing:"0.05em",
                            }}>{asker.label}</span>
                          </div>
                          {/* The question reads as the agent speaking, so it wears
                              the AgentNote type — only heavier, to carry the ask. */}
                          <div style={{
                            maxWidth:"92%",
                            fontFamily:"var(--mac-sans)", fontSize:14, fontWeight:600, lineHeight:1.55, color:"#2a2a2a",
                          }}>{question.question}</div>
                        </div>
                        <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                          {options.map((option) => (
                            <OptionChip key={option} label={option} selected={answer === option}
                              onClick={() => {
                                setSelections((cur) => ({
                                  ...cur, [question.id]: cur[question.id] === option ? "" : option,
                                }));
                                setWriting((cur) => ({ ...cur, [question.id]: false }));
                              }}/>
                          ))}
                          {write ? (
                            <input
                              autoFocus={!!options.length}
                              value={own ? answer : ""}
                              onChange={(e) => setSelections((cur) => ({ ...cur, [question.id]: e.target.value }))}
                              onBlur={(e) => {
                                if (!e.currentTarget.value.trim()) {
                                  setWriting((cur) => ({ ...cur, [question.id]: false }));
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Escape" && !e.currentTarget.value.trim()) {
                                  setWriting((cur) => ({ ...cur, [question.id]: false }));
                                }
                              }}
                              placeholder="write your own"
                              aria-label="Write your own answer"
                              // Same box as the chip it replaces, so opening the
                              // field never moves the row it sits in.
                              style={{
                                flex:"1 1 220px", minWidth:180, minHeight:36,
                                border:"1px solid #000", padding:"8px 14px",
                                fontFamily:"var(--mac-mono)", fontSize:12, color:"#111", outline:"none",
                              }}
                            />
                          ) : (
                            <OptionChip write label="write your own"
                              onClick={() => {
                                setSelections((cur) => ({ ...cur, [question.id]: "" }));
                                setWriting((cur) => ({ ...cur, [question.id]: true }));
                              }}/>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
        <div style={{
          marginTop:"auto",
          display:"flex", flexDirection:"column", gap:14,
        }}>
          {groupQuestions(negotiatingPeople).map(g =>
            g.people.length >= 2 ? (
              <CollectiveQuestionCard key={"cq-" + g.q} question={g.q} people={g.people} onRespond={onRespondPerson}/>
            ) : (
              <PersonQuestionCard key={"pq-" + g.people[0].id} person={g.people[0]} onRespond={onRespondPerson}/>
            )
          )}
          {conversation
            .filter(it => it.kind === "clarifier" || it.kind === "user" || it.kind === "agent")
            .map((it) =>
              it.kind === "clarifier" ? (
                <ClarifierCard key={it.id} item={it}/>
              ) : it.kind === "user" ? (
                <UserLine key={it.id}>{it.text}</UserLine>
              ) : (
                <AgentLine key={it.id}><AgentMarkdown text={it.text}/></AgentLine>
              )
            )}
        </div>
        )}
        {/* A scrolling flex column drops its own bottom padding once the
            content overflows, so the gap above the composer is a spacer. */}
        <div style={{ height:onSendAgent ? 20 : FEED_BOTTOM_SPACER, flex:"0 0 auto" }}/>
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

      {chosen.length > 0 && (
        <div style={{
          borderTop:"1px solid #000", padding:"10px 14px", background:"#fff",
          display:"flex", flexDirection:"row-reverse", justifyContent:"flex-start", alignItems:"center", gap:12,
        }}>
          <button
            type="button"
            disabled={!chosen.length || sending}
            style={{
              fontFamily:"var(--mac-mono)", fontSize:12, padding:"8px 18px",
              background: chosen.length && !sending ? "#111" : "#fff",
              color: chosen.length && !sending ? "#fff" : "#999",
              border:"1px solid #000",
              cursor: chosen.length && !sending ? "pointer" : "default",
            }}
            onClick={() => {
              if (!chosen.length || sending || !onSendAnswers) return;
              setSending(true);
              onSendAnswers(chosen.map((q) => ({ questionId: q.id, text: selections[q.id].trim() })), () => {
                setSelections({});
                setWriting({});
                setSending(false);
              });
            }}
          >{sending ? "sending…" : chosen.length > 1 ? `send ${chosen.length} answers` : "send answer"}</button>
          <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, color:"#8f8f88" }}>
            {questions.length - chosen.length > 0
              ? `${questions.length - chosen.length} of ${questions.length} unanswered`
              : "all answered · ready to send"}
          </span>
        </div>
      )}

      {onSendAgent && (
        <div style={{
          borderTop:"1px solid #000",
          background:"#fff",
        }}>
          <div style={{ padding:"7px 12px 8px", display:"flex", gap:10, alignItems:"flex-end" }}>
            <textarea
              ref={draftRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Message your personal agent…"
              aria-label="Message your personal agent"
              style={{
                flex:1, minWidth:0, display:"block",
                maxHeight:COMPOSER_MAX, overflowY:"auto", resize:"none",
                background:"transparent", border:"none", outline:"none",
                color:"#000", fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4,
                padding:"4px 0",
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim() || sending}
              aria-label="Send"
              title="send"
              style={{
                display:"grid", placeItems:"center", width:22, height:22, flex:"0 0 auto",
                background:"none", border:"none", padding:0, lineHeight:0, marginBottom:2,
                color: draft.trim() && !sending ? "#111" : "#b9b3a4",
                cursor: draft.trim() && !sending ? "pointer" : "default",
              }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
                <line x1="12" y1="20" x2="12" y2="5"/>
                <polyline points="5,12 12,5 19,12"/>
              </svg>
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// Briefs and decisions are one unit of work. Gather them by opportunity and
// leave one disclosure in the transcript where that run first appeared.
function buildInboxFeed(messages) {
  const decisionRuns = new Map();
  const negotiationLogs = [];
  let logsAt = -1;
  const questions = new Map();
  const answers = new Map();
  let runId = "before-discovery";
  messages.forEach((message, index) => {
    if (message.kind === "progress") runId = message.id;
    if (message.kind === "brief" || message.kind === "decision") {
      const run = decisionRuns.get(runId) || { id:runId, at:index, decisions:new Map() };
      const key = message.opportunityId || message.counterpart || message.id;
      const current = run.decisions.get(key) || {
        id:key, counterpart:message.counterpart || "match", brief:"", decision:"",
      };
      current[message.kind] = message.text;
      run.decisions.set(key, current);
      decisionRuns.set(runId, run);
    }
    if (message.kind === "negotiation-log") {
      if (logsAt < 0) logsAt = index;
      negotiationLogs.push(message);
    }
    if (message.kind === "question-history" && message.questionId) questions.set(message.questionId, { ...message, at:index });
    if (message.kind === "answer-history" && message.questionId) answers.set(message.questionId, message);
  });
  if (!decisionRuns.size && !negotiationLogs.length && !answers.size) return messages;

  const insertions = new Map();
  decisionRuns.forEach((run) => {
    const items = Array.from(run.decisions.values());
    const entry = { kind:"decisions", id:`decisions-${run.id}`, items };
    insertions.set(run.at, [...(insertions.get(run.at) || []), entry]);
  });
  questions.forEach((question, questionId) => {
    const answer = answers.get(questionId);
    if (!answer) return;
    const entry = { ...question, kind:"answered-question", id:`answered-${questionId}`, answer:answer.text };
    insertions.set(question.at, [...(insertions.get(question.at) || []), entry]);
  });
  const feed = [];
  let logsInserted = false;
  runId = "before-discovery";
  messages.forEach((message, index) => {
    if (message.kind === "progress") runId = message.id;
    const additions = insertions.get(index) || [];
    additions.forEach((entry) => feed.push(entry));
    if (!logsInserted && negotiationLogs.length && index >= logsAt) {
      feed.push({ kind:"negotiation-logs", id:"negotiation-logs", items:negotiationLogs });
      logsInserted = true;
    }
    if (message.kind === "progress") {
      feed.push(message);
      return;
    }
    if (message.kind !== "brief" && message.kind !== "decision" && message.kind !== "negotiation-log"
        && message.kind !== "question-history" && message.kind !== "answer-history") feed.push(message);
  });
  return feed;
}

function DecisionGroup({ items }) {
  const continued = items.filter((item) => item.decision === "continue" || item.decision === "accept").length;
  return (
    <details style={{ border:"1px solid var(--ink-3)", background:"#fff" }}>
      <summary style={{
        padding:"9px 12px", cursor:"pointer", listStylePosition:"inside",
        fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:0.25,
      }}>
        Discovery decisions · {items.length} reviewed · {continued} reaching out
      </summary>
      <div style={{ borderTop:"1px solid var(--ink-4)" }}>
        {items.map((item, index) => (
          <div key={item.id} style={{
            padding:"10px 12px", display:"grid", gap:6,
            borderTop:index ? "1px solid var(--ink-4)" : "none",
          }}>
            <div style={{ display:"flex", alignItems:"baseline", gap:8, minWidth:0 }}>
              <strong style={{
                flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                fontFamily:"var(--mac-sans)", fontSize:13,
              }}>{item.counterpart}</strong>
              {item.decision && <span style={{
                fontFamily:"var(--mac-mono)", fontSize:10, textTransform:"uppercase", letterSpacing:0.4,
              }}>{item.decision}</span>}
            </div>
            {item.brief && <div style={{
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.45, color:"var(--ink-2)",
            }}><AgentMarkdown text={item.brief}/></div>}
          </div>
        ))}
      </div>
    </details>
  );
}

function ProgressLine({ text }) {
  return (
    <div className="fade-up" role="status" style={{
      display:"grid", gridTemplateColumns:"8px 1fr", gap:9, alignItems:"start",
      padding:"2px 0", color:"var(--ink-2)",
    }}>
      <span style={{ width:7, height:7, marginTop:5, borderRadius:99, background:"#000" }}/>
      <span style={{ fontFamily:"var(--mac-mono)", fontSize:11, lineHeight:1.55 }}>{text}</span>
    </div>
  );
}

function AnsweredQuestion({ item }) {
  const asker = questionAsker(item);
  return (
    <article className="fade-up" style={{ display:"flex", gap:12 }}>
      {asker.owner
        ? <TheirAgentAvatar owner={asker.owner} size={30} style={{ marginTop:2 }}/>
        : <MyAgentAvatar size={30} style={{ marginTop:2 }}/>}
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:10 }}>
        <div>
          <div style={{
            display:"flex", gap:8, alignItems:"center", marginBottom:5,
            fontFamily:"var(--mac-mono)", fontSize:11,
            textTransform:"uppercase", letterSpacing:"0.05em",
          }}>
            <span style={{ color:"#2f7d4f", fontWeight:600 }}>✓ answered</span>
            <span style={{ color:"#8f8f88" }}>{asker.label}</span>
          </div>
          <div style={{
            maxWidth:"92%", background:"#fff",
            fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.55, color:"#2a2a2a",
          }}>{item.text}</div>
        </div>
        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <div style={{
            maxWidth:"92%", padding:"11px 14px",
            background:"#2a2a2a", color:"#fff", borderRadius:"4px 4px 2px 4px",
            fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.5,
            wordBreak:"break-word",
          }}>{item.answer}</div>
        </div>
      </div>
    </article>
  );
}

function NegotiationLogGroup({ items }) {
  return (
    <details style={{ border:"1px solid var(--ink-3)", background:"#fff" }}>
      <summary style={{
        padding:"9px 12px", cursor:"pointer", listStylePosition:"inside",
        fontFamily:"var(--mac-mono)", fontSize:11, letterSpacing:0.25,
      }}>
        Negotiation log · {items.length} {items.length === 1 ? "entry" : "entries"}
      </summary>
      <div style={{ borderTop:"1px solid var(--ink-4)" }}>
        {items.map((item, index) => (
          <div key={item.id} style={{
            padding:"10px 12px", display:"grid", gap:5,
            borderTop:index ? "1px solid var(--ink-4)" : "none",
          }}>
            <strong style={{
              fontFamily:"var(--mac-sans)", fontSize:13,
            }}>{item.counterpart || "Match"}</strong>
            <div style={{
              fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.45, color:"var(--ink-2)",
            }}><AgentMarkdown text={item.text}/></div>
          </div>
        ))}
      </div>
    </details>
  );
}

function AgentNote({ item }) {
  return (
    <div className="fade-up" style={{ display:"flex", gap:12 }}>
      <MyAgentAvatar size={30} style={{ marginTop:2 }}/>
      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:10 }}>
        <div>
          <div style={{
            marginBottom:5, fontFamily:"var(--mac-mono)", fontSize:11,
            color:"#8f8f88", textTransform:"uppercase", letterSpacing:"0.05em",
          }}>your agent</div>
          <aside style={{
            maxWidth:"92%",
            background:"#fff",
            fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.55, color:"#2a2a2a",
          }}>
            <AgentMarkdown text={item.text}/>
          </aside>
        </div>
      </div>
    </div>
  );
}

function questionAsker(question) {
  const matches = Array.isArray(question.matches) ? question.matches : [];
  const people = matches.map((match) => match && match.counterparty).filter((c) => c && c.name);
  if (people.length === 1) {
    return { label: agentLabel(people[0].name), owner: { id: people[0].id, name: people[0].name, photo: null } };
  }
  if (people.length > 1) {
    return { label: `${people.map((p) => p.name).join(", ")}’s agents`, owner: null };
  }
  return { label: question.scope === "match" ? "this match’s agent" : "your agent", owner: null };
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
      {/* suggested options as chips, then a write-your-own row, answer however
          you like */}
      <div style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
        {chips.map((c) => (
          <OptionChip key={c} label={c} onClick={() => onChip && onChip(c)}/>
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
function OptionChip({ label, selected = false, write = false, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={onClick}
      aria-pressed={write ? undefined : selected}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display:"inline-flex", alignItems:"center", minHeight:36,
        padding:"8px 14px", cursor:"pointer", textAlign:"left",
        ...(write ? {
          background:"transparent",
          border:"1px solid #000",
          color: hover ? "#111" : "#8a8577",
          fontFamily:"var(--mac-mono)", fontSize:12,
        } : {
          background: selected ? "#111" : "#fff",
          border:"1px solid #000",
          color: selected ? "#fff" : "#111",
          fontFamily:"var(--mac-sans)", fontSize:13.5,
        }),
      }}>{label}</button>
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

/* Your own agent, held on this signal until you answer.

   Unlike the cards around it this one is live: the question, its suggested
   answers, and the matches it is asked about all come from the agent's
   conversation, and the answer goes back to the same place. */
function AgentQuestionCard({ question, onAnswer }) {
  const matches = Array.isArray(question.matches) ? question.matches : [];
  const about = matches
    .map((m) => (m && m.counterparty && m.counterparty.name) || "")
    .filter(Boolean)
    .join(", ");
  return (
    <QuestionCard
      icon={<AgentAvatar size={18} title="your agent"/>}
      source="from your agent"
      tag={about || (question.scope === "match" ? "about a match" : "about this signal")}
      question={question.question}
      chips={Array.isArray(question.options) ? question.options : []}
      onChip={(c) => onAnswer && onAnswer(c)}
      onWrite={(t) => onAnswer && onAnswer(t)}
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

function ClarifierCard({ item }) {
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
// from the questions coming in on the left. Your text goes through the same
// markdown as the agent's, so a list you typed reads as a list.
function UserLine({ children }) {
  return (
    <div className="fade-up own-md" style={{ display:"flex", justifyContent:"flex-end" }}>
      <div style={{
        maxWidth:"92%", padding:"11px 14px",
        background:"#2a2a2a", color:"#fff", borderRadius:"4px 4px 2px 4px",
        fontFamily:"var(--mac-sans)", fontSize:14, lineHeight:1.5,
        wordBreak:"break-word",
      }}><AgentMarkdown text={children}/></div>
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
