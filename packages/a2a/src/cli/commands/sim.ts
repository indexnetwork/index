import type { NegotiationDecision, NegotiationMessage, NegotiationTerms } from "../../core/types.ts";
import { buildNegotiator, parseActions, parseTerminal } from "../options.ts";
import { dim, green, printTurn, yellow } from "../ui.ts";

interface TranscriptEntry {
  side: 0 | 1;
  content: string;
  terms?: NegotiationTerms;
  offerId?: string;
}

/** Mirrors what `verifyAgreement()` does for A2A tasks, over the local
 * transcript: did the closing move bind to an offer that was actually
 * made, and do the two sides' closing terms match? */
function reportAgreement(transcript: TranscriptEntry[], closing: NegotiationDecision): void {
  if (closing.acceptsOfferId) {
    const accepted = transcript.find((entry) => entry.offerId === closing.acceptsOfferId);
    if (!accepted) {
      console.log(yellow(`conflict: accepted offer ${closing.acceptsOfferId}, which was never made`));
      return;
    }
    console.log(`${green("agreed")} ${JSON.stringify(accepted.terms)}`);
    return;
  }
  const previous = transcript.at(-2);
  if (closing.terms && previous?.terms) {
    const same = JSON.stringify(previous.terms) === JSON.stringify(closing.terms);
    console.log(
      same
        ? `${green("agreed")} ${JSON.stringify(closing.terms)}`
        : yellow(
            `conflict: closing moves name different terms — ${JSON.stringify(previous.terms)} vs ${JSON.stringify(closing.terms)}`,
          ),
    );
    return;
  }
  console.log(dim("unconfirmed: the closing move named no offer"));
}

export interface SimOptions {
  a: string;
  aObjective: string;
  b: string;
  bObjective: string;
  actions?: string;
  terminal?: string;
  model?: string;
  fallback?: string;
  turns?: string;
  terms?: string;
}

/**
 * Runs both sides of a negotiation locally, alternating `decide()` calls
 * between two Negotiators. No network protocol involved — this is the
 * quickest way to watch the decision engine itself behave.
 */
export async function sim(options: SimOptions): Promise<void> {
  const allowedActions = parseActions(options.actions);
  const isTerminal = parseTerminal(options.terminal);
  const maxTurns = Number(options.turns ?? "10");
  if (!Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new Error("--turns must be a positive integer");
  }

  const sides = [
    { name: options.a, objective: options.aObjective, negotiator: buildNegotiator(options.model, options.fallback) },
    { name: options.b, objective: options.bObjective, negotiator: buildNegotiator(options.model, options.fallback) },
  ] as const;

  console.log(dim(`actions: ${allowedActions.join(", ")} · max turns: ${maxTurns}\n`));

  // One shared transcript; each side sees it from its own perspective.
  const transcript: TranscriptEntry[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const side = (turn % 2) as 0 | 1;
    const current = sides[side];

    const history: NegotiationMessage[] = transcript.map((entry) => ({
      role: entry.side === side ? "outgoing" : "incoming",
      content: entry.content,
      terms: entry.terms,
      offerId: entry.offerId,
    }));

    const decision = await current.negotiator.decide(
      { party: { name: current.name, objective: current.objective }, history },
      { allowedActions, ...(options.terms ? { terms: options.terms } : {}) },
    );

    printTurn(current.name, side, decision.action, decision.message);
    if (decision.terms) {
      console.log(
        dim(
          `    terms ${JSON.stringify(decision.terms)}${decision.acceptsOfferId ? ` accepts:${decision.acceptsOfferId.slice(0, 8)}` : ""}`,
        ),
      );
    }
    transcript.push({
      side,
      content: decision.message,
      terms: decision.terms,
      offerId: decision.offerId,
    });

    if (isTerminal(decision.action)) {
      console.log(dim(`\nended after ${turn + 1} turns — ${current.name} chose "${decision.action}"`));
      if (options.terms) reportAgreement(transcript, decision);
      return;
    }
  }

  console.log(dim(`\nstopped at the ${maxTurns}-turn limit without a terminal action`));
}
