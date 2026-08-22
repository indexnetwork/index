/**
 * Negotiation state DTOs extracted from negotiations/negotiation.state.ts for
 * consumption by shared interfaces. This shared module owns the DTO schemas;
 * LangGraph Annotation.Root stays in the domain file.
 */
import { z } from "zod";
import { StructuredQuestionSchema } from "./structured-question.schema.js";
import { AnswerhoodSchema, ChecklistDraftSchema } from "./negotiation-checklist.schema.js";

// ─── Zod schemas (available for runtime validation) ───────────────────────────

/**
 * Union of negotiation turn actions.
 *
 * The protocol is seat-scoped: `outreach` belongs to the initiator and
 * `decline` to the counterparty. Which subset is valid for a turn depends on
 * the acting user's seat — see
 * `negotiations/negotiation.protocol.ts` for the seat-scoped schemas.
 */
export const NEGOTIATION_ACTIONS = [
  "accept", "counter", "question", "outreach", "withdraw", "decline",
  "ask_user",
] as const;
export type NegotiationAction = (typeof NEGOTIATION_ACTIONS)[number];

/** Negotiation seat under the client-advocate protocol. */
export type NegotiationSeat = "initiator" | "counterparty";

/** Closed, content-free reasons that select server-owned consultation copy. */
export const NEGOTIATION_CONSULTATION_REASONS = [
  "unresolved_owner_constraint",
  "consequential_disclosure_permission",
  "repeated_non_convergence",
  "insufficient_commitment_authority",
] as const;
export const NegotiationConsultationReasonSchema = z.enum(NEGOTIATION_CONSULTATION_REASONS);
export type NegotiationConsultationReason = z.infer<typeof NegotiationConsultationReasonSchema>;

/**
 * Payload for an `ask_user` action.
 *
 * `reason` stays the closed enum it has always been: it is admission metadata
 * for the deterministic consultation policy, not copy. `question` is the
 * channel through which the user's own personal agent — the only thing that
 * should be writing questions — hands over the question it authored from the
 * negotiation it is actually having. Free-form keys beyond these two are still
 * rejected by `.strict()`.
 */
export const AskUserPayloadSchema = z.object({
  reason: NegotiationConsultationReasonSchema,
  /**
   * The question the negotiating agent wrote, in the structured shape the UI
   * already renders. Optional: external agents and the existing enum-only path
   * must all keep validating, so a payload of `{ reason }`
   * alone stays byte-identical in and out.
   *
   * Declared `.nullable().optional()` (not bare `.optional()`) so the enclosing
   * turn schemas survive OpenAI/OpenRouter strict structured-output conversion,
   * which rejects optional-without-nullable fields — the same constraint
   * documented on `QuestionSchema.evidence`. The `.transform()` normalizes an
   * LLM-returned `null` back to `undefined`, so a null is never persisted and
   * `null` and omitted read as absent identically downstream.
   */
  question: StructuredQuestionSchema.nullable().optional().transform((value) => value ?? undefined),
  /**
   * The checklist dimension this ask is about (checklist plan §4). One
   * dimension per ask, always: the answerhood map below is only well-defined
   * per-dimension, and bundling two topics into one question makes the
   * principal's answer unscoreable against either.
   *
   * Optional for the same reason `question` is: external agents and the
   * enum-only path must all keep validating. An ask that names no
   * dimension is inadmissible under the checklist protocol (the graph refuses
   * it) but must still PARSE — a schema that rejected it would fail the turn
   * instead of downgrading the move.
   */
  dimension: z.string().min(1).max(60).nullable().optional().transform((value) => value ?? undefined),
  /**
   * What answers would score the dimension `ok` and what would score it
   * `conflict`, declared BEFORE the question is asked. This is the pivotality
   * proof: an author who cannot say what answer would flip the verdict is
   * asking a question with no value of information. It also makes answer
   * consumption deterministic — the answer is scored against the map the ask
   * declared, not re-interpreted freely on the resumed turn.
   */
  answerhood: AnswerhoodSchema.nullable().optional().transform((value) => value ?? undefined),
  /**
   * Set by the graph, never by an agent: this ask was fired by the conclusion
   * floor on the agent's behalf, because it had an askable unknown and drafted
   * something else anyway.
   *
   * It exists to be read BACK off the persisted turn. The floor's guarantee is
   * bounded at one per negotiation per principal, and the message record is the
   * only store a park, a resume and a fresh process all share — so the bound
   * has to be a durable property of the ask itself rather than a counter in
   * state. A model that sets it would only be suppressing a later guarantee for
   * its own seat, which is why {@link AskUserGenerationSchema} does not offer
   * the field at all and the turn node strips it from every draft that arrives
   * by any other route — so the only writer is the floor.
   */
  guaranteed: z.literal(true).nullable().optional().transform((value) => value ?? undefined),
}).strict();
export type AskUserPayload = z.infer<typeof AskUserPayloadSchema>;

/**
 * The ask payload as an LLM may DRAFT it — the schema bound for structured
 * output by the seat-scoped turn schemas in `negotiations/negotiation.protocol.ts`.
 *
 * Split from the payload above rather than shared with it, because the two
 * seams have opposite jobs. The one above is what a persisted ask looks like:
 * it carries `guaranteed`, because that mark is read back off the record, and
 * it is `.strict()`, because the record is where a free-form key would do
 * damage. This one is what a model is ALLOWED TO SAY, and every difference
 * follows from that:
 *
 * - `guaranteed` is OMITTED, not merely stripped afterwards. A field only the
 *   graph may write should never be offered to the model in the first place.
 *   Offering it and defending against a claimed `true` was the #1464 shape,
 *   and it cost a turn the first time a model filled the visible optional with
 *   `false`: `z.literal(true)` rejects `false` at parse, inside the structured
 *   output call, before any strip could run. The whole turn died, was retried,
 *   was refused again, and the question was never delivered.
 * - Unknown keys are DROPPED rather than refused. On this seam a refusal is
 *   not a result anyone gets to act on — it throws and fails the turn — so the
 *   safe reading of a key nobody asked for is to discard it. Nothing
 *   unrecognised reaches the record either way, since this parse is what
 *   produces the object that gets persisted.
 * - The authored `question` degrades to absent when it cannot be repaired into
 *   the renderer's shape (see `structured-question.schema.ts`, where every cap
 *   repairs). One option instead of two is not repairable, and an ask with no
 *   authored question is a path the protocol already walks — the floor's own
 *   guaranteed ask has none, and the server template covers it. Losing the
 *   wording is a smaller loss than losing the turn.
 */
export const AskUserGenerationSchema = AskUserPayloadSchema
  .omit({ guaranteed: true })
  .strip()
  .extend({
    question: StructuredQuestionSchema.nullable().optional().catch(undefined)
      .transform((value) => value ?? undefined),
  });
export type AskUserGeneration = z.infer<typeof AskUserGenerationSchema>;

export const NegotiationTurnSchema = z.object({
  action: z.enum(NEGOTIATION_ACTIONS),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
  /** Persisted client-consult payload. */
  askUser: AskUserPayloadSchema.nullable().optional(),
  /**
   * The negotiation's checklist as this turn scored it (checklist plan §2).
   *
   * Persisted on every turn under the checklist protocol, which makes the turn
   * record the checklist's only store: a continuation recovers the frozen
   * dimensions from the same messages it recovers the dialogue from, with no
   * second table to keep in step. Optional and permissive here for the same
   * reason `askUser` is — external agents and pre-checklist history
   * must keep validating, and the domain module (`negotiation.checklist.
   * contracts.ts`) is what enforces the invariants on the way in.
   */
  checklist: ChecklistDraftSchema.nullable().optional(),
});
export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

export const NegotiationOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  /**
   * `agent_error`: the run stopped on repeated agent failures, not on a decision.
   * `repetition`: the run stopped because an agent kept reproducing a message
   * already on the record — likewise not a decision.
   * `screened_out`: nothing was ever sent. Written by the IND-564 opening-turn
   * withdraw guard; also carried by rows the removed outreach gate stamped.
   */
  reason: z.enum(["turn_cap", "timeout", "screened_out", "agent_error", "repetition"]).optional(),
});
export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

// ─── Pure interfaces ──────────────────────────────────────────────────────────

/**
 * Context each agent receives about its user.
 *
 * Structurally duplicated by the graph-internal declaration in
 * `negotiations/negotiation.state.ts`; the two must stay identical, since the
 * host imports this one and the graph passes the other.
 */
export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

/** Seed assessment from the evaluator pre-filter. */
export interface SeedAssessment {
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}
