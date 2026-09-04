/**
 * Shared helpers for the examples/ scripts. These make real OpenRouter
 * calls via Negotiator — set OPENROUTER_API_KEY before running them. Each
 * negotiation loop is capped at MAX_TURNS since a live LLM isn't guaranteed
 * to reach a terminal action on its own.
 */
import { messageToDecision } from "../src/a2a/index.ts";
import type { A2ATask, AgentCard } from "../src/a2a/index.ts";
import type { NegotiationDecision } from "../src/index.ts";

export const MAX_TURNS = 8;

/** The vocabulary the README uses. `accept` and `decline` end the task
 * under the library's default terminal actions; `propose` and `refine`
 * keep it open. */
export const ACTIONS = ["propose", "refine", "accept", "decline"] as const;
export type Action = (typeof ACTIONS)[number];

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
  if (decision.terms) {
    const accepts = decision.acceptsOfferId ? ` accepts:${decision.acceptsOfferId.slice(0, 8)}` : "";
    console.log(`    terms ${JSON.stringify(decision.terms)}${accepts}`);
  }
}

/** Logs the counterparty's latest move on a task — the last message in its
 * history, which is their reply to whatever this side just sent. */
export function logReply(speaker: string, task: A2ATask): void {
  const last = task.history.at(-1);
  const decision = last ? messageToDecision(last) : null;
  if (decision) logTurn(speaker, decision);
}
