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
              <Avatar id={c.userId || c.id} name={c.name} photo={c.person ? c.person.photo : null} size={32}/>
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
