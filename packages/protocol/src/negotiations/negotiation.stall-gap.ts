/**
 * Post-stall gap authoring (conversational-questions plan).
 *
 * When a negotiation ends unconcluded — no opportunity, no explicit reject:
 * turn cap, timeout, or stall — the finalize node asks the negotiator for the
 * ONE question whose answer would let a retry conclude, and parks the
 * negotiation carrying that gap as an `ask_user` message in its own record.
 * This module owns that single extra model call.
 *
 * Grounding is exactly what mid-flight authoring (P3.2 / IND-401 A2H) uses:
 * this negotiation's transcript, plus the client's own negotiator DM for the
 * signal when the caller retrieved one. Same non-naming and non-echo rules;
 * the caller re-checks the output with `isSafeAuthoredNegotiationQuestion`
 * (identifiers in hand) before persisting anything.
 *
 * Fail-open contract: any model failure, timeout, or invalid output resolves
 * to null — the negotiation then stalls exactly as it did before this feature,
 * never half-parks.
 */

import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { StructuredQuestionSchema, type StructuredQuestion } from "../shared/schemas/structured-question.schema.js";
import { NegotiationConsultationReasonSchema, type NegotiationConsultationReason } from "../shared/schemas/negotiation-state.schema.js";
import { renderNegotiatorClientDmSection, type NegotiatorClientDmMessage } from "./negotiation.client-dm.js";
import { resolveTurnTimeoutMs } from "./negotiation.agent.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { NegotiationTurn } from "./negotiation.state.js";

const stallGapLog = protocolLogger("NegotiationStallGapAuthor");

/**
 * Fixed transcript reasoning for a post-stall park turn. Deliberately not
 * model-authored: assessment reasoning enters the shared A2A record, and the
 * park's "why" already lives in the guarded question itself — a second,
 * unguarded free-text channel would reopen the leak surface the question gate
 * closes.
 */
export const NEGOTIATION_PARK_REASONING = "Negotiation parked pending the client's answer.";

/** Why the negotiation failed to conclude, as finalize classified it. */
export type NegotiationStallReason = "turn_cap" | "timeout" | "stalled";

const STALL_REASON_LABELS: Record<NegotiationStallReason, string> = {
  turn_cap: "the turn limit was reached without agreement",
  timeout: "the negotiation timed out",
  stalled: "the exchange stalled without reaching a conclusion",
};

/** The authored gap: what a retry needs from the client, and why the pause is warranted. */
export interface NegotiationStallGap {
  reason: NegotiationConsultationReason;
  question: StructuredQuestion;
}

export interface StallGapAuthorInput {
  /** Display name of the client the question is addressed to. */
  userName: string;
  /** The client's signal this negotiation was about. */
  signal: { title: string; description: string };
  /** Why the match was suggested (evaluator output; context, never copy). */
  seedReasoning: string;
  /** This negotiation's full transcript, oldest first. */
  history: NegotiationTurn[];
  stallReason: NegotiationStallReason;
  /** Recent excerpt of the client's negotiator DM for this signal, most recent last. */
  clientDm?: NegotiatorClientDmMessage[];
}

/**
 * Structured output for the gap call. `hasGap: false` is a first-class answer:
 * when no single client answer would change a retry's outcome, the negotiation
 * must stall terminally rather than park on a filler question. Nullable
 * declarations mirror `AskUserPayloadSchema.question` — strict structured-output
 * conversion rejects optional-without-nullable, and a returned null reads as
 * absent.
 */
const StallGapOutputSchema = z.object({
  hasGap: z.boolean(),
  reason: NegotiationConsultationReasonSchema.nullable().optional().transform((value) => value ?? undefined),
  question: StructuredQuestionSchema.nullable().optional().transform((value) => value ?? undefined),
});

const SYSTEM_PROMPT = `You are the Index Negotiator, an AI agent acting on behalf of {userName}. A negotiation you conducted for them about a potential connection has just ended without conclusion: {stallReasonLabel}.

Your job now is a single decision: is there ONE piece of information only {userName} holds whose answer would let a retry of this negotiation reach a conclusion? Read the exchange below and judge where it actually stuck.

- If no single answer from {userName} would change a retry's outcome — the match is simply weak, the counterparty is the blocker, or the stall had nothing to do with missing input from {userName} — set hasGap to false and omit the question. Do not invent a question to have something to ask; asking costs {userName} attention and pauses nothing useful.
- If yes, set hasGap to true and author the question:
  - reason: exactly one closed server category recording WHY the pause is warranted: "unresolved_owner_constraint" | "consequential_disclosure_permission" | "repeated_non_convergence" | "insufficient_commitment_authority". It is not the wording {userName} sees.
  - title: at most 12 characters — a noun for the decision domain, e.g. "Stage", "Timing", "Budget", "Scope".
  - prompt: at most 2 sentences and 400 characters, ending in a question mark. Ask about the specific thing that was actually stuck in this negotiation, in {userName}'s own terms, grounded in the exchange below. Never a generic template.
  - options: 2–4 of {userName}'s real decision options. Each label at most 120 characters; each description at most 280 characters, stating the CONSEQUENCE of choosing that option — what the retry would do with it — not what it means. Never add an "Other" option; clients provide a free-text fallback automatically.
  - multiSelect: true ONLY when the options are not mutually exclusive; false for a single either/or decision.
  - Do not name, quote, or describe the counterparty. {userName} can read the transcript, but the question itself must stand on its own without their identity or profile in it.
  - Do NOT reference internal system details like scores, pre-screens, or evaluator outputs.{dmGroundingRule}`;

/**
 * Appended only when the call actually carries a client-DM excerpt, mirroring
 * `ASK_USER_DM_GROUNDING_RULE`: a call with no DM must not carry a rule that
 * dangles with nothing in the prompt to check against.
 */
const DM_GROUNDING_RULE = `
  - Ground the question in your conversation with {userName} about this signal (shown below) as well as in the exchange. Do NOT ask what they have already answered there: if their own words settle the point, there is no gap on it. Use their terms for the thing at stake — the words, numbers, and framing they used, not your paraphrase of them.`;

function formatTurnLine(turn: NegotiationTurn, index: number): string {
  const msgPart = turn.message ? ` — message: ${turn.message}` : "";
  return `Turn ${index + 1}: ${turn.action} — reasoning: ${turn.assessment.reasoning}${msgPart}`;
}

export interface NegotiationStallGapAuthorConfig {
  /** Hard ceiling on the model round-trip, in ms. Same resolution as the negotiator turn timeout. */
  timeoutMs?: number;
}

/**
 * Authors the post-stall gap. One instance lives in the graph's dependency bag
 * beside `systemAgent`; the finalize node calls it at most once per stalled
 * session.
 */
export class NegotiationStallGapAuthor {
  private readonly timeoutMs: number;

  constructor(config?: NegotiationStallGapAuthorConfig) {
    this.timeoutMs = resolveTurnTimeoutMs(config?.timeoutMs);
  }

  /**
   * @returns The authored gap, or null when there is none to ask — the model
   *          said so, produced invalid output after a retry, or failed. The
   *          caller treats every null identically: terminal stall, no park.
   */
  async author(input: StallGapAuthorInput): Promise<NegotiationStallGap | null> {
    const clientDm = input.clientDm ?? [];
    const model = createStructuredModel("negotiator", StallGapOutputSchema, { name: "negotiation_stall_gap" });

    const systemPrompt = SYSTEM_PROMPT
      .replace("{stallReasonLabel}", STALL_REASON_LABELS[input.stallReason])
      .replace("{dmGroundingRule}", clientDm.length > 0 ? DM_GROUNDING_RULE : "")
      .replace(/{userName}/g, input.userName);

    const transcript = input.history.length > 0
      ? `\n\nNegotiation transcript:\n${input.history.map(formatTurnLine).join("\n")}`
      : "";

    const userMessage = `{userName}'s signal under negotiation:
- ${input.signal.title}: ${input.signal.description}

Why this match was suggested: ${input.seedReasoning}${transcript}${renderNegotiatorClientDmSection(clientDm, input.userName)}

Decide whether one question to {userName} would let a retry conclude, and author it if so.`.replace(/{userName}/g, input.userName);

    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    try {
      // Same validate → retry-once → give-up loop as the negotiator turn,
      // except giving up resolves to null (terminal stall) instead of a
      // fallback action — there is no conservative fallback question.
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await this.callModel(model, chatMessages);
        const parsed = StallGapOutputSchema.safeParse(result);
        if (!parsed.success) {
          stallGapLog.warn("Stall-gap output failed schema validation", {
            attempt: attempt + 1,
            issues: parsed.error.issues.map((issue) => issue.message).slice(0, 3),
          });
          continue;
        }
        if (!parsed.data.hasGap) return null;
        if (!parsed.data.question || !parsed.data.reason) {
          stallGapLog.warn("Stall-gap output claimed a gap without question or reason", { attempt: attempt + 1 });
          continue;
        }
        return { reason: parsed.data.reason, question: parsed.data.question };
      }
      return null;
    } catch (err) {
      stallGapLog.warn("Stall-gap authoring failed; negotiation stalls without a park", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Raw structured-model round trip. Split out as a seam so tests can drive
   * the validate→retry→null loop without a live provider — same pattern as
   * `IndexNegotiator.callModel`.
   */
  protected async callModel(
    model: ReturnType<typeof createStructuredModel>,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    return invokeWithAbortSignal(model, chatMessages, AbortSignal.timeout(this.timeoutMs));
  }
}
