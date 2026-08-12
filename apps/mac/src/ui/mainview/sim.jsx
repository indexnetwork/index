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
