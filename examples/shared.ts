/**
 * Shared helpers for the examples/ scripts. These use a scripted
 * Negotiator (no real OpenRouter calls) so every example runs instantly,
 * deterministically, and without an API key — the point of these scripts
 * is to show the A2A *mechanics*, not to demo live LLM negotiation (see
 * dev/a2a-demo.ts for that).
 */
import { Negotiator } from "../src/index.ts";
import type { AgentCard } from "../src/a2a/index.ts";
import type { NegotiationDecision, NegotiationState } from "../src/index.ts";

/** A Negotiator whose decide() returns a scripted sequence of decisions
 * instead of calling OpenRouter. Cycles the last decision once exhausted. */
export function scriptedNegotiator(decisions: NegotiationDecision[]) {
  const negotiator = new Negotiator({ apiKey: "example-key" });
  let call = 0;
  (negotiator as unknown as { decide: unknown }).decide = async (_state: NegotiationState) => {
    const decision = decisions[call] ?? decisions.at(-1);
    call++;
    if (!decision) throw new Error("no scripted decision left");
    return decision;
  };
  return negotiator;
}

export function agentCard(name: string, url = ""): AgentCard {
  return {
    name,
    url,
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate" }],
  };
}

export function logTurn(speaker: string, decision: NegotiationDecision): void {
  console.log(`[${speaker}] (${decision.action}) ${decision.message}`);
}
