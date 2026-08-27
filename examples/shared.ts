/**
 * Shared helpers for the examples/ scripts. These make real OpenRouter
 * calls via Negotiator — set OPENROUTER_API_KEY before running them. Each
 * negotiation loop is capped at MAX_TURNS since a live LLM isn't guaranteed
 * to reach a terminal action on its own.
 */
import type { AgentCard } from "../src/a2a/index.ts";
import type { NegotiationDecision } from "../src/index.ts";

export const MAX_TURNS = 8;

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
