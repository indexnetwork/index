/**
 * questions/question.schema — canonical home for question value types and schemas.
 *
 * Defines the public structured shape consumed by frontend renderers and MCP
 * elicitation dispatch, plus internal generator, persistence, and delivery
 * envelopes used across the questions capability.
 */
import { z } from "zod";
import { UnderspecificationTypeSchema, type UnderspecificationType } from "./schemas/underspecification.schema.js";
import { QuestionOptionSchema, StructuredQuestionSchema, type QuestionOption } from "./schemas/structured-question.schema.js";

export { UnderspecificationTypeSchema };

/**
 * The renderer-facing quartet (title/prompt/options/multiSelect) lives in
 * `shared/schemas/structured-question.schema.ts` so the negotiator can author a
 * question without `shared/` importing this capability. Re-exported here so
 * `questions/question.schema.js` stays the import site every caller already uses.
 */
export { QuestionOptionSchema, StructuredQuestionSchema };
export type { StructuredQuestion } from "./schemas/structured-question.schema.js";

/** Refinement questions a single intent may generate per rolling window. */
export const INTENT_QUESTION_DAILY_CAP_DEFAULT = 2;
/** Width of the rolling question budget window, in hours. */
export const INTENT_QUESTION_DAILY_WINDOW_HOURS = 24;

export const QuestionSchema = StructuredQuestionSchema.extend({
  /**
   * Optional provenance line rendered as a muted chip above the prompt
   * (e.g. "based on 18 people matching this intent"). Aggregate counts only —
   * never individual identities.
   *
   * Declared `.nullable().optional()` (not bare `.optional()`) so the schema
   * survives OpenAI/OpenRouter strict structured-output conversion, which
   * rejects optional-without-nullable fields. The `.transform()` normalizes an LLM-returned `null`
   * back to `undefined` so a null is NEVER persisted or treated as
   * "evidence present": real string evidence flows through unchanged, while
   * both `null` and omitted read as absent everywhere downstream
   * (e.g. the intent-recovery `!question.evidence` selection filter).
   */
  evidence: z.string().min(1).max(160).nullable().optional().transform((value) => value ?? undefined),
});


export const QuestionStrategySchema = z.enum([
  "refine_intent",
  "surface_missing_detail",
  "open_adjacent_thread",
  "reflective_summary",
  "surface_emergent_knowledge",
]);

export const QuestionWithStrategySchema = QuestionSchema.extend({
  strategy: QuestionStrategySchema,
  /** QUD repair category, or null when the question is not an underspecification repair. */
  underspecificationType: UnderspecificationTypeSchema.nullable(),
});

export const QuestionGeneratorResponseSchema = z.object({
  questions: z.array(QuestionWithStrategySchema).max(3),
});

export type { QuestionOption };
export type Question = z.infer<typeof QuestionSchema>;
export type { UnderspecificationType };
export type QuestionStrategy = z.infer<typeof QuestionStrategySchema>;
export type QuestionWithStrategy = z.infer<typeof QuestionWithStrategySchema>;
export type QuestionGeneratorResponse = z.infer<typeof QuestionGeneratorResponseSchema>;

/**
 * Internal generator output: public questions plus parallel strategy and QUD
 * taxonomy arrays for metadata-only consumption. The generator emits this;
 * callers forward only `questions` to renderers.
 */
export interface QuestionGenerationResult {
  questions: Question[];
  strategies: QuestionStrategy[];
  underspecificationTypes: Array<UnderspecificationType | null>;
}

// ─── Persistence types (opportunity-style composable jsonb) ──────────────────

export const QuestionPurposeSchema = z.enum([
  "recovery",
]);

export const QuestionModeSchema = z.enum([
  "intent",
  // Chat-originated questions.
  "chat",
]);

/** Private snapshot for a post-discovery recovery refinement question. */
export const QuestionRecoverySnapshotSchema = z.object({
  version: z.literal(1),
  intentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  completionSource: z.enum(["intent_creation"]),
});

/** Internal reason a pending question was voided. */
export const QuestionVoidedReasonSchema = z.enum([
  "intent_edit",
  "recovery_drift",
  "negotiation_stale",
  // The generator that produced the row was retired, so the question can no
  // longer lead anywhere. Written once by a one-time migration, never by
  // runtime code — nothing produces a retired mode by definition.
  "retired_mode",
]);

export const QuestionDetectionSchema = z.object({
  /** Which preset mode generated this question. */
  mode: QuestionModeSchema,
  /** Internal reason for generation; independent of mode and QUD repair metadata. */
  purpose: QuestionPurposeSchema.optional(),
  /** Entity type that triggered generation (e.g. "opportunity", "intent", "profile"). */
  sourceType: z.string().min(1),
  /** ID of the triggering entity. */
  sourceId: z.string().min(1),
  /** Optional intent ID that was the root cause. */
  triggeredBy: z.string().optional(),
  /** ISO-8601 timestamp of generation. */
  timestamp: z.string().min(1),
  /** Generation strategy persisted as internal metadata. */
  strategy: QuestionStrategySchema.optional(),
  /** QUD repair category persisted as internal metadata. */
  underspecificationType: UnderspecificationTypeSchema.nullable().optional(),
  /** ID of the assistant message that triggered this question. Used by the frontend to anchor the question card inline. */
  messageId: z.string().optional(),
  /** Durable server-only conversation session binding used to validate messageId. */
  sessionId: z.string().optional(),
  /** Post-discovery intent recovery snapshot. Internal only. */
  recovery: QuestionRecoverySnapshotSchema.optional(),
  /** Internal reason this question was voided after intent drift. */
  voidedReason: QuestionVoidedReasonSchema.optional(),
}).superRefine((detection, ctx) => {
  if (detection.purpose === "recovery") {
    if (
      detection.mode !== "intent"
      || detection.sourceType !== "intent"
      || !detection.triggeredBy?.trim()
      || detection.triggeredBy !== detection.sourceId
      || !detection.recovery
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recovery"],
        message: "recovery purpose requires intent mode/source, equal trigger provenance, and a recovery snapshot",
      });
    }
  } else if (detection.recovery) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["purpose"],
      message: "recovery snapshot requires recovery purpose",
    });
  }
});

export const QuestionActorSchema = z.object({
  /** The user this question is for. */
  userId: z.string().min(1),
  /** Optional network context. */
  networkId: z.string().optional(),
  /** Actor's role in the question — currently always "subject". */
  role: z.literal("subject"),
});

export const QuestionAnswerSchema = z.object({
  /** Option labels the user selected. */
  selectedOptions: z.array(z.string()),
  /** Free-text input when the user chose "Other" or elaborated. */
  freeText: z.string().optional(),
  /** User ID of the answerer. */
  answeredBy: z.string().min(1),
  /** ISO-8601 timestamp of when the answer was submitted. */
  answeredAt: z.string().min(1),
});

export type QuestionPurpose = z.infer<typeof QuestionPurposeSchema>;
export type QuestionMode = z.infer<typeof QuestionModeSchema>;
export type QuestionDetection = z.infer<typeof QuestionDetectionSchema>;
export type QuestionActor = z.infer<typeof QuestionActorSchema>;
export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;
export type QuestionRecoverySnapshot = z.infer<typeof QuestionRecoverySnapshotSchema>;
export type QuestionVoidedReason = z.infer<typeof QuestionVoidedReasonSchema>;
