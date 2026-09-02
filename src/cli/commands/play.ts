import { createInterface } from "node:readline/promises";
import type { NegotiationMessage } from "../../core/types.ts";
import { buildNegotiator, parseActions, parseTerminal } from "../options.ts";
import { bold, cyan, dim, printTurn } from "../ui.ts";

export interface PlayOptions {
  agent: string;
  objective: string;
  me?: string;
  actions?: string;
  terminal?: string;
  model?: string;
  fallback?: string;
}

/**
 * Human-in-the-loop mode: you type your side of the negotiation, an
 * LLM-backed Negotiator plays the other. Useful for getting a feel for how
 * an objective actually shapes an agent's behavior before wiring it up.
 */
export async function play(options: PlayOptions): Promise<void> {
  const allowedActions = parseActions(options.actions);
  const isTerminal = parseTerminal(options.terminal);
  const negotiator = buildNegotiator(options.model, options.fallback);
  const myName = options.me ?? "You";

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(
    dim(`negotiating against ${bold(options.agent)}${dim(` — ${options.objective}`)}`),
  );
  console.log(dim(`actions: ${allowedActions.join(", ")} · type /quit to stop\n`));

  // Kept from the agent's perspective: what you send is "incoming" to it.
  const history: NegotiationMessage[] = [];

  try {
    while (true) {
      const input = (await rl.question(`${bold(cyan(myName))} > `)).trim();
      if (!input) continue;
      if (input === "/quit" || input === "/exit") {
        console.log(dim("\nended by you"));
        return;
      }

      history.push({ role: "incoming", content: input });

      const decision = await negotiator.decide(
        { party: { name: options.agent, objective: options.objective }, history },
        { allowedActions },
      );

      printTurn(options.agent, 1, decision.action, decision.message);
      history.push({ role: "outgoing", content: decision.message });

      if (isTerminal(decision.action)) {
        console.log(dim(`\nended — ${options.agent} chose "${decision.action}"`));
        return;
      }
    }
  } finally {
    rl.close();
  }
}
