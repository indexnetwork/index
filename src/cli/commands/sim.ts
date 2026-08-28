import type { NegotiationMessage } from "../../core/types.ts";
import { buildNegotiator, parseActions, parseTerminal } from "../options.ts";
import { dim, printTurn } from "../ui.ts";

export interface SimOptions {
  a: string;
  aObjective: string;
  b: string;
  bObjective: string;
  actions?: string;
  terminal?: string;
  model?: string;
  turns?: string;
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
    { name: options.a, objective: options.aObjective, negotiator: buildNegotiator(options.model) },
    { name: options.b, objective: options.bObjective, negotiator: buildNegotiator(options.model) },
  ] as const;

  console.log(dim(`actions: ${allowedActions.join(", ")} · max turns: ${maxTurns}\n`));

  // One shared transcript; each side sees it from its own perspective.
  const transcript: { side: 0 | 1; content: string }[] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const side = (turn % 2) as 0 | 1;
    const current = sides[side];

    const history: NegotiationMessage[] = transcript.map((entry) => ({
      role: entry.side === side ? "outgoing" : "incoming",
      content: entry.content,
    }));

    const decision = await current.negotiator.decide(
      { party: { name: current.name, objective: current.objective }, history },
      { allowedActions },
    );

    printTurn(current.name, side, decision.action, decision.message);
    transcript.push({ side, content: decision.message });

    if (isTerminal(decision.action)) {
      console.log(dim(`\nended after ${turn + 1} turns — ${current.name} chose "${decision.action}"`));
      return;
    }
  }

  console.log(dim(`\nstopped at the ${maxTurns}-turn limit without a terminal action`));
}
