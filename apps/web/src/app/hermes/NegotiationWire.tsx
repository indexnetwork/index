import { useEffect, useState } from "react";
import { ensureLandingFonts } from "@/app/landing/fonts";

/**
 * Animated replay of the Hermes plugin's "Agent log" card (the Mac
 * app's wire stream): turns from several threads interleave in one tail -f
 * log, each thread ends in an opportunity or in-talks line, and the header
 * counts move as threads settle. A decline pauses a thread in talks; it is
 * never counted as closed. Counterparties are named people; the script is
 * illustrative, not real negotiation data.
 */

type Action = "propose" | "counter" | "question" | "accept" | "decline";
type Result = "opportunity" | "in_talks";

type Event =
  | { kind: "turn"; peer: string; mine: boolean; action: Action; text: string }
  | { kind: "close"; peer: string; result: Result; move?: string; turns?: number };

const SCRIPT: Event[] = [
  { kind: "turn", peer: "Alex", mine: true, action: "propose", text: "Founder building agent coordination infra, in SF next month and meeting pre-seed investors who back technical teams. Open to a coffee?" },
  { kind: "turn", peer: "Mary", mine: false, action: "propose", text: "Building a scheduling agent for small teams in SoMa. Looking for founders working on agent-to-agent protocols to compare notes." },
  { kind: "turn", peer: "Alex", mine: false, action: "question", text: "Is there a lead on the round yet, and is it priced?" },
  { kind: "turn", peer: "Alex", mine: true, action: "counter", text: "No lead yet. It's a SAFE, and they'd be in the first group of checks." },
  { kind: "turn", peer: "Mary", mine: true, action: "accept", text: "Strong overlap: both building agent-to-agent tooling, both in SF the same week. Worth a first conversation." },
  { kind: "turn", peer: "Mary", mine: false, action: "accept", text: "Agreed. Suggesting coffee the week of the 14th." },
  { kind: "close", peer: "Mary", result: "opportunity" },
  { kind: "turn", peer: "Alex", mine: false, action: "decline", text: "They only write checks once a lead is set, so this isn't a fit right now." },
  { kind: "close", peer: "Alex", result: "in_talks", move: "paused", turns: 4 },
  { kind: "turn", peer: "Priya", mine: false, action: "propose", text: "Hosts a monthly dinner for people building with agents in SF. Looking for a speaker with field data from a live deployment." },
  { kind: "turn", peer: "Priya", mine: true, action: "question", text: "Which date is the next dinner, and how long is the talk?" },
  { kind: "turn", peer: "Priya", mine: false, action: "counter", text: "The 16th. A ten minute talk, then open Q&A." },
  { kind: "turn", peer: "Priya", mine: true, action: "accept", text: "Lines up with the trip and the village results. Worth an intro." },
  { kind: "close", peer: "Priya", result: "opportunity" },
  { kind: "turn", peer: "Theo", mine: false, action: "propose", text: "Designer relocating to SF, looking for an early team working on agents." },
  { kind: "close", peer: "Theo", result: "in_talks", move: "your move", turns: 1 },
];

/** Lifetime counts before the replay starts; the script adds four threads. */
const BASE = { sessions: 46, opportunity: 14, closed: 6 };

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
  const agreed = visible.filter((e) => e.kind === "close" && e.result === "opportunity").length;
  const opportunity = BASE.opportunity + agreed;
  const closed = BASE.closed;
  const sessions = BASE.sessions + started.size;
  const inTalks = sessions - opportunity - closed;

  return (
    <div className="wire-card" aria-label="Example agent log from the Index plugin for Hermes">
      <div className="wire-head">
        <span className="wire-title">Agent log</span>
        <span className="wire-counts">
          <b>{sessions}</b> sessions · <b>{opportunity}</b> ✓ · <b>{inTalks}</b> in talks · <b>{closed}</b> ✕
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
                    {e.peer} · {e.result === "in_talks" ? `in talks ● ${e.move} · ${e.turns ?? 0}t` : "✓ opportunity"}
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
                  <b>{e.mine ? "your agent" : `${e.peer}’s agent`}</b>
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
          {inTalks} in talks
        </span>
      </div>
    </div>
  );
}
