/* Every person-to-person thread, whether or not a signal still holds the match
   behind it. Mirrors the Hermes dashboard's messages panel: the list on the
   left, the open thread on the right. Agent DMs and negotiations are left out,
   the same two-users filter the dashboard and web sidebar use. */
function conversationRow(c, myId) {
  const others = (c.participants || []).filter(p => p && p.participantId !== myId);
  const other = others[0] || {};
  const last = c.lastMessage;
  return {
    id: c.id,
    userId: other.participantId || null,
    name: other.name || "someone",
    photo: other.avatar || null,
    last: last ? apiChatMessage(last, myId).text : "",
    lastAt: c.lastMessageAt || (last && last.createdAt) || "",
    createdAt: c.createdAt || "",
    via: (Array.isArray(c.via) ? c.via : []).map(v => v && v.title).filter(Boolean),
    unread: c.unreadCount || 0,
  };
}

function chatDayLabel(at) {
  if (!at) return "";
  const d = new Date(at);
  if (isNaN(d.getTime())) return "";
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString([], opts).toLowerCase();
}

function chatListWhen(at) {
  const day = chatDayLabel(at);
  if (!day) return "";
  if (day === "today") return chatTime(at);
  return day;
}

function isPersonThread(c) {
  const ps = (c && c.participants) || [];
  return ps.length === 2 && ps.every(p => p && p.participantType === "user");
}

function Conversations({ initialConversationId, onClose, onRead, onNewSignal, onOpenProfile }) {
  const myId = (window.INDEX_DATA && window.INDEX_DATA.ME && window.INDEX_DATA.ME.id) || null;
  const [convs, setConvs] = useState(null);
  const [listError, setListError] = useState(false);
  const [activeId, setActiveId] = useState(initialConversationId || null);
  // null while the open thread is loading, "error" when it failed.
  const [messages, setMessages] = useState(null);
  const [threadTry, setThreadTry] = useState(0);
  const [draft, setDraft] = useState("");
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const scrollRef = useRef(null);
  const [client] = useState(() => (
    window.IndexApp && window.IndexApp.isAuthed() ? window.IndexApp.getClient() : null
  ));

  const loadList = React.useCallback(() => {
    if (!client) { setConvs([]); return; }
    client.conversations.list()
      .then((res) => {
        const rows = window.IndexApp.normalizeList(res, "conversations")
          .filter(isPersonThread)
          .map(c => {
            const row = conversationRow(c, myId);
            if (row.id === activeRef.current) row.unread = 0;
            return row;
          });
        setListError(false);
        setConvs(rows);
      })
      .catch((err) => {
        console.warn("[conversations] list failed", err);
        // A failed refresh keeps the rows already on screen; the error state
        // only renders while there is nothing loaded yet.
        setListError(true);
      });
  }, [client, myId]);

  useEffect(() => { loadList(); }, [loadList]);

  // Opening the menu with no specific thread lands on the top of the list,
  // the most recent conversation. A deep link still wins.
  useEffect(() => {
    if (activeId || !convs || !convs.length) return;
    const first = convs.slice().sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)))[0];
    if (first) setActiveId(first.id);
  }, [convs, activeId]);

  useEffect(() => {
    setMessages(null);
    if (!activeId || !client) return;
    let cancelled = false;
    client.conversations.messages(activeId)
      .then((res) => {
        if (cancelled) return;
        setMessages(window.IndexApp.normalizeList(res, "messages").map(m => apiChatMessage(m, myId)));
      })
      .catch((err) => {
        console.warn("[conversations] thread failed", err);
        if (!cancelled) setMessages("error");
      });
    // The row drops immediately. The server cursor is what the shelf and Dock
    // re-read, so a local zero without this comes back on the next refresh.
    setConvs((prev) => prev && prev.map(c => c.id === activeId ? { ...c, unread: 0 } : c));
    if (client.conversations.markRead) {
      client.conversations.markRead(activeId).then(() => {
        if (!cancelled && onRead) onRead();
      }).catch(() => { if (!cancelled) loadList(); });
    }
    return () => { cancelled = true; };
  }, [activeId, client, myId, onRead, loadList, threadTry]);

  useEffect(() => {
    const sub = window.IndexApp.streamInbox((event) => {
      if (!event || event.type !== "message" || !event.message) return;
      const m = apiChatMessage(event.message, myId);
      if (event.conversationId === activeRef.current && m.who !== "you") {
        setMessages((prev) => !Array.isArray(prev) ? prev : prev.some(x => x.id === m.id) ? prev : [...prev, m]);
        if (client && client.conversations.markRead) {
          client.conversations.markRead(event.conversationId).then(() => {
            if (onRead) onRead();
          }).catch(() => {});
        }
      }
      setConvs((prev) => {
        if (!prev) return prev;
        if (!prev.some(c => c.id === event.conversationId)) { loadList(); return prev; }
        return prev.map(c => c.id !== event.conversationId ? c : {
          ...c,
          last: m.text,
          lastAt: m.at || nowISO(),
          unread: c.id === activeRef.current || m.who === "you" ? c.unread : c.unread + 1,
        });
      });
    });
    return () => { if (sub && sub.close) sub.close(); };
  }, [myId, loadList, client, onRead]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = () => {
    const text = draft.trim();
    if (!text || !activeId || !client) return;
    setDraft("");
    const at = nowISO();
    setMessages((prev) => [...(Array.isArray(prev) ? prev : []), { id: rid(), who:"you", text, at }]);
    setConvs((prev) => prev && prev.map(c => c.id === activeId ? { ...c, last: text, lastAt: at } : c));
    client.conversations.sendMessage(activeId, { parts: [{ text }] }).catch(() => {});
  };

  const sorted = (convs || []).slice().sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  const active = sorted.find(c => c.id === activeId) || null;
  const openActiveProfile = () => { if (active && active.userId && onOpenProfile) onOpenProfile(active.userId); };

  return (
    <div style={{
      position:"absolute", inset:0,
      display:"grid", placeItems:"center",
      gridTemplateColumns:"minmax(0, 1fr)",
      padding:"56px 40px", overflow:"auto",
    }}>
      <div style={{ width:860, maxWidth:"100%", height:"min(660px, calc(100vh - 112px))" }}>
        <MacWindow title="conversations" onClose={onClose} style={{ height:"100%", minHeight:0 }}>
          <div style={{
            display:"grid", gridTemplateColumns:"280px minmax(0, 1fr)",
            flex:1, minHeight:0, background:"#fff",
          }}>
            {/* list */}
            <div className="mac-scroll" style={{
              borderRight:"2px solid #000", overflowY:"auto", minHeight:0,
            }}>
              {listError && convs === null ? (
                <EmptyState tone="error" message="couldn't load conversations." align="left"
                  onRetry={() => { setListError(false); loadList(); }} style={{ margin:12 }}/>
              ) : convs === null ? (
                <EmptyState tone="loading" framed={false} align="left" style={{ margin:"10px 16px" }}/>
              ) : sorted.length === 0 ? (
                <EmptyState
                  message="no conversations yet. a chat opens when you and someone both accept an intro."
                  action={onNewSignal ? { label:"start a signal", onClick:onNewSignal } : null}
                  align="left" style={{ margin:12 }}/>
              ) : sorted.map(c => (
                <button key={c.id} onClick={() => setActiveId(c.id)} style={{
                  display:"grid", gridTemplateColumns:"auto minmax(0, 1fr) auto",
                  gap:10, alignItems:"center", width:"100%", textAlign:"left",
                  padding:"10px 12px", border:"none", borderBottom:"1px solid var(--ink-4)",
                  background: c.id === activeId ? "#F2F0EC" : "#fff", cursor:"pointer",
                }}>
                  <Avatar id={c.userId || c.id} name={c.name} photo={c.photo} size={32}/>
                  <span style={{ display:"grid", gap:3, minWidth:0 }}>
                    <span style={{ display:"flex", gap:8, alignItems:"baseline", minWidth:0 }}>
                      <span style={{
                        flex:1, minWidth:0,
                        fontFamily:"var(--mac-mono)", fontSize:13, fontWeight:700, color:"#000",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                      }}>{c.name}</span>
                      {chatListWhen(c.lastAt) && (
                        <span style={{
                          flex:"0 0 auto",
                          fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                        }}>{chatListWhen(c.lastAt)}</span>
                      )}
                    </span>
                    <span style={{
                      fontFamily:"var(--mac-sans)", fontSize:12, color:"var(--ink-2)",
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                    }}>{c.last || "no messages yet."}</span>
                  </span>
                  {c.unread > 0 && (
                    <span style={{
                      fontFamily:"var(--mac-mono)", fontSize:10, fontWeight:700,
                      background:"#FF8A00", color:"#000", border:"1px solid #000", padding:"0 6px",
                    }}>{c.unread}</span>
                  )}
                </button>
              ))}
            </div>

            {/* thread */}
            {activeId ? (
              <div style={{ display:"grid", gridTemplateRows:"auto 1fr auto", minHeight:0, minWidth:0 }}>
                <div style={{
                  padding:"12px 16px", borderBottom:"1px solid #000",
                  display:"flex", gap:12, alignItems:"center",
                }}>
                  {active && (
                    <span onClick={openActiveProfile} title="view profile" style={{ cursor:"pointer", lineHeight:0 }}>
                      <Avatar id={active.userId || active.id} name={active.name} photo={active.photo} size={34}/>
                    </span>
                  )}
                  <div style={{ display:"grid", gap:2, minWidth:0 }}>
                    <div onClick={openActiveProfile} title="view profile" style={{ fontFamily:"var(--amiga-title)", fontSize:15, fontWeight:600, color:"#000", cursor:"pointer" }}>
                      {active ? active.name : ""}
                    </div>
                    {active && (chatDayLabel(active.createdAt) || active.via.length > 0) && (
                      <div style={{
                        fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                      }}>
                        {chatDayLabel(active.createdAt) ? `started ${chatDayLabel(active.createdAt)}` : ""}
                        {chatDayLabel(active.createdAt) && active.via.length ? " · " : ""}
                        {active.via.length ? active.via[0] : ""}
                      </div>
                    )}
                  </div>
                </div>
                <div ref={scrollRef} className="mac-scroll mac-chat-dated" style={{
                  overflowY:"auto", padding:"14px 16px", minHeight:0,
                  display:"flex", flexDirection:"column", gap:10,
                }}>
                  {messages === null ? (
                    <EmptyState tone="loading" framed={false} align="left"/>
                  ) : messages === "error" ? (
                    <EmptyState tone="error" message="couldn't load this conversation." align="left"
                      onRetry={() => setThreadTry(n => n + 1)}/>
                  ) : messages.length === 0 ? (
                    <EmptyState message="no messages yet. say hello." framed={false} align="left"/>
                  ) : messages.map((m, i) => {
                    const day = chatDayLabel(m.at);
                    const prev = i > 0 ? chatDayLabel(messages[i - 1].at) : "";
                    return (
                      <React.Fragment key={m.id}>
                        {day && day !== prev && (
                          <div style={{
                            display:"flex", alignItems:"center", gap:8,
                            margin: i === 0 ? "0 0 2px" : "6px 0 2px",
                          }}>
                            <span style={{ flex:1, height:1, background:"var(--ink-4)" }}/>
                            <span style={{
                              fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-3)",
                              letterSpacing:0.3,
                            }}>{day}</span>
                            <span style={{ flex:1, height:1, background:"var(--ink-4)" }}/>
                          </div>
                        )}
                        <ChatBubble m={m}/>
                      </React.Fragment>
                    );
                  })}
                </div>
                <div style={{ borderTop:"1px solid #000", padding:"7px 12px 8px", display:"flex", gap:10, alignItems:"flex-end" }}>
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                    }}
                    placeholder="write a message…"
                    aria-label="write a message"
                    style={{
                      flex:1, minWidth:0, resize:"none", maxHeight:62, overflowY:"auto",
                      background:"transparent", border:"none", outline:"none",
                      color:"#000", fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4,
                      padding:"4px 0",
                    }}
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim()}
                    aria-label="Send"
                    title="send"
                    style={{
                      display:"grid", placeItems:"center", width:22, height:22, flex:"0 0 auto",
                      background:"none", border:"none", padding:0, lineHeight:0, marginBottom:2,
                      color: draft.trim() ? "#111" : "#b9b3a4",
                      cursor: draft.trim() ? "pointer" : "default",
                    }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth={2} strokeLinecap="square" strokeLinejoin="miter">
                      <line x1="12" y1="20" x2="12" y2="5"/>
                      <polyline points="5,12 12,5 19,12"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              // Only ask for a pick when there is something to pick. While the
              // list loads, fails or is empty, the list column already says so.
              <div style={{ display:"grid", placeItems:"center", fontFamily:"var(--mac-sans)", fontSize:13, color:"var(--ink-2)" }}>
                {sorted.length > 0 ? "pick a conversation." : null}
              </div>
            )}
          </div>
        </MacWindow>
      </div>
    </div>
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
          <Avatar id={person.userId || person.id} name={person.name} photo={person.photo} size={34}/>
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
  // Prefer the presenter mainText (`detail`) for "why surfaced"; the short
  // narrator chip is the fallback when detail is missing or identical.
  const note = take(person.detail) || take(person.pitchFromAgent);
  // An entry that resolves to no address is left out rather than drawn as a
  // link that goes nowhere. See api/socials.mjs for what fails to resolve.
  const socials = (person.socials || []).filter(s => s && socialHrefOf(s));

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
        // a handle can arrive as a full tracking URL; it is a chip, not a column
        maxWidth:"100%", minWidth:0, overflow:"hidden",
      }}>
      <SocialGlyph id={platform} size={13} color={ink}/>
      <span style={{
        minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
      }}>{socialHandleOf(social)}</span>
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
