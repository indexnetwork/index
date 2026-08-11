/* =================== RIGHT, MATCH FEED =================== */
// Below this the radar column no longer fits a name, a blurb and the gadgets on
// one line, so the cards stack their actions instead.
const MATCH_CARD_ROW_MIN = 340;

/* ---------- Counterparty discovery (design handoff: "eye + checklist", 2a) ----
   Shown in the radar while the agent runs discovery, before anyone lands in
   awaiting-you / negotiating / etc.

   The handoff's step timings (1.5s/2.5s/3s/2s/2.5s) are its demo loop, and it
   says so: in production the steps are driven by real progress instead. So a
   step is done when the thing it describes has actually happened, and the first
   one that has not is the active one. A timer would tick to "complete" while
   the agent was still out, which is the one thing this screen must not do.

   Every counter is a number the app actually has. */
const DISCOVERY_STEPS = [
  // Reach is known once the networks list resolves. No detail, per the spec.
  { key:"reach",   label:"mapping reach",
    done: (m) => m.networks != null,
    detail: () => "" },
  { key:"scan",    label:"scanning counterparties",
    done: (m) => m.found != null,
    detail: (m) => (m.found == null ? "" : `${fmtCount(m.found)} found`) },
  { key:"overlap", label:"evaluating overlap",
    done: (m) => m.scored != null,
    detail: (m) => (m.scored == null ? "" : `${fmtCount(m.scored)} scored`) },
  { key:"rank",    label:"ranking counterparties",
    done: (m) => m.scored != null,
    detail: (m, isDone) => (isDone ? "ranked" : "ranking") },
  // Holds as the active step while the radar is empty, which is the honest
  // reading of that state: nobody has advanced yet.
  { key:"short",   label:"shortlisting",
    done: (m) => m.advanced > 0,
    detail: (m) => (m.advanced == null ? "" : `${fmtCount(m.advanced)} advanced`) },
];

const SPINNER_FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏".split("");
const SPINNER_MS = 100;

// Ink, muted detail, pending: the handoff's tokens.
const DISCOVERY_INK = "#111";
const DISCOVERY_MUTED = "#8a8375";
const DISCOVERY_PENDING = "#c2baa8";

function fmtCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/* How long a step is shown working before the next one can start.

   The data does not arrive one step at a time: the radar answers in one go, so
   found/scored/ranked all become true in the same tick and the list jumped
   straight to the fourth row. This walks the checklist forward one row at a
   time so each step is legible as its own step. It is pacing, not fiction: the
   walk can never pass what the data supports, so a step is only ever checked
   once the thing it describes has actually happened. */
const STEP_DWELL_MS = 700;

/* How many steps the data supports, counted in order. Sequential on purpose: a
   later step cannot be complete while an earlier one is not, which is what put
   a checkmark on "ranking counterparties" while "mapping reach" was still
   spinning. */
function reachedStepCount(metrics) {
  let reached = 0;
  for (const step of DISCOVERY_STEPS) {
    if (!step.done(metrics)) break;
    reached += 1;
  }
  return reached;
}

/* The number of steps shown complete, walking toward `reached` one per dwell.
   Clamped to `reached` on every render, so if the metrics reset (a different
   signal) the checklist walks again from the top rather than staying lit. */
function useWalkedProgress(reached) {
  const [walked, setWalked] = useState(0);
  useEffect(() => {
    if (walked >= reached) return;
    const t = setTimeout(() => setWalked((n) => n + 1), STEP_DWELL_MS);
    return () => clearTimeout(t);
  }, [walked, reached]);
  return Math.min(walked, reached);
}

// Advances only while something is actually spinning, so a settled radar is not
// re-rendering ten times a second in the background.
function useSpinnerFrame(active) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setI((n) => (n + 1) % SPINNER_FRAMES.length), SPINNER_MS);
    return () => clearInterval(t);
  }, [active]);
  return SPINNER_FRAMES[i % SPINNER_FRAMES.length];
}

/* A pulsing mark for work happening right now on the other side of the wire.
   The animation is defined in styles/amiga.css so it can be reused.

   Not named LiveDot: every JSX file is concatenated into one shared scope by
   assemble.py, so a second LiveDot here (loaded 18th) silently replaced the
   primitive in tokens.jsx (loaded 1st) and every existing caller started
   drawing this pill with no label instead of their blinking dot. Names in this
   tree are effectively global; keep new ones distinct. */
function LiveTag({ label }) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:4, flex:"0 0 auto",
      fontFamily:"var(--mac-mono)", fontSize:9, letterSpacing:"0.08em",
      color:"var(--ink-2)", border:"1px solid var(--ink-4)", padding:"0 4px",
    }}>
      <span className="live-pulse" style={{
        width:5, height:5, borderRadius:"50%", background:"#1FA463",
        display:"block", flex:"0 0 auto",
      }}/>
      {label}
    </span>
  );
}

function DiscoveryStages({ metrics = {}, art }) {
  // Everything before `walked` is done, `walked` itself is the row being worked
  // on, everything after is still pending. One index, so the three states can
  // never disagree the way independent per-step checks did.
  const walked = useWalkedProgress(reachedStepCount(metrics));
  const activeIndex = walked < DISCOVERY_STEPS.length ? walked : -1;
  const spinner = useSpinnerFrame(activeIndex !== -1);

  return (
    <div style={{
      padding:"16px 30px 30px", display:"flex", flexDirection:"column",
      alignItems:"center",
    }}>
      {/* 180x180 with object-fit:cover, per the handoff: the gif carries a lot
          of whitespace padding and is cropped rather than scaled down. */}
      {art && (
        <img src={art} alt="searching" style={{
          width:180, height:180, objectFit:"cover", flexShrink:0,
          display:"block", mixBlendMode:"multiply",
        }}/>
      )}
      <div style={{
        fontFamily:"var(--mac-mono)", fontSize:15, fontWeight:700,
        letterSpacing:"0.04em", color:DISCOVERY_INK, margin:"0 0 22px",
      }}>hold on, looking for your people</div>

      <div role="status" aria-live="polite" style={{
        display:"flex", flexDirection:"column", gap:10, width:"100%",
        fontFamily:"var(--mac-mono)", fontSize:13,
      }}>
        {DISCOVERY_STEPS.map((step, i) => {
          const isDone = i < walked;
          const isActive = i === activeIndex;
          const mark = isDone ? "✓" : (isActive ? spinner : "·");
          // Detail is for active and done rows only; a pending row is bare.
          const detail = (isDone || isActive) ? step.detail(metrics, isDone) : "";
          return (
            <div key={step.key} style={{
              display:"flex", gap:12, alignItems:"baseline",
              color: isDone ? DISCOVERY_INK : (isActive ? DISCOVERY_INK : DISCOVERY_PENDING),
              fontWeight: isActive ? 600 : 400,
            }}>
              <span style={{
                width:16, display:"inline-block", textAlign:"center", flex:"0 0 auto",
              }}>{mark}</span>
              <span style={{ flex:1, minWidth:0 }}>{step.label}</span>
              <span style={{
                color:DISCOVERY_MUTED, fontWeight:400, flex:"0 0 auto",
                whiteSpace:"nowrap",
              }}>{detail}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchFeed({ tab, setTab, people, field, funnelStages, pipelineMode, onOpenRoom, onAccept, onPass, onSummary, onProfile, unread = {}, chatIds = [], profile = {}, discovering = false, discoveryMetrics = {} }) {
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
        {discovering && (
          <DiscoveryStages
            metrics={discoveryMetrics}
            art={(window.IndexAssets || {}).loading2}
          />
        )}
        {!discovering && peopleForTab.map(p => (
          <MatchCard key={p.id} person={p} onOpenRoom={onOpenRoom} onAccept={onAccept} onPass={onPass} onSummary={onSummary} onProfile={onProfile}
            hasChat={chatIds.includes(p.id)} unreadCount={unread[p.id] || 0} compact={compact}/>
        ))}
        {!discovering && peopleForTab.length === 0 && (
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
        <Avatar id={person.userId || person.id} name={person.name} photo={person.photo} size={36} ring={accepted}/>
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
          {/* The agents are genuinely mid-exchange on these, and the radar
              repolls faster while any of them are open, so the row can say so
              rather than looking like a settled list. */}
          {negotiating && <LiveTag label="live"/>}
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

