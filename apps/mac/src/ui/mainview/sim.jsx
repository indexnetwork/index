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
