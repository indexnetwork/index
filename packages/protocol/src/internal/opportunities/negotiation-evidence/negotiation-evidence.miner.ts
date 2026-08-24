/**
 * NegotiationEvidenceMiner — one structured LLM pass that proposes neutral
 * clarification hypotheses over ALLOWLISTED negotiation evidence, with
 * code-side support verification delegated to the verifier (IND-433).
 *
 * The miner only ever sees the allowlisted projection (owner answers, bilateral
 * actions, coarse outcomes, explicitly shared messages) — never reasoning,
 * memories, disclosure subjects, or provenance. Every proposed hypothesis must
 * cite the `evidenceId`s that support it and quote a verbatim span from each;
 * unsupported or hallucinated references are discarded in code, not trusted
 * from the prompt.
 *
 * Follows the Lens A `PoolDiscriminatorMiner` pattern: constructor binds the
 * structured model once; a single public `mine()` per call.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { Timed } from "../../shared/observability/performance.js";
import type { AllowlistedEvidence, MinedEvidenceHypothesis } from "./negotiation-evidence.types.js";

const logger = protocolLogger("NegotiationEvidenceMiner");

/** Max hypotheses requested from (and accepted out of) one mining pass. */
const MAX_HYPOTHESES = 8;

const HypothesisMiningResponseSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        statement: z
          .string()
          .describe(
            "A neutral, non-identifying clarification hypothesis about the intent owner's preferences or context",
          ),
        claimType: z
          .enum(["observation", "recipient_fact", "recipient_preference"])
          .describe(
            "observation = a neutral pattern; recipient_fact/recipient_preference = a claim ABOUT the intent owner (needs owner-authored or structured support)",
          ),
        supportRefs: z
          .array(
            z.object({
              evidenceId: z.string().describe("An evidenceId exactly as given in the evidence list"),
              span: z
                .string()
                .max(200)
                .describe("VERBATIM span (<=120 chars) copied from that evidence's content"),
            }),
          )
          .min(1)
          .describe("One or more support references; every hypothesis must be grounded"),
      }),
    )
    .max(MAX_HYPOTHESES),
});

type HypothesisMiningResponse = z.infer<typeof HypothesisMiningResponseSchema>;

const SYSTEM_PROMPT = `You review ALLOWLISTED evidence gathered from a user's past negotiations and propose neutral clarification hypotheses about that user's (the "intent owner") preferences or context.

You are given only a safe projection of evidence: the owner's own answers, structured bilateral actions, coarse outcomes, and explicitly shared messages. Each item has an id, a kind, and a speaker (owner | counterparty | system).

Rules for every hypothesis:
- State it neutrally and at an aggregate level. NEVER name or describe any specific person, and NEVER infer protected attributes (race, ethnicity, religion, gender, age, nationality, disability, politics, sexual orientation).
- Ground it: cite the evidenceId(s) that support it and copy a short (<=120 chars) VERBATIM substring of that evidence's content as the span. Copy it exactly — spans are checked mechanically and paraphrased spans are discarded.
- claimType:
  - Use "recipient_fact" or "recipient_preference" only for a claim ABOUT the intent owner. Such claims may ONLY be supported by owner or system evidence — a counterparty statement can never establish a fact or preference about the owner.
  - Use "observation" for a neutral pattern that a counterparty statement may also support.
- Do not speculate beyond the evidence. If an item does not support a distinct hypothesis, ignore it.

Prefer a few well-supported hypotheses over many weak ones. Propose at most ${MAX_HYPOTHESES}.`;

/** Config for NegotiationEvidenceMiner construction. */
export interface NegotiationEvidenceMinerConfig {
  /** Optional model config override (API key / base URL / model). */
  modelConfig?: Parameters<typeof createStructuredModel>[3];
}

/**
 * Stateless hypothesis-mining agent. One `mine()` call = one structured LLM
 * pass. All support verification happens later, in the verifier.
 */
export class NegotiationEvidenceMiner {
  private model: ReturnType<typeof createStructuredModel<HypothesisMiningResponse>>;

  constructor(config?: NegotiationEvidenceMinerConfig) {
    this.model = createStructuredModel<HypothesisMiningResponse>(
      "negotiationEvidenceMiner",
      HypothesisMiningResponseSchema,
      { name: "negotiation_evidence_hypotheses" },
      config?.modelConfig,
    );
  }

  /**
   * Mine neutral hypotheses for one allowlisted evidence set.
   *
   * @returns Proposed hypotheses (may be empty). Throws on LLM failure —
   *   callers run this fire-and-forget and must catch.
   */
  @Timed()
  async mine(
    evidence: AllowlistedEvidence[],
    options?: { signal?: AbortSignal },
  ): Promise<MinedEvidenceHypothesis[]> {
    if (evidence.length === 0) return [];
    const prompt = buildEvidencePrompt(evidence);
    const raw = await invokeWithAbortSignal(
      this.model,
      [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(prompt)],
      options?.signal,
    );
    const parsed = HypothesisMiningResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("Mining response failed schema validation", { issues: parsed.error.issues.length });
      return [];
    }
    return parsed.data.hypotheses.slice(0, MAX_HYPOTHESES).map((h) => ({
      statement: h.statement,
      claimType: h.claimType,
      supportRefs: h.supportRefs.map((r) => ({ evidenceId: r.evidenceId, span: r.span })),
    }));
  }
}

/** Builds the human message: one block per allowlisted evidence unit. */
export function buildEvidencePrompt(evidence: AllowlistedEvidence[]): string {
  const blocks = evidence
    .map((e) => `[${e.evidenceId}] (${e.kind}, ${e.speaker})\n${e.content}`)
    .join("\n\n");
  return `Allowlisted evidence (${evidence.length} items, id in brackets):\n\n${blocks}`;
}
