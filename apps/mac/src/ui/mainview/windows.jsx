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
          <Avatar id={person.userId || person.id} name={person.name} photo={merged.photo} size={42} ring={isAccepted}/>
          <div style={{
            fontFamily:"var(--amiga-title)", fontSize:17, fontWeight:600, color:"#000",
            minWidth:0, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
          }}>{person.name}</div>
        </div>

        {/* body: their intro, then the presenter mainText (why surfaced), then
            where else to find them. */}
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
            <SummarySection label="why your agent surfaced them">
              <div style={{ display:"grid", gap:9 }}>
                {note.split(/\n{2,}/).map((para, i) => (
                  <div key={i}>{para.trim()}</div>
                ))}
              </div>
            </SummarySection>
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

function ChatWindow({ person, messages, draft, setDraft, onSend, onClose }) {
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
            <Avatar id={person.userId || person.id} name={person.name} photo={person.photo} size={34}/>
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

          {/* input */}
          <div style={{ borderTop:"1px solid #000", background:"#fff" }}>
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

// The send time rides alongside the bubble and only surfaces while the row is
// hovered (or focused, for keyboard), so a thread reads as text until you go
// looking for when something was said. It stays in flow at zero opacity rather
// than appearing on hover, so nothing shifts under the pointer.
function ChatTime({ at }) {
  const text = chatTime(at);
  if (!text) return null;
  return (
    <time className="mac-chat-time" dateTime={at} style={{
      fontFamily:"var(--mac-mono)", fontSize:9, color:"var(--ink-3)",
      letterSpacing:0.2, whiteSpace:"nowrap", flex:"0 0 auto",
    }}>{text}</time>
  );
}

function ChatBubble({ m }) {
  if (m.who === "index") {
    return (
      <div className="mac-chat-row" style={{
        display:"flex", alignItems:"baseline", justifyContent:"center", gap:6, padding:"0 8px",
      }}>
        <div style={{
          fontFamily:"var(--mac-mono)", fontSize:10, color:"var(--ink-2)",
          textAlign:"center", letterSpacing:0.3, lineHeight:1.5,
        }}>{m.text}</div>
        <ChatTime at={m.at}/>
      </div>
    );
  }
  const you = m.who === "you";
  // Baseline, not flex-end: the time then sits on the bubble's first text line
  // instead of sagging to the bottom of the box, so it reads as part of the
  // message rather than as something floating beside it.
  return (
    <div className="mac-chat-row" style={{
      display:"flex", alignItems:"baseline", gap:6,
      justifyContent: you ? "flex-end" : "flex-start",
    }}>
      {you && <ChatTime at={m.at}/>}
      <div style={{
        maxWidth:"82%",
        border:"1px solid #000",
        background: you ? "#000" : "#fff",
        color:      you ? "#fff" : "#000",
        padding:"8px 11px",
        fontFamily:"var(--mac-sans)", fontSize:13, lineHeight:1.4,
        boxShadow: you ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
      }}>{m.text}</div>
      {!you && <ChatTime at={m.at}/>}
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
