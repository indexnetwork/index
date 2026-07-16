/**
 * Question — public structured shape consumed by frontend renderers and MCP
 * elicitation dispatch. Mirrors the brainstorming AskUserQuestion skill so a
 * Question can be rendered identically across surfaces.
 *
 * `QuestionWithStrategy` extends the public shape with internal `strategy`
 * and QUD underspecification tags used by generator guardrails and persisted
 * metadata. Both tags are stripped before the public payload leaves the
 * generator — users never see them.
 */
import { z } from "zod";

export const QuestionOptionSchema = z.object({
  /** Display text. Suffix " (Recommended)" on the safest path; list it first. */
  label: z.string().min(1).max(120),
  /** Explains the consequence of choosing this option, not just its definition. */
  description: z.string().min(1).max(280),
});

export const QuestionSchema = z.object({
  /** ≤12 chars. Noun of the decision domain — e.g. "Stage", "Timing", "Role". */
  title: z.string().min(1).max(12),
  /** ≤2 sentences, ≤400 chars. Ends in a question mark. */
  prompt: z.string().min(1).max(400),
  /** 2–4 options. No explicit "Other" — clients provide that automatically. */
  options: z.array(QuestionOptionSchema).min(2).max(4),
  /** True when options are not mutually exclusive (priorities, bundles). */
  multiSelect: z.boolean(),
  /**
   * Optional provenance line rendered as a muted chip above the prompt
   * (e.g. "based on 18 people matching this intent"). Aggregate counts only —
   * never individual identities (pool_discovery k-anonymity invariant).
   */
  evidence: z.string().min(1).max(160).optional(),
});

/** Canonical QUD repair categories for underspecified intents/questions. */
export const UnderspecificationTypeSchema = z.enum([
  "missing_constituent",
  "missing_constraint",
  "open_alternative_set",
]);

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

export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type UnderspecificationType = z.infer<typeof UnderspecificationTypeSchema>;
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

/** Internal reason a question was generated, orthogonal to mode and QUD metadata. */
export const QuestionPurposeSchema = z.enum(["uptake"]);

export const QuestionModeSchema = z.enum([
  "discovery",
  "intent",
  "enrichment",
  "negotiation",
  // Negotiator-initiated mid-negotiation client questions (ask_user action, P3).
  // Distinct from "negotiation", which covers post-stall questions only.
  "negotiation_inflight",
  // Orchestrator-initiated mid-conversation questions (ask_user_question tool).
  "chat",
  // Pool-discriminator questions mined from the intent's candidate pool
  // (IND-418). Synthesized deterministically — no generator LLM call.
  "pool_discovery",
]);

/** One server-side candidate→side assignment (never serialized to clients). */
export const QuestionPoolAssignmentSchema = z.object({
  opportunityId: z.string().min(1),
  side: z.string().min(1),
});

/**
 * One mined discriminator carried inside a pool_discovery question's
 * detection (the asked one plus ranked alternates for interview-mode
 * chaining). INTERNAL — the read path strips `detection.pool` before any
 * payload leaves the server.
 */
export const QuestionPoolDiscriminatorSchema = z.object({
  label: z.string().min(1),
  questionSeed: z.string().min(1),
  sides: z.array(z.string().min(1)).min(2).max(3),
  /** Verified-assignment count per side label. */
  sideCounts: z.record(z.string(), z.number()),
  voi: z.number(),
  evidenceRate: z.number(),
  /** Discriminator embedding retained for durable semantic novelty checks. */
  embedding: z.array(z.number().finite()).min(1).max(4096).optional(),
  /** Model that generated `embedding`; mismatches must fall back to text. */
  embeddingModel: z.string().min(1).optional(),
  /** Verified assignments only — the P3 re-rank input. */
  assignments: z.array(QuestionPoolAssignmentSchema),
});

/** Pool snapshot stored on pool_discovery questions (server-side only). */
export const QuestionPoolSnapshotSchema = z.object({
  poolSize: z.number().int().min(0),
  /** ISO-8601 timestamp of the mining pass. */
  minedAt: z.string().min(1),
  /** Discovery run that produced the pool, when known. */
  runId: z.string().optional(),
  /** Intent payload snippet (≤160 chars) — reused by chained questions' evidence chips. */
  intentText: z.string().optional(),
  /** Stable hash of the full normalized payload + summary used for freshness. */
  intentFingerprint: z.string().min(1).optional(),
  /** The discriminator this question asks about. */
  discriminator: QuestionPoolDiscriminatorSchema,
  /** Remaining ranked discriminators for interview-mode chaining. */
  alternates: z.array(QuestionPoolDiscriminatorSchema),
});

/** Internal delivery ledger for proactive pool-question pushes (IND-421). */
export const QuestionPoolPushSchema = z.object({
  version: z.literal(1),
  source: z.literal("pool_discovery"),
  recipientId: z.string().min(1),
  intentId: z.string().min(1),
  cycleKey: z.string().min(1),
  messageId: z.string().min(1),
  surfaces: z.tuple([
    z.literal("personal_agent_badge"),
    z.literal("negotiator_dm"),
  ]),
  claimedAt: z.string().min(1),
  deliveryStatus: z.enum(["claimed", "delivered", "suppressed", "failed"]),
  conversationId: z.string().min(1).optional(),
  deliveredAt: z.string().min(1).optional(),
  suppressedAt: z.string().min(1).optional(),
  failure: z.string().min(1).max(500).optional(),
});

/** Durable request state for proactive pool-question delivery. */
export const QuestionPoolPushRequestStatusSchema = z.enum(["requested", "suppressed"]);

/** Permanent reasons that terminalize an unclaimed proactive push request. */
export const QuestionPoolPushRequestReasonSchema = z.enum([
  "question_lifecycle",
  "intent_lifecycle",
  "malformed_source",
  "malformed_actor",
  "malformed_pool",
  "malformed_cycle",
  "visited",
  "pool_size",
  "voi",
  "cycle_budget",
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
  /**
   * pool_discovery only: the mined pool snapshot (assignments + alternates).
   * INTERNAL — stripped from every client-facing read (web + MCP).
   */
  pool: QuestionPoolSnapshotSchema.optional(),
  /** Durable request marker written before enqueueing proactive delivery. Internal only. */
  pushRequestedAt: z.string().min(1).optional(),
  /** Last bounded recovery sweep that selected this request. Internal only. */
  pushRecoveryAttemptedAt: z.string().min(1).optional(),
  /** Durable request outcome. Internal only. */
  pushRequestStatus: QuestionPoolPushRequestStatusSchema.optional(),
  /** Permanent suppression reason for an unclaimed request. Internal only. */
  pushRequestReason: QuestionPoolPushRequestReasonSchema.optional(),
  /** ISO-8601 timestamp at which an unclaimed request was suppressed. Internal only. */
  pushRequestSuppressedAt: z.string().min(1).optional(),
  /** Internal proactive delivery state. Never serialize to public clients. */
  push: QuestionPoolPushSchema.optional(),
  /** Authoritative successful-delivery ledger timestamp. Internal only. */
  pushedAt: z.string().min(1).optional(),
}).superRefine((detection, ctx) => {
  if (
    detection.mode === "pool_discovery"
    && (!detection.triggeredBy?.trim() || detection.triggeredBy !== detection.sourceId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["triggeredBy"],
      message: "pool_discovery triggeredBy must be non-empty and equal sourceId",
    });
  }
  if (detection.pushRequestStatus && !detection.pushRequestedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pushRequestedAt"],
      message: "push request state requires a request timestamp",
    });
  }
  if (detection.pushRecoveryAttemptedAt && !detection.pushRequestedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pushRequestedAt"],
      message: "push recovery attempts require a request timestamp",
    });
  }
  if (detection.pushRequestStatus === "suppressed") {
    if (!detection.pushRequestReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pushRequestReason"],
        message: "suppressed push requests require a reason",
      });
    }
    if (!detection.pushRequestSuppressedAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pushRequestSuppressedAt"],
        message: "suppressed push requests require a timestamp",
      });
    }
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
export type QuestionPoolAssignment = z.infer<typeof QuestionPoolAssignmentSchema>;
export type QuestionPoolDiscriminator = z.infer<typeof QuestionPoolDiscriminatorSchema>;
export type QuestionPoolSnapshot = z.infer<typeof QuestionPoolSnapshotSchema>;
export type QuestionPoolPush = z.infer<typeof QuestionPoolPushSchema>;
export type QuestionPoolPushRequestStatus = z.infer<typeof QuestionPoolPushRequestStatusSchema>;
export type QuestionPoolPushRequestReason = z.infer<typeof QuestionPoolPushRequestReasonSchema>;
