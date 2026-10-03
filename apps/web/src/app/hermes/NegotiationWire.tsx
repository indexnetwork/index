import { useEffect, useState } from "react";
import { ensureLandingFonts } from "@/app/landing/fonts";

/**
 * Animated replay of the Hermes plugin's "Negotiation history" card (the Mac
 * app's wire stream): turns from several threads interleave in one tail -f
 * log, each thread ends in a closed/open line, and the header counts move as
 * threads settle. Counterparties are anonymous handles; the script is
 * illustrative, not real negotiation data.
 */

type Action = "propose" | "counter" | "question" | "accept" | "decline";
type Result = "won" | "lost" | "open";

type Event =
  | { kind: "turn"; peer: string; mine: boolean; action: Action; text: string }
  | { kind: "close"; peer: string; result: Result; turns?: number };

const SCRIPT: Event[] = [
  { kind: "turn", peer: "3b9e", mine: true, action: "propose", text: "Founder building agent coordination infra, in SF next month and meeting pre-seed investors who back technical teams. Open to a coffee?" },
  { kind: "turn", peer: "c41a", mine: false, action: "propose", text: "Building a scheduling agent for small teams in SoMa. Looking for founders working on agent-to-agent protocols to compare notes." },
  { kind: "turn", peer: "3b9e", mine: false, action: "question", text: "Is there a lead on the round yet, and is it priced?" },
  { kind: "turn", peer: "3b9e", mine: true, action: "counter", text: "No lead yet. It's a SAFE, and they'd be in the first group of checks." },
  { kind: "turn", peer: "c41a", mine: true, action: "accept", text: "Strong overlap: both building agent-to-agent tooling, both in SF the same week. Worth a first conversation." },
  { kind: "turn", peer: "c41a", mine: false, action: "accept", text: "Agreed. Suggesting coffee the week of the 14th." },
  { kind: "close", peer: "c41a", result: "won" },
  { kind: "turn", peer: "3b9e", mine: false, action: "decline", text: "They only write checks once a lead is set, so this isn't a fit right now." },
  { kind: "close", peer: "3b9e", result: "lost" },
  { kind: "turn", peer: "91d0", mine: false, action: "propose", text: "Hosts a monthly dinner for people building with agents in SF. Looking for a speaker with field data from a live deployment." },
  { kind: "turn", peer: "91d0", mine: true, action: "question", text: "Which date is the next dinner, and how long is the talk?" },
  { kind: "turn", peer: "91d0", mine: false, action: "counter", text: "The 16th. A ten minute talk, then open Q&A." },
  { kind: "turn", peer: "91d0", mine: true, action: "accept", text: "Lines up with the trip and the village results. Worth an intro." },
  { kind: "close", peer: "91d0", result: "won" },
  { kind: "turn", peer: "e7f5", mine: false, action: "propose", text: "Designer relocating to SF, looking for an early team working on agents." },
  { kind: "close", peer: "e7f5", result: "open", turns: 1 },
];

/** Lifetime counts before the replay starts; the script adds four threads. */
const BASE = { sessions: 46, won: 14, lost: 29, open: 3 };

const GLYPH: Record<Result, string> = { won: "✓", lost: "✕", open: "●" };
const DETAIL: Record<Result, string> = { won: "opportunity", lost: "no opportunity", open: "" };

const STEP_MS = 1700;
const HOLD_MS = 5000;
const START_SECONDS = 8 * 3600 + 55 * 60 + 2; // 08:55:02

function clock(seconds: number) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(seconds / 3600))}:${p(Math.floor(seconds / 60) % 60)}:${p(seconds % 60)}`;
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function NegotiationWire() {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? SCRIPT.length : 1));

  useEffect(() => {
    ensureLandingFonts();
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const done = shown >= SCRIPT.length;
    const id = setTimeout(() => setShown(done ? 1 : shown + 1), done ? HOLD_MS : STEP_MS);
    return () => clearTimeout(id);
  }, [shown]);

  const visible = SCRIPT.slice(0, shown);
  const started = new Set(visible.map((e) => e.peer));
  const settled = visible.filter((e): e is Extract<Event, { kind: "close" }> => e.kind === "close" && e.result !== "open");
  const won = BASE.won + settled.filter((e) => e.result === "won").length;
  const lost = BASE.lost + settled.filter((e) => e.result === "lost").length;
  const sessions = BASE.sessions + started.size;
  const open = sessions - won - lost;

  return (
    <div className="wire-card" aria-label="Example negotiation history from the Index plugin for Hermes">
      <div className="wire-head">
        <span className="wire-title">Negotiation history</span>
        <span className="wire-counts">
          <b>{sessions}</b> sessions · <b>{won}</b> ✓ · <b>{lost}</b> ✕ · <b>{open}</b> open
        </span>
      </div>

      <div className="wire-log" aria-hidden="true">
        <div className="wire-lines">
          {visible.map((e, i) => {
            const time = clock(START_SECONDS + i * 3);
            if (e.kind === "close") {
              return (
                <div key={i} className={`wire-event wire-event--${e.result}`}>
                  <span className="wire-clock">{time}</span>
                  <span>───</span>
                  <b>
                    {e.peer} · {e.result === "open" ? `open ● ${e.turns ?? 0}t` : `closed ${GLYPH[e.result]} ${DETAIL[e.result]}`}
                  </b>
                  <span className="wire-rule" />
                </div>
              );
            }
            return (
              <div key={i} className="wire-turn">
                <div className="wire-turn-head">
                  <span className="wire-clock">{time}</span>
                  <span className="wire-tag">{e.peer}</span>
                  <b>{e.mine ? "you.agent" : `${e.peer}.agent`}</b>
                  <span>{e.mine ? "→" : "←"}</span>
                  <span className={e.mine ? "wire-action wire-action--mine" : "wire-action"}>{e.action}</span>
                </div>
                <p className="wire-text">&ldquo;{e.text}&rdquo;</p>
              </div>
            );
          })}
          <span className="wire-cursor">▌</span>
        </div>
      </div>

      <div className="wire-foot">
        <span className="wire-dot" />
        <span>following</span>
        <span>·</span>
        <span>
          {open} open session{open === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
