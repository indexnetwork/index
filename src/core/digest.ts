import type { NegotiationDecision } from "@indexnetwork/a2a/negotiator";
import type { NegotiationEvent } from "./types.ts";

/**
 * What the agent loop hears back from a batch of negotiations: one line
 * per negotiation, grouped by what it needs. This is the whole of what
 * crosses from the pump to the loop, so it carries exactly what the loop
 * can act on — a verdict, a question, an offer to compare — and nothing
 * that only the negotiator needed.
 */
export function digest(events: NegotiationEvent[]): string {
  if (!events.length) return "No negotiations.";

  const groups: [heading: string, kind: NegotiationEvent["kind"]][] = [
    ["Settled", "settled"],
    ["Waiting on you", "asking"],
    ["Out of turns", "budget"],
    ["Failed", "failed"],
    ["Skipped", "skipped"],
  ];

  const sections: string[] = [];
  for (const [heading, kind] of groups) {
    const members = events.filter((event) => event.kind === kind);
    if (!members.length) continue;
    const hint =
      kind === "asking"
        ? " — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to"
        : "";
    sections.push(`${heading} (${members.length})${hint}:`, ...members.map(line));
  }
  return sections.join("\n");
}

function line(event: NegotiationEvent): string {
  const who = event.peer ? ` with ${event.peer}` : "";
  // The URL is what the caller named this counterparty as; the id and the
  // party name are what came back. Without it a reader has to remember
  // which target produced which line, and a model reporting on ten of
  // them will eventually attribute the wrong deal to the wrong party.
  const where = event.url ? ` (${event.url})` : "";
  const head = `- ${event.id}${who}${where} — `;
  switch (event.kind) {
    case "settled": {
      if (!event.settlement) return `${head}ended (${event.state})`;
      const { outcome, terms, reason } = event.settlement;
      const detail = terms ? JSON.stringify(terms) : reason;
      // `unanswered` is not terminal — the Task itself is still open, only
      // this side closed. It reads like every other line in this section,
      // so without a hint here a model reads it as done and moves on,
      // leaving a still-open exchange it never comes back to. A new
      // negotiate_open would be refused (the counterparty is a rival of
      // itself); negotiate_turn on this same id is the way back in.
      const hint =
        outcome === "unanswered"
          ? " — the exchange is still open; continue this id with negotiate_turn, do not open a new one"
          : "";
      return `${head}${outcome}${detail ? `: ${detail}` : ""}${hint}`;
    }
    case "asking":
      return `${head}asks: ${JSON.stringify(event.question)}${lastMove(event.last)}`;
    case "budget":
      return `${head}${event.turns} turns, still open${lastMove(event.last)}`;
    case "failed":
      return `${head}${event.error}`;
    case "skipped":
      return `${head}${event.reason}`;
  }
}

function lastMove(decision: NegotiationDecision | null): string {
  if (!decision) return "";
  const terms = decision.terms ? ` ${JSON.stringify(decision.terms)}` : "";
  return ` (their last move: ${JSON.stringify(decision.message)}${terms})`;
}
