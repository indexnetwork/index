/**
 * PoolDiscriminatorMiner — one structured LLM pass that proposes discriminating axes
 * over a discovery-run candidate pool, with code-side evidence verification
 * (IND-417).
 *
 * Anti-hallucination contract: every side assignment must quote a short
 * evidence span from that candidate's supplied publicContext. Verification is
 * done in code (substring match, case/whitespace-insensitive), NOT trusted
 * from the prompt. Failed verifications are demoted to `unknown`, which
 * lowers coverage → lowers VoI → buries the axis. The failure mode
 * self-punishes.
 *
 * Follows the QuestionerAgent pattern: constructor binds the structured
 * model once; single public `mine()` per call.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { Timed } from "../../shared/observability/performance.js";
import type { MinedDiscriminator, DiscriminatorMiningInput, VerifiedAssignment } from "./discriminator.types.js";

const logger = protocolLogger("PoolDiscriminatorMiner");

/** Max axes requested from (and accepted out of) one mining pass. */
const MAX_AXES = 6;

const AxisMiningResponseSchema = z.object({
  axes: z
    .array(
      z.object({
        axis: z
          .string()
          .describe("Short discriminating-axis label, e.g. 'Hands-on builders vs strategic advisors'"),
        questionSeed: z
          .string()
          .describe("A direct question the intent owner could answer to resolve this axis"),
        sides: z
          .array(z.string())
          .min(2)
          .max(3)
          .describe("2-3 mutually exclusive side labels (2-5 words each)"),
        assignments: z
          .array(
            z.object({
              id: z.string().describe("Candidate id exactly as given"),
              side: z
                .string()
                .nullable()
                .describe("One of this axis's side labels, or null when the context is insufficient"),
              evidence: z
                .string()
                .max(200)
                .nullable()
                .describe(
                  "VERBATIM span (≤80 chars) copied from this candidate's context that justifies the side. null when side is null",
                ),
            }),
          )
          .describe("One entry per candidate"),
      }),
    )
    .max(MAX_AXES),
});

type AxisMiningResponse = z.infer<typeof AxisMiningResponseSchema>;

const SYSTEM_PROMPT = `You analyze a pool of candidate matches for one user intent and propose the preference axes that best SPLIT the pool into meaningfully different groups.

Rules for every axis:
- Sides must be mutually exclusive readings of one dimension (a candidate belongs to at most one side).
- The axis must NOT already be determined by the intent text itself — only propose axes the intent leaves genuinely open.
- The axis must be phrased as a preference the intent OWNER could hold and answer (the questionSeed asks them directly).
- Side labels are terse (2-5 words), concrete, and derived from patterns across MULTIPLE candidates — never from a single person and never naming anyone.
- BANNED axis families: protected attributes (race, ethnicity, religion, gender, age, nationality, disability, politics, sexual orientation), and vanity/noise splits (profile completeness, bio length, has photo, name alphabet).

Rules for assignments:
- Assign EVERY candidate: pick a side only when the candidate's context contains clear support; otherwise use side null.
- When you pick a side you MUST quote a short (≤80 chars) VERBATIM substring of that candidate's context as evidence. Copy it exactly — it is checked mechanically, and paraphrased evidence is discarded. Do NOT add punctuation that is not in the source (no trailing period); cutting off mid-sentence is fine.
- Never invent context. If unsure, use side null with evidence null.

Prefer axes that split the pool close to evenly and that cover many candidates with verifiable evidence. Propose at most ${MAX_AXES} axes; fewer strong axes beat many weak ones.`;

/** Config for PoolDiscriminatorMiner construction. */
export interface PoolDiscriminatorMinerConfig {
  /** Optional model config override (API key / base URL / model). */
  modelConfig?: Parameters<typeof createStructuredModel>[3];
}

/**
 * Collapse whitespace, lowercase, and fold typographic punctuation to ASCII
 * (curly quotes/apostrophes, en/em dashes, ellipsis), so evidence matching
 * tolerates formatting drift without weakening the verbatim requirement.
 */
export function normalizePoolEvidenceForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips wrapping quotes and edge punctuation from an evidence span before
 * matching. LLMs habitually sentence-ize copied spans (append a trailing
 * period, wrap in quotes); the meaningful content must still match verbatim.
 */
export function stripPoolEvidenceEdgePunctuation(s: string): string {
  return s.replace(/^[\s"'.,;:!?()\u2018\u2019\u201c\u201d]+/, "").replace(/[\s"'.,;:!?()\u2018\u2019\u201c\u201d]+$/, "");
}

/** Minimum normalized span that counts as meaningful verbatim evidence. */
const MIN_POOL_EVIDENCE_CHARS = 8;

/** Evidence verifier shared by mining and newborn assignment. */
export function poolEvidenceMatches(publicContext: string, evidence: string | null): boolean {
  if (evidence === null) return false;
  const context = normalizePoolEvidenceForMatch(publicContext);
  const evidenceCore = normalizePoolEvidenceForMatch(stripPoolEvidenceEdgePunctuation(evidence));
  return evidenceCore.length >= MIN_POOL_EVIDENCE_CHARS && context.includes(evidenceCore);
}

/**
 * Stateless axis-mining agent. One `mine()` call = one structured LLM pass +
 * deterministic evidence verification.
 */
export class PoolDiscriminatorMiner {
  private model: ReturnType<typeof createStructuredModel<AxisMiningResponse>>;

  constructor(config?: PoolDiscriminatorMinerConfig) {
    this.model = createStructuredModel<AxisMiningResponse>(
      "poolDiscriminatorMiner",
      AxisMiningResponseSchema,
      { name: "pool_axes" },
      config?.modelConfig,
    );
  }

  /**
   * Mine discriminating axes for one pool.
   *
   * @returns Verified axes (may be empty). Throws on LLM failure — callers
   *   run this fire-and-forget and must catch.
   */
  @Timed()
  async mine(
    input: DiscriminatorMiningInput,
    options?: { signal?: AbortSignal },
  ): Promise<MinedDiscriminator[]> {
    const prompt = buildMiningPrompt(input);
    const raw = await invokeWithAbortSignal(
      this.model,
      [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(prompt)],
      options?.signal,
    );
    const parsed = AxisMiningResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("Mining response failed schema validation", { issues: parsed.error.issues.length });
      return [];
    }
    return parsed.data.axes.slice(0, MAX_AXES).map((axis) => verifyAxis(axis, input.candidates));
  }
}

/** Builds the human message: intent text + one numbered block per candidate. */
export function buildMiningPrompt(input: DiscriminatorMiningInput): string {
  const candidateBlocks = input.candidates
    .map((c) => `[${c.id}]\n${c.publicContext}`)
    .join("\n\n");
  return [
    `Intent:\n${input.intentText}`,
    `Candidate pool (${input.candidates.length} candidates, id in brackets):\n\n${candidateBlocks}`,
  ].join("\n\n");
}

/**
 * Deterministic post-pass over one LLM axis:
 * - drops assignments for ids not in the pool,
 * - demotes to unknown: sides not in the axis's side list, missing evidence,
 *   and evidence that does not substring-match the candidate's publicContext,
 * - collapses duplicate proposals to the same trim-normalized side,
 * - demotes a candidate proposed for different sides to unknown (zero support),
 * - guarantees exactly one assignment per pool candidate (missing → unknown),
 * - computes evidenceRate = verified / distinct candidate-side proposals.
 */
export function verifyAxis(
  axis: AxisMiningResponse["axes"][number],
  candidates: DiscriminatorMiningInput["candidates"],
): MinedDiscriminator {
  const contextById = new Map(candidates.map((c) => [c.id, c.publicContext]));
  const normalizedAxisSides = axis.sides.map((side) => side.trim());
  const axisSidesAreValid = normalizedAxisSides.every(Boolean)
    && new Set(normalizedAxisSides).size === normalizedAxisSides.length;
  const canonicalSideByNormalized = new Map(
    axis.sides.map((side) => [side.trim(), side] as const),
  );
  const proposalsById = new Map<string, Map<string, typeof axis.assignments>>();

  for (const assignment of axis.assignments) {
    if (!contextById.has(assignment.id) || assignment.side === null) continue;
    const normalizedSide = assignment.side.trim();
    let sides = proposalsById.get(assignment.id);
    if (!sides) {
      sides = new Map();
      proposalsById.set(assignment.id, sides);
    }
    const sameSide = sides.get(normalizedSide) ?? [];
    sameSide.push(assignment);
    sides.set(normalizedSide, sameSide);
  }

  const byId = new Map<string, VerifiedAssignment>();
  let proposed = 0;
  let verified = 0;

  for (const [id, sides] of proposalsById) {
    proposed += sides.size;
    // Conflicting classifier output is permanently ambiguous regardless of
    // proposal order or evidence quality. It must contribute zero support.
    if (sides.size !== 1 || !axisSidesAreValid) {
      byId.set(id, { id, side: null, evidence: null, verified: false });
      continue;
    }

    const [[normalizedSide, sameSideProposals]] = [...sides];
    const canonicalSide = canonicalSideByNormalized.get(normalizedSide);
    const context = contextById.get(id)!;
    const evidenceValid = canonicalSide
      ? sameSideProposals.find((proposal) => poolEvidenceMatches(context, proposal.evidence))
      : undefined;
    if (canonicalSide && evidenceValid) {
      verified++;
      byId.set(id, {
        id,
        side: canonicalSide,
        evidence: evidenceValid.evidence,
        verified: true,
      });
    } else {
      byId.set(id, {
        id,
        side: null,
        evidence: sameSideProposals[0]?.evidence ?? null,
        verified: false,
      });
    }
  }

  const assignments: VerifiedAssignment[] = candidates.map(
    (candidate) => byId.get(candidate.id)
      ?? { id: candidate.id, side: null, evidence: null, verified: false },
  );

  return {
    label: axis.axis,
    questionSeed: axis.questionSeed,
    sides: axis.sides,
    assignments,
    evidenceRate: proposed > 0 ? verified / proposed : 0,
  };
}
