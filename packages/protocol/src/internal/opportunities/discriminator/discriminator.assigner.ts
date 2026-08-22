/**
 * Evidence-verified assignment of call-local newborn candidates to already
 * answered pool-discriminator axes (IND-420 P4b).
 *
 * One structured model call batches every fixed axis and candidate. The model
 * never receives the owner's chosen side; it only classifies public candidate
 * context. Code owns all identifiers, allowed sides, and evidence verification.
 */
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import { Timed } from "../../shared/observability/performance.js";
import { POOL_DISCRIMINATOR_MAX_CANDIDATES } from "./discriminator.env.js";
import { poolEvidenceMatches } from "./discriminator.miner.js";
import type { PoolCandidate } from "./discriminator.types.js";

/** QuestionerAdapter caps fresh answered preferences at this count. */
const MAX_ASSIGNMENT_AXES = 10;
const logger = protocolLogger("PoolDiscriminatorAssigner");

const AssignmentSchema = z.object({
  candidateId: z.string(),
  side: z.string().nullable(),
  evidence: z.string().max(200).nullable(),
});

const AxisSchema = z.object({
  questionId: z.string(),
  assignments: z.array(AssignmentSchema).max(POOL_DISCRIMINATOR_MAX_CANDIDATES),
});

// Keep fields optional at the outer response layer so one malformed/missing
// axis can be skipped independently, while still bounding and describing the
// nested assignment payload sent through structured output.
const ResponseAxisSchema = z.object({
  questionId: z.string().optional(),
  assignments: z.array(AssignmentSchema).max(POOL_DISCRIMINATOR_MAX_CANDIDATES).optional(),
}).passthrough();
const ResponseSchema = z.object({ axes: z.array(ResponseAxisSchema).max(MAX_ASSIGNMENT_AXES) });
type AssignmentResponse = z.infer<typeof ResponseSchema>;
type RawAxis = z.infer<typeof AxisSchema>;

const SYSTEM_PROMPT = `Classify candidate matches against FIXED preference axes.

Rules:
- Use only the supplied questionId, candidateId, and side labels. Never invent or rename them.
- Return one axis object per supplied question and one assignment per candidate.
- Pick a side only when the candidate context clearly supports it; otherwise use side null and evidence null.
- Every non-null side requires a short VERBATIM substring copied from that candidate's context. It is checked mechanically.
- Do not infer the user's preference. You are classifying candidates, not choosing which side is better.
- Return only questionId, candidateId, side, and evidence fields.`;

/** Fixed answered axis; deliberately excludes the owner's chosen side. */
export interface PoolDiscriminatorAssignmentAxis {
  questionId: string;
  label: string;
  sides: string[];
}

/** One batched assignment call. */
export interface PoolDiscriminatorAssignmentInput {
  axes: PoolDiscriminatorAssignmentAxis[];
  candidates: PoolCandidate[];
}

/** Verified assignment. Invalid or explicit unknown classifications use null. */
export interface PoolDiscriminatorCandidateAssignment {
  candidateId: string;
  side: string | null;
  evidence: string | null;
}

/** One valid returned axis. Missing or malformed axes are omitted entirely. */
export interface PoolDiscriminatorAssignedAxis {
  questionId: string;
  assignments: PoolDiscriminatorCandidateAssignment[];
}

/** Construction options for {@link PoolDiscriminatorAssigner}. */
export interface PoolDiscriminatorAssignerConfig {
  modelConfig?: Parameters<typeof createStructuredModel>[3];
}

/** Build the classifier prompt without any chosen-side preference. */
export function buildAssignmentPrompt(input: PoolDiscriminatorAssignmentInput): string {
  const axes = input.axes.map((axis) => ({
    questionId: axis.questionId,
    label: axis.label,
    sides: axis.sides,
  }));
  const candidates = input.candidates.map((candidate) => ({
    candidateId: candidate.id,
    publicContext: candidate.publicContext,
  }));
  return JSON.stringify({ axes, candidates }, null, 2);
}

/** Verify one model-returned axis against fixed IDs, sides, and contexts. */
export function verifyAssignedAxis(
  raw: RawAxis,
  input: PoolDiscriminatorAssignmentInput,
): PoolDiscriminatorAssignedAxis | null {
  const fixedAxis = input.axes.find((axis) => axis.questionId === raw.questionId);
  if (!fixedAxis) return null;

  const contextById = new Map(input.candidates.map((candidate) => [candidate.id, candidate.publicContext]));
  const firstById = new Map<string, PoolDiscriminatorCandidateAssignment>();
  for (const assignment of raw.assignments) {
    const context = contextById.get(assignment.candidateId);
    if (context === undefined || firstById.has(assignment.candidateId)) continue;
    if (assignment.side === null) {
      firstById.set(assignment.candidateId, {
        candidateId: assignment.candidateId,
        side: null,
        evidence: null,
      });
      continue;
    }
    if (!fixedAxis.sides.includes(assignment.side) || !poolEvidenceMatches(context, assignment.evidence)) {
      firstById.set(assignment.candidateId, {
        candidateId: assignment.candidateId,
        side: null,
        evidence: null,
      });
      continue;
    }
    firstById.set(assignment.candidateId, {
      candidateId: assignment.candidateId,
      side: assignment.side,
      evidence: assignment.evidence,
    });
  }

  return {
    questionId: fixedAxis.questionId,
    assignments: input.candidates.map((candidate) => firstById.get(candidate.id) ?? {
      candidateId: candidate.id,
      side: null,
      evidence: null,
    }),
  };
}

/** Stateless one-call newborn candidate classifier. */
export class PoolDiscriminatorAssigner {
  private model: ReturnType<typeof createStructuredModel<AssignmentResponse>>;

  constructor(config?: PoolDiscriminatorAssignerConfig) {
    this.model = createStructuredModel<AssignmentResponse>(
      "poolDiscriminatorAssigner",
      ResponseSchema,
      { name: "pool_newborn_assignments" },
      config?.modelConfig,
    );
  }

  /**
   * Classify every candidate against every fixed axis in one provider call.
   * Provider failures propagate so the host graph's fail-open seam can retain
   * the original un-stamped create items.
   */
  @Timed()
  async assign(
    input: PoolDiscriminatorAssignmentInput,
    options?: { signal?: AbortSignal },
  ): Promise<PoolDiscriminatorAssignedAxis[]> {
    if (input.axes.length === 0 || input.candidates.length === 0) return [];
    const boundedInput: PoolDiscriminatorAssignmentInput = {
      axes: input.axes.slice(0, MAX_ASSIGNMENT_AXES),
      candidates: input.candidates.slice(0, POOL_DISCRIMINATOR_MAX_CANDIDATES),
    };
    const raw = await invokeWithAbortSignal(
      this.model,
      [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(buildAssignmentPrompt(boundedInput))],
      options?.signal,
    );
    const parsed = ResponseSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn("Assignment response failed schema validation", { issues: parsed.error.issues.length });
      return [];
    }

    const seen = new Set<string>();
    const verified: PoolDiscriminatorAssignedAxis[] = [];
    for (const rawAxis of parsed.data.axes) {
      const axis = AxisSchema.safeParse(rawAxis);
      if (!axis.success || seen.has(axis.data.questionId)) continue;
      const result = verifyAssignedAxis(axis.data, boundedInput);
      if (!result) continue;
      seen.add(result.questionId);
      verified.push(result);
    }
    return verified;
  }
}
