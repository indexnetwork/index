import { useCallback, useEffect, useMemo, useState } from "react";

import { answerAsSeat, fetchIntentCycle, fetchNegotiationDetail, mapFloorStatus, principalQuestion, startFloorRun, type FloorRunResult, type FloorRunSeat, type FloorSeatInput } from "@/lib/floor-lab-api";
import type { IntentCycleNegotiationDetail, IntentCycleSnapshot } from "@/services/conversation";

const HUES = ["#12161C", "#2A55E0"];
const PRESETS = [
  "I am in SF, looking for an investment.",
  "I'm in NYC, looking to invest in early stage startups.",
];

const stamp = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const initials = (n: string) => n.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase();
const first = (n: string) => n.split(" ")[0];

type SeatView = FloorRunSeat & {
  intentText: string;
  cycle: IntentCycleSnapshot | null;
  detail: IntentCycleNegotiationDetail | null;
  error: string | null;
};

export default function FloorLabPage() {
  const [run, setRun] = useState<FloorRunResult | null>(null);
  const [seats, setSeats] = useState<SeatView[]>([]);
  const [drafts, setDrafts] = useState<FloorSeatInput[]>([
    { name: "", intent: "", profile: "", location: "" },
    { name: "", intent: "", profile: "", location: "" },
  ]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const refreshSeat = useCallback(async (seat: SeatView): Promise<SeatView> => {
    try {
      const cycle = await fetchIntentCycle(seat.jwt, seat.intentId);
      const negotiation = cycle.negotiations[0];
      const detail = negotiation
        ? await fetchNegotiationDetail(seat.jwt, seat.intentId, negotiation.taskId)
        : null;
      return { ...seat, cycle, detail, error: null };
    } catch (err) {
      return { ...seat, error: err instanceof Error ? err.message : String(err) };
    }
  }, []);

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    const tick = async () => {
      setSeats((current) => {
        void Promise.all(current.map((seat) => refreshSeat(seat))).then((next) => {
          if (!cancelled) setSeats(next);
        });
        return current;
      });
    };
    void tick();
    const id = window.setInterval(() => { void tick(); }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [run?.runId, refreshSeat]);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const payload = drafts.map((seat) => ({
        name: seat.name,
        intent: seat.intent,
        profile: seat.profile?.trim() || undefined,
        location: seat.location?.trim() || undefined,
      }));
      const result = await startFloorRun(payload);
      setRun(result);
      setSeats(result.seats.map((seat, index) => ({
        ...seat,
        intentText: drafts[index]?.intent.trim() ?? "",
        cycle: null,
        detail: null,
        error: null,
      })));
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const totals = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const seat of seats) {
      const negotiation = seat.cycle?.negotiations[0];
      if (!negotiation) {
        counts.waiting = (counts.waiting || 0) + 1;
        continue;
      }
      const status = mapFloorStatus(negotiation.opportunityStatus, negotiation.state, negotiation.pause);
      counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
  }, [seats]);

  const openQuestions = seats.filter((seat) => principalQuestion(seat.detail)).length;

  if (!run) {
    return (
      <div className="floor">
        <style>{CSS}</style>
        <div className="setup">
          <div className="setup-inner">
            <div className="brand big"><span className="dot live" /> the floor · index</div>
            <h1>Two people, one screen.<br />Real users, real agents.</h1>
            <p className="lede">Each run registers two new users and a private network. You play both seats while Index discovery, PersonalAgent kickoff, and NegotiationGraph run for real.</p>
            <div className="seat-grid">
              {drafts.map((seat, index) => (
                <div key={index} className="seat-card" style={{ "--hue": HUES[index] } as React.CSSProperties}>
                  <div className="seat-head">
                    <span className="av tiny" style={{ background: HUES[index], color: "#fff", borderColor: HUES[index] }}>{index + 1}</span>
                    <span>Player {index + 1}</span>
                  </div>
                  <input className="in" value={seat.name} onChange={(e) => setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, name: e.target.value } : row))} placeholder="Name" />
                  <input className="in" value={seat.location ?? ""} onChange={(e) => setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, location: e.target.value } : row))} placeholder="Location (optional)" />
                  <textarea className="ta" rows={2} value={seat.profile ?? ""} onChange={(e) => setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, profile: e.target.value } : row))} placeholder="Who they are (optional)" />
                  <textarea className="ta" rows={2} value={seat.intent} onChange={(e) => setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, intent: e.target.value } : row))} placeholder="Intent, in plain words" />
                  <div className="presets">{PRESETS.map((preset) => (
                    <button key={preset} type="button" className="chip" onClick={() => setDrafts((rows) => rows.map((row, i) => i === index ? { ...row, intent: preset } : row))}>{preset.slice(0, 34)}…</button>
                  ))}</div>
                </div>
              ))}
            </div>
            {startError && <p className="start-error">{startError}</p>}
            <button className="btn primary big" disabled={starting || !drafts.every((seat) => seat.intent.trim())} onClick={() => void start()}>
              {starting ? "Provisioning…" : "Enter the floor"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="floor">
      <style>{CSS}</style>
      <header className="top">
        <div className="brand"><span className="dot live" /> the floor · run {run.runId}</div>
        <div className="pulse">
          <span className="pill neg">{totals.negotiating || 0} negotiating</span>
          <span className="pill ok">{totals.matched || 0} matched</span>
          <span className="pill rej">{totals.rejected || 0} rejected</span>
          {openQuestions > 0 && <span className="pill ask">{openQuestions} question{openQuestions > 1 ? "s" : ""}</span>}
        </div>
      </header>
      <main className="lanes">
        {seats.map((me, index) => (
          <PlayerColumn
            key={me.userId}
            me={me}
            other={seats[index === 0 ? 1 : 0]!}
            hue={HUES[index]!}
            onAnswer={async (text) => {
              await answerAsSeat(me.jwt, me.intentId, text);
              setSeats((rows) => rows.map((row) => row.userId === me.userId ? { ...row } : row));
              const refreshed = await refreshSeat(me);
              setSeats((rows) => rows.map((row) => row.userId === me.userId ? refreshed : row));
            }}
          />
        ))}
      </main>
    </div>
  );
}

function PlayerColumn({
  me,
  other,
  hue,
  onAnswer,
}: {
  me: SeatView;
  other: SeatView;
  hue: string;
  onAnswer: (text: string) => Promise<void>;
}) {
  const negotiation = me.cycle?.negotiations[0] ?? null;
  const status = negotiation
    ? mapFloorStatus(negotiation.opportunityStatus, negotiation.state, negotiation.pause)
    : "waiting";
  const question = principalQuestion(me.detail);
  const waitingOnYou = negotiation?.pause?.reason === "needs_principal" && negotiation.pause.by === "yours";
  const waitingOnThem = negotiation?.pause?.reason === "needs_principal" && negotiation.pause.by === "theirs";

  return (
    <section className="lane" style={{ "--hue": hue } as React.CSSProperties}>
      <div className="lane-head">
        <span className="av big">{initials(me.name)}</span>
        <div className="lane-name">{me.name}{question && <span className="badge">1</span>}</div>
      </div>

      <div className="card">
        <div className="eyebrow">Intent</div>
        <p className="intent">“{me.intentText}”</p>
      </div>

      <div className={"card" + (question ? " hot" : "")}>
        <div className="eyebrow">Your agent asks</div>
        {!question && <p className="empty">Nothing blocked on you.</p>}
        {question && <QuestionCard question={question} onAnswer={onAnswer} counterpart={other.name} />}
      </div>

      <div className="eyebrow pad">Negotiation with {first(other.name)}</div>
      <div className={"pair " + status}>
        <div className="pair-head-static">
          <span className="av" style={{ background: hue, color: "#fff", borderColor: hue }}>{initials(me.name)}</span>
          <span className="wire"><Bar status={status} busy={negotiation?.state === "working"} /></span>
          <span className="av" style={{ background: HUES[1], color: "#fff", borderColor: HUES[1] }}>{initials(other.name)}</span>
          <span className="who">
            <span className="nm">{other.name}</span>
            <span className={"status " + status}>
              {negotiation?.state === "working"
                ? "agents talking"
                : waitingOnYou
                  ? "waiting on you"
                  : waitingOnThem
                    ? `waiting on ${first(other.name)}`
                    : status}
            </span>
          </span>
        </div>
        <div className="pair-body">
          {me.error && <p className="stalled">{me.error}</p>}
          {!negotiation && !me.error && <p className="empty">HyDE and discovery are starting…</p>}
          {me.detail && me.detail.transcript.length > 0 && (
            <div className="chat">
              {me.detail.transcript.map((turn) => (
                <div key={turn.id} className={"msg " + (turn.actor === "yours" ? "mine" : "theirs")}>
                  <span className="av tiny" style={{ background: turn.actor === "yours" ? hue : HUES[1], color: "#fff" }}>{turn.actor === "yours" ? initials(me.name) : initials(other.name)}</span>
                  <div className="bub" style={{ "--h": turn.actor === "yours" ? hue : HUES[1] } as React.CSSProperties}>
                    <div className="bwho">{turn.actor === "yours" ? `${first(me.name)}'s agent` : `${first(other.name)}'s agent`}<span className="bt">{stamp()}</span></div>
                    {turn.text}
                  </div>
                </div>
              ))}
            </div>
          )}
          {status === "matched" && <p className="handoff">Matched (pending). Agents are done; talk to {first(other.name)} directly.</p>}
        </div>
      </div>
    </section>
  );
}

function QuestionCard({
  question,
  counterpart,
  onAnswer,
}: {
  question: string;
  counterpart: string;
  onAnswer: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="q">
      <div className="qwho">unblocks negotiation with <b>{first(counterpart)}</b></div>
      <div className="qtext">{question}</div>
      <textarea className="ta small" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="One sentence is enough" />
      <div className="row-btns">
        <button className="btn primary" disabled={!text.trim() || busy} onClick={() => {
          setBusy(true);
          void onAnswer(text.trim()).finally(() => setBusy(false));
        }}>Answer</button>
      </div>
    </div>
  );
}

function Bar({ status, busy }: { status: string; busy?: boolean }) {
  return <span className={"bar" + (busy ? " busy" : "") + " " + status}>{[0, 1, 2].map((i) => <span key={i} className="seg unknown" />)}</span>;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Fraunces:ital,opsz,wght@0,9..144,300;1,9..144,300&display=swap');
.floor{--bg:#F2F4F7;--sf:#FFFFFF;--ink:#12161C;--mut:#6B7280;--line:#E3E7ED;--neg:#2A55E0;--ok:#178A5B;--rej:#B3402E;--unk:#D8DDE5;--ask:#8A4FFF;min-height:100vh;background:var(--bg);color:var(--ink);font-family:'IBM Plex Sans',system-ui,sans-serif;font-size:14px;line-height:1.45}
.floor *{box-sizing:border-box}
.floor button{font:inherit;cursor:pointer}
.brand{font-family:'IBM Plex Mono',monospace;font-size:13px;display:flex;align-items:center;gap:8px}
.brand.big{font-size:14px;margin-bottom:28px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ok);display:inline-block}
.dot.live{animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(23,138,91,.35)}50%{box-shadow:0 0 0 6px rgba(23,138,91,0)}}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 22px;border-bottom:1px solid var(--line);background:var(--sf);position:sticky;top:0;z-index:2}
.pulse{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-family:'IBM Plex Mono',monospace;font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--bg);color:var(--mut)}
.pill.neg{color:var(--neg)}.pill.ok{color:var(--ok)}.pill.rej{color:var(--rej)}.pill.ask{color:#fff;background:var(--ask)}
.lanes{display:flex;gap:16px;padding:20px 22px 40px;overflow-x:auto;align-items:flex-start}
.lane{flex:0 0 340px;width:340px;border-top:3px solid var(--hue);padding-top:12px}
.lane-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.lane-name{font-weight:600;font-size:16px;display:flex;align-items:center;gap:8px}
.card{background:var(--sf);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px}
.card.hot{border-color:var(--ask);box-shadow:0 0 0 3px rgba(138,79,255,.10)}
.eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-bottom:8px}
.eyebrow.pad{padding:0 4px;margin-top:6px}
.intent{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:20px;line-height:1.25;margin:2px 0 8px}
.empty{color:var(--mut);font-size:13px;margin:4px 0}
.ta,.in{width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit;background:#FAFBFC;resize:vertical}
.ta.small{margin-top:8px}
.btn{border:1px solid var(--line);background:var(--sf);border-radius:8px;padding:7px 12px;font-size:13px}
.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn.primary:disabled{opacity:.4;cursor:not-allowed}
.btn.big{padding:11px 18px;font-size:14px;margin-top:18px}
.row-btns{display:flex;gap:8px;margin-top:8px}
.q{padding:12px 0}.qwho{font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ask);margin-bottom:4px}
.qtext{font-size:14.5px;font-weight:500}
.badge{background:var(--ask);color:#fff;font-family:'IBM Plex Mono',monospace;font-size:10px;border-radius:999px;padding:1px 6px}
.pair{background:var(--sf);border:1px solid var(--line);border-radius:12px;margin-bottom:8px;overflow:hidden}
.pair.matched{border-color:rgba(23,138,91,.5)}.pair.rejected{opacity:.62}
.pair-head-static{display:grid;grid-template-columns:28px 1fr 28px auto;align-items:center;gap:8px;padding:10px 12px}
.av{width:28px;height:28px;border-radius:50%;background:var(--bg);display:inline-flex;align-items:center;justify-content:center;font-family:'IBM Plex Mono',monospace;font-size:11px;border:1px solid var(--line)}
.av.big{width:34px;height:34px;background:var(--hue);color:#fff;border-color:var(--hue)}
.av.tiny{width:22px;height:22px;font-size:10px}
.wire{display:flex;align-items:center;min-width:60px}
.bar{display:flex;gap:2px;width:100%;height:6px}
.seg{flex:1;border-radius:2px;background:var(--unk)}
.bar.busy .seg{animation:shimmer 1.2s ease-in-out infinite}
@keyframes shimmer{0%,100%{opacity:1}50%{opacity:.4}}
.who{display:flex;flex-direction:column;align-items:flex-end}
.nm{font-weight:600;font-size:13px}
.status{font-family:'IBM Plex Mono',monospace;font-size:11px}
.status.negotiating{color:var(--neg)}.status.matched{color:var(--ok)}.status.rejected{color:var(--rej)}.status.waiting{color:var(--mut)}
.pair-body{padding:0 12px 12px;border-top:1px dashed var(--line)}
.chat{margin-top:12px;display:flex;flex-direction:column;gap:8px}
.msg{display:flex;gap:8px;align-items:flex-start}
.msg.theirs{flex-direction:row-reverse}
.bub{max-width:82%;background:#F5F7FA;border-radius:12px;padding:8px 10px;font-size:13px;border-top:2px solid var(--h)}
.msg.theirs .bub{background:#EEF1F5}
.bwho{font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--mut);margin-bottom:3px;display:flex;justify-content:space-between}
.handoff{margin:10px 0 0;color:var(--ok);font-size:13px}
.stalled{margin:10px 0 0;color:var(--mut);font-size:12.5px}
.setup{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px 20px}
.setup-inner{max-width:900px;width:100%;background:var(--sf);border:1px solid var(--line);border-radius:16px;padding:32px}
.setup h1{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:32px;line-height:1.1;margin:0 0 12px}
.lede{color:var(--mut);margin:0 0 22px;font-size:14px}
.seat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:8px 0 14px}
.seat-card{border:1px solid var(--line);border-top:3px solid var(--hue);border-radius:12px;padding:12px;background:#FAFBFC;display:flex;flex-direction:column;gap:8px}
.seat-head{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px}
.presets{display:flex;flex-wrap:wrap;gap:6px}
.chip{border:1px solid var(--line);background:var(--sf);border-radius:999px;padding:4px 10px;font-size:12px}
.start-error{color:var(--rej);font-size:13px;margin-top:8px}
`;

export const Component = FloorLabPage;
