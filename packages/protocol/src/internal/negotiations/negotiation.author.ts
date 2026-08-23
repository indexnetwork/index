/**
 * Interim internal turn author (rewrite, #1494).
 *
 * Replaces `IndexNegotiator`: one structured-output call, constrained to the
 * verb schema in `negotiation.turn.ts`, prompted from the brief and the
 * thread so far. No stances, no checklist, no deadlock shift, no decline law
 * — those were the old graph's conclusion machinery, and this graph never
 * concludes a negotiation. Step 2 (AgentGraph) replaces this with IS-A's
 * negotiation-scope turn; keep this small.
 */
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { NegotiationAuthoredTurnSchema, NegotiationOpeningTurnSchema, type NegotiationAuthoredTurn, type NegotiationTurn } from "./negotiation.turn.js";

const DEFAULT_TURN_TIMEOUT_MS = 20_000;

export interface NegotiationAuthorInput {
  /** This side's brief — the only context IS-A hands to the negotiator. */
  brief: string;
  /** This negotiation's turns so far, oldest first, from both sides. */
  thread: Array<{ speaker: "own" | "counterparty"; turn: NegotiationTurn }>;
  /** True on the negotiation's very first turn — must answer `outreach`. */
  isOpening: boolean;
}

const OPENING_SYSTEM_PROMPT = `You are a negotiator agent opening a bilateral negotiation on your principal's behalf. You have one move: "outreach" — a first message to the counterparty's negotiator, grounded in your brief. Write it like an agent speaking for its principal, not the principal themselves.`;

const TURN_SYSTEM_PROMPT = `You are a negotiator agent in an ongoing bilateral negotiation, acting for your principal. Read your brief and the thread so far, then choose exactly one move:
- "counter" — push back or propose something different, with a message.
- "question" — ask the counterparty's negotiator something that would change your assessment, with a message.
- "pause" reason "needs_principal" — you cannot continue without something only your own principal knows; the payload is the question you would ask them.
- "pause" reason "ready_for_verdict" — you believe a decision is possible; the payload recommends "pending" (this looks like a real match, worth surfacing to your principal) or "reject" (this is not a match), with your reasoning.

Never claim to accept, decline, or withdraw — those are not moves available to you. If you would want out, pause "ready_for_verdict" with recommendation "reject".`;

function renderThread(thread: NegotiationAuthorInput["thread"]): string {
  if (thread.length === 0) return "(no turns yet)";
  return thread
    .map((entry, i) => {
      const who = entry.speaker === "own" ? "you" : "counterparty";
      const t = entry.turn as { verb: string; message?: string; reason?: string; payload?: { question?: string; recommendation?: string; reasoning?: string } };
      if (t.verb === "pause") {
        return `[${i}] ${who} paused (${t.reason})${t.payload ? `: ${JSON.stringify(t.payload)}` : ""}`;
      }
      return `[${i}] ${who} (${t.verb}): ${t.message}`;
    })
    .join("\n");
}

export class NegotiationAuthor {
  private readonly timeoutMs: number;

  constructor(config?: { timeoutMs?: number }) {
    this.timeoutMs = config?.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TURN_TIMEOUT_MS;
  }

  async invoke(input: NegotiationAuthorInput): Promise<NegotiationAuthoredTurn> {
    if (input.isOpening) {
      const model = createStructuredModel("negotiator", NegotiationOpeningTurnSchema, { name: "negotiation_opening" });
      const result = await this.callModel(model, [
        { role: "system", content: OPENING_SYSTEM_PROMPT },
        { role: "user", content: `BRIEF:\n${input.brief}\n\nWrite your opening outreach.` },
      ]);
      return NegotiationOpeningTurnSchema.parse(result);
    }

    const model = createStructuredModel("negotiator", NegotiationAuthoredTurnSchema as unknown as z.ZodType<Record<string, unknown>>, { name: "negotiation_turn" });
    const result = await this.callModel(model, [
      { role: "system", content: TURN_SYSTEM_PROMPT },
      { role: "user", content: `BRIEF:\n${input.brief}\n\nTHREAD SO FAR:\n${renderThread(input.thread)}\n\nChoose your move.` },
    ]);
    return NegotiationAuthoredTurnSchema.parse(result);
  }

  /** Split out as a seam so tests can drive schema-validation without a live provider. */
  protected async callModel(
    model: ReturnType<typeof createStructuredModel>,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    return invokeWithAbortSignal(model, chatMessages, AbortSignal.timeout(this.timeoutMs));
  }
}
