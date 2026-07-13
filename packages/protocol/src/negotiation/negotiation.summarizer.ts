/**
 * NegotiationSummarizer — pure LLM pass that compresses one DiscoveryNegotiation
 * (potentially several KB of turn reasoning + outcome reasoning) into a
 * DiscoveryNegotiationDigest (≤256 bytes structured). The digest is what the decision-
 * question generator consumes, replacing the raw negotiation blob.
 *
 * Why: a 10-candidate discovery turn used to produce a 60+ KB prompt for the
 * question generator, which stalled upstream Gemini/OpenRouter routes and
 * dropped the connection at ~3 minutes. Per-negotiation summarization caps
 * the question-generator input at a fixed, predictable size.
 */

import { HumanMessage, SystemMessage } from "@langchain/core/messages";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { DiscoveryNegotiationDigestSchema, type DiscoveryNegotiationDigest } from "../shared/schemas/negotiation-digest.schema.js";
import type { DiscoveryNegotiation } from "../opportunity/question.prompt.js";

const logger = protocolLogger("NegotiationSummarizer");

const SYSTEM_PROMPT = `You summarize one negotiation between a seeker's agent and a candidate's agent into a structured digest for downstream decision-question generation.

Output requirements (ALL fields — set optional fields to null when not applicable):
- counterpartyHint: copy the input field verbatim, truncated to ≤120 chars.
- indexContext: copy the input field verbatim, truncated to ≤120 chars.
- outcomeRole: "opportunity" when hasOpportunity=true, else "no-opportunity".
- outcomeReason: when outcomeRole="no-opportunity", set to "turn_cap" / "timeout" / "screened_out" if the input's reason matches; else "rejected" (if a turn explicitly rejected) or "stalled". When outcomeRole="opportunity", set to null. "screened_out" means the seeker's own agent chose not to reach out before any turn was exchanged — never describe it as the candidate declining or stalling.
- keyTake: ONE sentence (≤180 chars). Describe the decisive moment, the alignment gap, or the recurring signal — anything a question generator could use to formulate a clarifying question. NOT a generic outcome restatement. Anchor in a concrete detail from the negotiation if possible (a role mismatch, a missing input the candidate flagged, a pivot one party suggested).
- suggestedRoles: when both parties agreed on roles (the last turn's suggestedRoles), copy them from input. Otherwise set to null.

Do not include candidate identity, PII, names, or IDs. Reuse only counterpartyHint and indexContext as provided.`;

function buildUserPrompt(n: DiscoveryNegotiation): string {
  const turnLines = n.turns
    .map(
      (t, i) =>
        `[${i + 1}] action=${t.action} roles=${t.suggestedRoles.ownUser}↔${t.suggestedRoles.otherUser} reasoning=${t.reasoning}`,
    )
    .join("\n");
  return [
    `counterpartyHint: ${n.counterpartyHint}`,
    `indexContext: ${n.indexContext}`,
    `turns (${n.turns.length}):`,
    turnLines || "(no turns)",
    `outcome.hasOpportunity: ${n.outcome.hasOpportunity}`,
    `outcome.reasoning: ${n.outcome.reasoning}`,
    n.outcome.reason ? `outcome.reason: ${n.outcome.reason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export class NegotiationSummarizer {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("negotiationSummarizer", DiscoveryNegotiationDigestSchema, {
      name: "negotiation_digest",
    });
  }

  async summarize(
    negotiation: DiscoveryNegotiation,
    options?: { signal?: AbortSignal },
  ): Promise<DiscoveryNegotiationDigest | null> {
    const user = buildUserPrompt(negotiation);
    let raw: unknown;
    try {
      raw = await invokeWithAbortSignal(
        this.model,
        [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)],
        options?.signal,
      );
    } catch (err) {
      const aborted = options?.signal?.aborted ?? false;
      if (aborted) {
        logger.info("NegotiationSummarizer aborted by signal", {
          reason: options?.signal?.reason instanceof Error ? options.signal.reason.message : String(options?.signal?.reason ?? "unknown"),
        });
      } else {
        logger.warn("NegotiationSummarizer LLM call failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return null;
    }

    const parsed = DiscoveryNegotiationDigestSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("NegotiationSummarizer parse failed", { error: parsed.error.message });
      return null;
    }
    return parsed.data;
  }
}

/**
 * Deterministic fallback when the LLM summarizer fails or isn't wired. Produces
 * a minimal but valid digest so the question generator still has *some* signal.
 */
export function buildFallbackDigest(n: DiscoveryNegotiation): DiscoveryNegotiationDigest {
  const outcomeRole = n.outcome.hasOpportunity ? "opportunity" : "no-opportunity";
  const lastTurn = n.turns[n.turns.length - 1];
  const keyTakeRaw =
    n.outcome.reasoning && n.outcome.reasoning.trim().length > 0
      ? n.outcome.reasoning
      : `${n.turns.length} turn(s); ended ${outcomeRole}`;
  return {
    counterpartyHint: n.counterpartyHint.slice(0, 120),
    indexContext: n.indexContext.slice(0, 120),
    outcomeRole,
    outcomeReason:
      outcomeRole === "no-opportunity"
        ? ((n.outcome.reason ?? "stalled") as "turn_cap" | "timeout" | "stalled" | "screened_out")
        : null,
    keyTake: keyTakeRaw.slice(0, 180),
    suggestedRoles:
      lastTurn?.action === "accept" && lastTurn.suggestedRoles
        ? lastTurn.suggestedRoles
        : null,
  };
}
