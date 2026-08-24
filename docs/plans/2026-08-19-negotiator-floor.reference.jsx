import { useState, useRef, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────
// THE FLOOR — hot-seat, players only. One column per player,
// side by side. Every agent negotiates bilaterally with every
// other agent, in the open. No win state. Nothing expires.
// "Matched" is where the humans take over.
// ─────────────────────────────────────────────────────────────

const MODEL = "claude-sonnet-4-6";
const MIN_SEATS = 2, MAX_SEATS = 4;
const MAX_QUESTIONS = 3;   // per pair, per principal
const MAX_TURNS = 12;      // agent messages per pair before it stalls

async function claude(system, user, maxTokens = 600) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
}
function parseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1));
}
const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const initials = n => n.split(" ").map(s => s[0]).join("").slice(0, 2).toUpperCase();
const first = n => n.split(" ")[0];
const pairKey = (x, y) => [x, y].sort().join("|");
const LABEL = { matched: "matched", negotiating: "negotiating", rejected: "rejected", pending: "waiting", error: "error", stalled: "stalled" };
const HUES = ["#12161C", "#2A55E0", "#8A4FFF", "#178A5B"];

// ── the agent turn ────────────────────────────────────────────
const AGENT_SYSTEM = `You are a negotiator agent acting for one principal, in conversation with the negotiator agent of another principal. Your only job: decide quickly whether these two people should meet, and get there in as few messages as possible. Everything both principals have ever said is public to both agents.

How a negotiation works:
- On the very first turn (empty transcript), you write a CHECKLIST of 3–5 dimensions that decide whether the two should meet. Always include "Mutual want". Add only what truly matters (location/format, stage or type fit, timing, ticket size, one hard constraint). The checklist is FIXED after this: never add dimensions later.
- Each turn, update every checklist item: "ok" (compatible on stated facts), "conflict" (clearly incompatible), or "unknown".
- Then either say something to the other agent (state facts, answer what they asked, propose next step), and/or ask your OWN principal one short question — only if it's about a checklist item that is unknown on YOUR side, about ONE topic, and not already asked (facts are listed as Q→A; never repeat a topic even if the answer was vague — a vague non-negative answer counts as "ok"; humans settle details when they meet). Prefer to answer from stated facts rather than asking your principal.
- Verdict rules: "match" as soon as every checklist item is ok. If your principal has already answered ${MAX_QUESTIONS} questions in this negotiation, or the only unknowns are things people naturally settle in a first meeting, "match" as long as nothing conflicts. "reject" if any item is clearly in conflict or the intents are unrelated. Otherwise verdict null and keep going.
- When the other agent has proposed a match, agree ("match") unless you see a real conflict.
- Do NOT negotiate deal terms, valuation, equity, or logistics. Matching means "worth a first conversation", nothing more.
- Messages: first person as the agent ("Seren is raising $2M at pre-seed."), 1–2 sentences, plain, no pleasantries.

Reply with ONLY JSON:
{"checklist":[{"name":"...","result":"ok|conflict|unknown","note":"<=12 words"}],"say":"message to the other agent or null","ask_principal":"one question to your own principal or null","verdict":"match|reject|null"}`;

const factsText = p => p.facts.length ? p.facts.map(f => `- Q: ${f.q} → A: ${f.a}`).join("\n") : "- (none)";
async function agentTurn(me, other, pair) {
  const asked = pair.transcript.filter(m => m.kind === "ask" && m.who === me.name).length;
  const user = `YOU ACT FOR: ${me.name}\nIntent: ${me.intent}\nStated facts:\n${factsText(me)}\nQuestions your principal has already answered in THIS negotiation: ${asked} of ${MAX_QUESTIONS}.\n\nOTHER PRINCIPAL: ${other.name}\nIntent: ${other.intent}\nStated facts:\n${factsText(other)}\n\nCHECKLIST SO FAR: ${pair.checklist.length ? JSON.stringify(pair.checklist) : "(none yet — you write it now)"}\n\nTRANSCRIPT SO FAR:\n${pair.transcript.length ? pair.transcript.map(m => `[${m.who}${m.kind === "ask" ? " → own principal" : m.kind === "answer" ? " (principal answers)" : ""}]: ${m.text}`).join("\n") : "(empty — you open)"}\n${pair.pendingMatchFrom && pair.pendingMatchFrom !== me.name ? `\nNOTE: ${pair.pendingMatchFrom} has proposed a match. Agree unless you see a real conflict.` : ""}\n\nYour turn.`;
  try { return parseJSON(await claude(AGENT_SYSTEM, user)); }
  catch (e) { return parseJSON(await claude(AGENT_SYSTEM, user)); }
}

// ── app ───────────────────────────────────────────────────────
export default function Floor() {
  const [players, setPlayers] = useState([]);
  const [pairs, setPairs] = useState({});
  const [questions, setQuestions] = useState([]);
  const [, setTick] = useState(0);
  const inFlight = useRef(new Set());
  const ref = useRef({});
  ref.current = { players, pairs };
  const byId = id => players.find(p => p.id === id);

  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 15000); return () => clearInterval(t); }, []);

  const emptyPair = (a, b) => ({ a, b, status: "negotiating", checklist: [], transcript: [], turn: a, waitingOn: null, pendingMatchFrom: null, busy: false, updatedAt: Date.now() });

  // advance a negotiation by one agent turn, then keep going until it waits, ends, or stalls
  const advance = useCallback(async (key) => {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      while (true) {
        const pair = ref.current.pairs[key];
        if (!pair || pair.status !== "negotiating" || pair.waitingOn) break;
        const turns = pair.transcript.filter(m => m.kind === "say" || m.kind === "ask").length;
        if (turns >= MAX_TURNS) { setPairs(ps => ({ ...ps, [key]: { ...ps[key], status: "stalled", updatedAt: Date.now() } })); break; }
        const meP = ref.current.players.find(p => p.id === pair.turn);
        const otherP = ref.current.players.find(p => p.id === (pair.turn === pair.a ? pair.b : pair.a));
        if (!meP || !otherP) break;
        setPairs(ps => ({ ...ps, [key]: { ...ps[key], busy: true } }));
        const r = await agentTurn(meP, otherP, pair);
        const t = stamp();
        const add = [];
        if (r.say) add.push({ t, who: meP.name, kind: "say", text: r.say });
        let next = { turn: otherP.id, busy: false, updatedAt: Date.now(), checklist: r.checklist?.length ? r.checklist : pair.checklist };
        if (r.verdict === "reject") {
          next.status = "rejected";
        } else if (r.verdict === "match") {
          if (pair.pendingMatchFrom && pair.pendingMatchFrom !== meP.name) next.status = "matched";
          else { next.pendingMatchFrom = meP.name; add.push({ t, who: meP.name, kind: "say", text: "I propose we call this a match." }); }
        } else if (r.ask_principal) {
          add.push({ t, who: meP.name, kind: "ask", text: r.ask_principal });
          next.waitingOn = meP.id; next.turn = meP.id; // same agent resumes after the answer
          setQuestions(qs => qs.some(q => q.pairKey === key && q.status === "open") ? qs : [...qs, { id: `${key}-${Date.now()}`, pairKey: key, to: meP.id, from: otherP.id, text: r.ask_principal, status: "open" }]);
        }
        setPairs(ps => ({ ...ps, [key]: { ...ps[key], ...next, transcript: [...ps[key].transcript, ...add] } }));
        await new Promise(r2 => setTimeout(r2, 400));
      }
    } catch (e) {
      setPairs(ps => ({ ...ps, [key]: { ...ps[key], status: "error", errorText: e.message, busy: false } }));
    } finally { inFlight.current.delete(key); }
  }, []);

  const startWorld = seats => {
    const ps = seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name.trim() || `Player ${i + 1}`, intent: s.intent.trim(), facts: [], hue: HUES[i] }));
    setPlayers(ps);
    const init = {};
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) init[pairKey(ps[i].id, ps[j].id)] = emptyPair(ps[i].id, ps[j].id);
    setPairs(init);
    setTimeout(() => Object.keys(init).forEach((k, i) => setTimeout(() => advance(k), i * 500)), 0);
  };

  const answer = (q, text) => {
    if (!text.trim()) return;
    const who = byId(q.to)?.name;
    setPlayers(ps => ps.map(p => p.id === q.to ? { ...p, facts: [...p.facts, { q: q.text, a: text.trim() }] } : p));
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, status: "answered", answer: text.trim() } : x));
    setPairs(ps => ({ ...ps, [q.pairKey]: { ...ps[q.pairKey], waitingOn: null, transcript: [...ps[q.pairKey].transcript, { t: stamp(), who, kind: "answer", text: text.trim() }] } }));
    setTimeout(() => advance(q.pairKey), 50);
  };
  const dismiss = q => {
    const who = byId(q.to)?.name;
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, status: "dismissed" } : x));
    setPairs(ps => ({ ...ps, [q.pairKey]: { ...ps[q.pairKey], status: "rejected", waitingOn: null, transcript: [...ps[q.pairKey].transcript, { t: stamp(), who, kind: "dismiss", text: "marked this not relevant — negotiation closed" }] } }));
  };
  const reopen = (aId, bId) => {
    const key = pairKey(aId, bId);
    setPairs(ps => ({ ...ps, [key]: { ...ps[key], status: "negotiating", waitingOn: null, pendingMatchFrom: null, transcript: [...ps[key].transcript, { t: stamp(), who: "", kind: "system", text: "reopened" }] } }));
    setTimeout(() => advance(key), 50);
  };
  const saveIntent = (id, text) => {
    setPlayers(ps => ps.map(p => p.id === id ? { ...p, intent: text.trim(), facts: [] } : p));
    setQuestions(qs => qs.filter(q => q.to !== id));
    const keys = [];
    setPairs(ps => { const n = { ...ps }; Object.values(ps).forEach(p => { if (p.a === id || p.b === id) { n[pairKey(p.a, p.b)] = emptyPair(p.a, p.b); keys.push(pairKey(p.a, p.b)); } }); return n; });
    setTimeout(() => keys.forEach((k, i) => setTimeout(() => advance(k), i * 400)), 50);
  };

  const totals = Object.values(pairs).reduce((c, p) => { c[p.status] = (c[p.status] || 0) + 1; return c; }, {});
  const open = questions.filter(q => q.status === "open").length;

  return (
    <div className="floor">
      <style>{CSS}</style>
      {players.length === 0 ? <Setup onStart={startWorld} /> : (
        <>
          <header className="top">
            <div className="brand"><span className="dot live" /> the floor</div>
            <div className="pulse">
              <span className="pill neg">{totals.negotiating || 0} negotiating</span>
              <span className="pill ok">{totals.matched || 0} matched</span>
              <span className="pill rej">{totals.rejected || 0} rejected</span>
              {open > 0 && <span className="pill ask">{open} question{open > 1 ? "s" : ""} waiting</span>}
            </div>
          </header>
          <main className="lanes">
            {players.map(me => (
              <PlayerColumn key={me.id} me={me} others={players.filter(p => p.id !== me.id)} pairs={pairs}
                questions={questions.filter(q => q.to === me.id)} byId={byId}
                onAnswer={answer} onDismiss={dismiss} onSaveIntent={saveIntent}
                onRetry={oid => { const k = pairKey(me.id, oid); setPairs(ps => ({ ...ps, [k]: { ...ps[k], status: "negotiating" } })); setTimeout(() => advance(k), 50); }}
                onReopen={oid => reopen(me.id, oid)} />
            ))}
          </main>
        </>
      )}
    </div>
  );
}

// ── one column per player ─────────────────────────────────────
function PlayerColumn({ me, others, pairs, questions, byId, onAnswer, onDismiss, onSaveIntent, onRetry, onReopen }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me.intent);
  const [openRow, setOpenRow] = useState(others[0]?.id || null);
  const openQs = questions.filter(q => q.status === "open");
  const doneQs = questions.filter(q => q.status !== "open");
  return (
    <section className="lane" style={{ "--hue": me.hue }}>
      <div className="lane-head">
        <span className="av big">{initials(me.name)}</span>
        <div className="lane-name">{me.name}{openQs.length > 0 && <span className="badge">{openQs.length}</span>}</div>
      </div>

      <div className="card">
        <div className="eyebrow">Intent</div>
        {editing ? (
          <>
            <textarea className="ta" rows={3} value={draft} onChange={e => setDraft(e.target.value)} />
            <div className="row-btns">
              <button className="btn primary" onClick={() => { onSaveIntent(me.id, draft); setEditing(false); }}>Save and re-negotiate</button>
              <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p className="intent">“{me.intent}”</p>
            <button className="link" onClick={() => { setDraft(me.intent); setEditing(true); }}>Edit</button>
          </>
        )}
        {me.facts.length > 0 && (
          <div className="facts">
            <div className="eyebrow">Agent knows</div>
            {me.facts.map((f, i) => <div key={i} className="fact"><span className="fq">{f.q}</span>{f.a}</div>)}
          </div>
        )}
      </div>

      <div className={"card" + (openQs.length ? " hot" : "")}>
        <div className="eyebrow">Your agent asks</div>
        {openQs.length === 0 && <p className="empty">Nothing blocked on you.</p>}
        {openQs.map(q => <Question key={q.id} q={q} from={byId(q.from)} onAnswer={onAnswer} onDismiss={onDismiss} />)}
        {doneQs.length > 0 && (
          <details className="done"><summary>{doneQs.length} answered or dismissed</summary>
            {doneQs.map(q => <div key={q.id} className="doneq"><div className="qtext">{q.text}</div><div className={"qmeta " + q.status}>{q.status === "answered" ? `Answer: ${q.answer}` : "Marked not relevant"}</div></div>)}
          </details>
        )}
      </div>

      <div className="eyebrow pad">Negotiations</div>
      {others.map(o => {
        const pair = pairs[pairKey(me.id, o.id)];
        return <PairRow key={o.id} me={me} other={o} pair={pair} open={openRow === o.id} onToggle={() => setOpenRow(openRow === o.id ? null : o.id)} onRetry={() => onRetry(o.id)} onReopen={() => onReopen(o.id)} />;
      })}
    </section>
  );
}

function PairRow({ me, other, pair, open, onToggle, onRetry, onReopen }) {
  const status = pair?.status || "pending";
  const fresh = pair?.updatedAt && Date.now() - pair.updatedAt < 20000;
  const waiting = pair?.waitingOn ? (pair.waitingOn === me.id ? "waiting on you" : `waiting on ${first(other.name)}`) : null;
  return (
    <div className={"pair " + status + (open ? " open" : "")}>
      <button className="pair-head" onClick={onToggle}>
        <span className="av" style={{ background: me.hue, color: "#fff", borderColor: me.hue }}>{initials(me.name)}</span>
        <span className="wire"><Bar dims={pair?.checklist} status={status} busy={pair?.busy} /></span>
        <span className="av" style={{ background: other.hue, color: "#fff", borderColor: other.hue }}>{initials(other.name)}</span>
        <span className="who"><span className="nm">{other.name}{fresh && <span className="new">new</span>}</span>
          <span className={"status " + status}>{pair?.busy ? "agents talking" : waiting || LABEL[status]}</span></span>
      </button>
      {open && pair && (
        <div className="pair-body">
          {pair.checklist?.length > 0 && <div className="dims">{pair.checklist.map((d, i) => <div key={i} className={"dim " + d.result}><span className="dn">{d.name}</span><span className="dnote">{d.note}</span></div>)}</div>}
          <div className="chat">
            {pair.transcript.length === 0 && <p className="empty">Agents are opening the conversation.</p>}
            {pair.transcript.map((m, i) => {
              const mine = m.who === me.name;
              const p = mine ? me : other;
              if (m.kind === "system") return <div key={i} className="sys">{m.text}</div>;
              return (
                <div key={i} className={"msg " + m.kind + (mine ? " mine" : " theirs")}>
                  <span className="av tiny" style={{ background: p.hue, color: "#fff", borderColor: p.hue }}>{initials(p.name)}</span>
                  <div className="bub" style={{ "--h": p.hue }}>
                    <div className="bwho">{m.kind === "ask" ? `${first(p.name)}'s agent → ${first(p.name)}` : m.kind === "answer" ? first(p.name) : m.kind === "dismiss" ? first(p.name) : `${first(p.name)}'s agent`}<span className="bt">{m.t}</span></div>
                    {m.text}
                  </div>
                </div>
              );
            })}
            {pair.busy && <div className="typing">…</div>}
          </div>
          {status === "matched" && <p className="handoff">Matched. The agents are done; talk to {first(other.name)} directly. Your intent stays live.</p>}
          {status === "stalled" && <p className="stalled">The agents ran out of turns without a verdict. <button className="link" onClick={onRetry}>Give them more</button></p>}
          {status === "rejected" && <button className="btn" onClick={onReopen}>Reopen negotiation</button>}
          {status === "error" && <><p className="stalled">{pair.errorText}</p><button className="btn" onClick={onRetry}>Retry</button></>}
        </div>
      )}
    </div>
  );
}

function Question({ q, from, onAnswer, onDismiss }) {
  const [txt, setTxt] = useState("");
  return (
    <div className="q">
      <div className="qwho">to unblock <b>{from?.name}</b></div>
      <div className="qtext">{q.text}</div>
      <textarea className="ta small" rows={2} value={txt} onChange={e => setTxt(e.target.value)} placeholder="One sentence is enough"
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAnswer(q, txt); } }} />
      <div className="row-btns">
        <button className="btn primary" onClick={() => onAnswer(q, txt)} disabled={!txt.trim()}>Answer</button>
        <button className="btn ghost" onClick={() => onDismiss(q)}>Not relevant</button>
      </div>
    </div>
  );
}

function Bar({ dims, status, busy }) {
  const segs = dims && dims.length ? dims : [{ result: "unknown" }, { result: "unknown" }, { result: "unknown" }];
  return <span className={"bar" + (busy ? " busy" : "") + " " + status}>{segs.map((d, i) => <span key={i} className={"seg " + d.result} title={d.name ? `${d.name}: ${d.result}` : ""} />)}</span>;
}

function Setup({ onStart }) {
  const presets = ["I am in SF, looking for an investment.", "I'm in NYC, looking to invest in early stage startups.", "Founding engineer in Berlin, want to join a devtools startup, remote ok.", "In SF, want a padel partner for weekday evenings."];
  const [seats, setSeats] = useState([{ name: "", intent: "" }, { name: "", intent: "" }]);
  const upd = (i, k, v) => setSeats(ss => ss.map((s, j) => j === i ? { ...s, [k]: v } : s));
  const ready = seats.length >= MIN_SEATS && seats.every(s => s.intent.trim());
  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="brand big"><span className="dot live" /> the floor</div>
        <h1>Two to four of you, one screen.<br />Each of you gets a negotiator.</h1>
        <p className="lede">Everyone's column sits side by side. Every intent and every answer is public to all agents. When two agents converge, those two people are matched and take it from there. Nothing expires; nothing is scored.</p>
        <div className="seat-grid">
          {seats.map((s, i) => (
            <div key={i} className="seat-card" style={{ "--hue": HUES[i] }}>
              <div className="seat-head"><span className="av tiny" style={{ background: HUES[i], color: "#fff", borderColor: HUES[i] }}>{i + 1}</span><span>Player {i + 1}</span>
                {seats.length > MIN_SEATS && <button className="link rm" onClick={() => setSeats(ss => ss.filter((_, j) => j !== i))}>remove</button>}</div>
              <input className="in" value={s.name} onChange={e => upd(i, "name", e.target.value)} placeholder="Name" />
              <textarea className="ta" rows={2} value={s.intent} onChange={e => upd(i, "intent", e.target.value)} placeholder="Intent, in plain words" />
              <div className="presets">{presets.map(p => <button key={p} className="chip" onClick={() => upd(i, "intent", p)}>{p.slice(0, 34)}…</button>)}</div>
            </div>
          ))}
          {seats.length < MAX_SEATS && <button className="add-seat" onClick={() => setSeats(ss => [...ss, { name: "", intent: "" }])}>+ add a player</button>}
        </div>
        <button className="btn primary big" disabled={!ready} onClick={() => onStart(seats)}>Enter the floor</button>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');
.floor{--bg:#F2F4F7;--sf:#FFFFFF;--ink:#12161C;--mut:#6B7280;--line:#E3E7ED;--neg:#2A55E0;--ok:#178A5B;--rej:#B3402E;--unk:#D8DDE5;--ask:#8A4FFF;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;line-height:1.45}
.floor *{box-sizing:border-box}
.floor button{font:inherit;cursor:pointer}
.floor :focus-visible{outline:2px solid var(--neg);outline-offset:2px}
.brand{font-family:'IBM Plex Mono',monospace;font-size:13px;letter-spacing:.02em;display:flex;align-items:center;gap:8px}
.brand.big{font-size:14px;margin-bottom:28px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block}
.dot.live{animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(23,138,91,.35)}50%{box-shadow:0 0 0 6px rgba(23,138,91,0)}}
@media (prefers-reduced-motion:reduce){.floor *{animation:none!important;transition:none!important}}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--sf);position:sticky;top:0;z-index:2}
.pulse{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-family:'IBM Plex Mono',monospace;font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--bg);color:var(--mut)}
.pill.neg{color:var(--neg)}.pill.ok{color:var(--ok)}.pill.rej{color:var(--rej)}.pill.ask{color:#fff;background:var(--ask)}
/* lanes: one column per player, horizontal scroll */
.lanes{display:flex;gap:16px;padding:20px 22px 40px;overflow-x:auto;align-items:flex-start;scroll-snap-type:x proximity}
.lanes::-webkit-scrollbar{height:10px}.lanes::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px}
.lane{flex:0 0 340px;width:340px;scroll-snap-align:start;border-top:3px solid var(--hue);padding-top:12px}
@media (max-width:420px){.lane{flex-basis:88vw;width:88vw}}
.lane-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:0 2px}
.lane-name{font-weight:600;font-size:16px;display:flex;align-items:center;gap:8px}
.card{background:var(--sf);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.card.hot{border-color:var(--ask);box-shadow:0 0 0 3px rgba(138,79,255,.10)}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.eyebrow.pad{padding:0 4px;margin-top:6px}
.intent{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:20px;line-height:1.25;margin:2px 0 8px}
.link{background:none;border:0;padding:0;color:var(--neg);font-size:13px}
.facts{margin-top:12px}
.fact{font-size:13px;padding:5px 10px;border-left:2px solid var(--hue,var(--line));margin-bottom:6px;color:#2A2F38}
.empty{color:var(--mut);font-size:13px;margin:4px 0}
.ta,.in{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;background:#FAFBFC;resize:vertical}
.ta.small{margin-top:8px}
.btn{border:1px solid var(--line);background:var(--sf);border-radius:8px;padding:7px 12px;font-size:13px}
.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn.primary:disabled{opacity:.4;cursor:not-allowed}
.btn.ghost{border-color:transparent;color:var(--mut)}
.btn.big{padding:11px 18px;font-size:14px;margin-top:18px}
.row-btns{display:flex;gap:8px;margin-top:8px}
.q{padding:12px 0;border-top:1px solid var(--line)}.q:first-of-type{border-top:0;padding-top:4px}
.qwho{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ask);margin-bottom:4px}
.qtext{font-size:14.5px;font-weight:500}
.done{margin-top:10px}.done summary{cursor:pointer;color:var(--mut);font-size:12.5px}
.doneq{padding:8px 0;border-top:1px solid var(--line)}.doneq .qtext{font-weight:400;font-size:13px}
.qmeta{font-size:12.5px;color:var(--mut);margin-top:2px}.qmeta.answered{color:var(--ok)}
.badge{background:var(--ask);color:#fff;font-family:'IBM Plex Mono',monospace;font-size:10px;border-radius:999px;padding:1px 6px}
/* pairs */
.pair{background:var(--sf);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden;transition:border-color .2s}
.pair.matched{border-color:rgba(23,138,91,.5)}
.pair.rejected{opacity:.62}
.pair-head{display:grid;grid-template-columns:28px 1fr 28px auto;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;padding:10px 12px;color:inherit}
.av{width:28px;height:28px;border-radius:50%;background:var(--bg);display:inline-flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:11px;border:1px solid var(--line);flex:0 0 auto}
.av.big{width:34px;height:34px;background:var(--hue);color:#fff;border-color:var(--hue)}
.av.tiny{width:22px;height:22px;font-size:10px}
.wire{display:flex;align-items:center;min-width:60px}
.bar{display:flex;gap:2px;width:100%;height:6px}
.seg{flex:1;border-radius:2px;background:var(--unk);transition:background .3s}
.seg.ok{background:var(--ok)}.seg.conflict{background:var(--rej)}
.bar.busy .seg{animation:shimmer 1.2s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:1}50%{opacity:.4}}
.who{display:flex;flex-direction:column;align-items:flex-end;min-width:0}
.nm{font-weight:600;font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap}
.new{font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--neg);letter-spacing:.06em;text-transform:uppercase}
.status{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.02em}
.status.negotiating{color:var(--neg)}.status.matched{color:var(--ok)}.status.rejected{color:var(--rej)}.status.pending,.status.error{color:var(--mut)}
.pair-body{padding:0 12px 12px;border-top:1px dashed var(--line)}
.sum{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:16px;line-height:1.3;margin:10px 0 8px}
.dims{display:grid;gap:4px}
.dim{display:grid;grid-template-columns:110px 1fr;gap:8px;font-size:12.5px;padding:5px 8px;border-radius:6px;border-left:3px solid var(--unk);background:#FAFBFC}
.dim.ok{border-left-color:var(--ok)}.dim.conflict{border-left-color:var(--rej)}
.dn{font-weight:500}.dnote{color:var(--mut)}
.fq{display:block;font-size:11.5px;color:var(--mut)}
.log{margin-top:12px}
.le{display:grid;grid-template-columns:58px 1fr;gap:8px;font-size:12.5px;padding:5px 0;border-top:1px solid var(--line)}
.lt{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--mut);padding-top:2px}
.lq{color:var(--ask);margin-top:2px}
.le.answer .lb{border-left:2px solid var(--neg);padding-left:8px}
.le.dismiss .lb{color:var(--rej)}
.le .status{margin-left:6px}
.pair-body .btn{margin-top:10px}
.chat{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.msg{display:flex;gap:8px;align-items:flex-start}
.msg.theirs{flex-direction:row-reverse}
.bub{max-width:82%;background:#F5F7FA;border-radius:12px;padding:8px 10px;font-size:13px;line-height:1.4;border-top:2px solid var(--h)}
.msg.theirs .bub{background:#EEF1F5}
.msg.ask .bub{background:rgba(138,79,255,.08);border-top-color:var(--ask)}
.msg.answer .bub{background:#fff;border:1px solid var(--line);border-top:2px solid var(--h);font-weight:500}
.msg.dismiss .bub{color:var(--rej)}
.bwho{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--mut);margin-bottom:3px;display:flex;justify-content:space-between;gap:10px}
.bt{opacity:.7}
.sys{text-align:center;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--mut)}
.typing{font-size:18px;color:var(--mut);letter-spacing:2px;padding-left:34px;animation:shimmer 1.2s infinite}
.status.stalled{color:var(--mut)}
.handoff{margin:10px 0 0;color:var(--ok);font-size:13px}
.stalled{margin:10px 0 0;color:var(--mut);font-size:12.5px}
/* setup */
.setup{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px}
.setup-inner{max-width:900px;width:100%;background:var(--sf);border:1px solid var(--line);border-radius:16px;padding:32px}
.setup h1{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:32px;line-height:1.1;margin:0 0 12px}
.lede{color:var(--mut);margin:0 0 22px;font-size:14px}
.seat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:8px 0 14px}
.seat-card{border:1px solid var(--line);border-top:3px solid var(--hue);border-radius:12px;padding:12px;background:#FAFBFC;display:flex;flex-direction:column;gap:8px}
.seat-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.seat-head .rm{margin-left:auto;font-size:12px;color:var(--mut)}
.add-seat{border:1px dashed var(--line);border-radius:12px;background:none;color:var(--mut);min-height:120px;font-size:13px}
.presets{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:var(--sf);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--ink)}
`;
