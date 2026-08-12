import { describe, it, expect } from "bun:test";
import { createRequire } from "node:module";

import { QuestionOptionSchema, QuestionSchema, UnderspecificationTypeSchema, QuestionStrategySchema, QuestionWithStrategySchema, QuestionGeneratorResponseSchema, QuestionPurposeSchema, QuestionModeSchema, QuestionDetectionSchema, QuestionPoolSnapshotSchema, QuestionPoolPushSchema, QuestionVoidedReasonSchema, QuestionPoolPushRequestReasonSchema, QuestionActorSchema, QuestionAnswerSchema } from "../question.schema.js";

const okOption = { label: "Stay focused", description: "Higher risk but cleaner narrative" };

const okQuestion = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [okOption, { label: "Pivot", description: "Wider candidate pool" }],
  multiSelect: false,
};

describe("QuestionOptionSchema", () => {
  it("accepts well-formed options", () => {
    expect(() => QuestionOptionSchema.parse(okOption)).not.toThrow();
  });
  it("rejects option label longer than 120 chars", () => {
    const long = { label: "x".repeat(121), description: "ok" };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects option description longer than 280 chars", () => {
    const long = { label: "ok", description: "x".repeat(281) };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects empty label", () => {
    expect(() => QuestionOptionSchema.parse({ label: "", description: "ok" })).toThrow();
  });
});

describe("QuestionSchema", () => {
  it("accepts a single-select question with 2 options", () => {
    expect(() => QuestionSchema.parse(okQuestion)).not.toThrow();
  });

  it("accepts a multi-select question with 4 options", () => {
    const four = {
      ...okQuestion,
      multiSelect: true,
      options: [
        { label: "a", description: "d1" },
        { label: "b", description: "d2" },
        { label: "c", description: "d3" },
        { label: "d", description: "d4" },
      ],
    };
    expect(() => QuestionSchema.parse(four)).not.toThrow();
  });

  it("rejects title longer than 12 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, title: "x".repeat(13) })).toThrow();
  });

  it("rejects fewer than 2 options", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, options: [okOption] })).toThrow();
  });

  it("rejects more than 4 options", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `o${i}`, description: `d${i}` }));
    expect(() => QuestionSchema.parse({ ...okQuestion, options: five })).toThrow();
  });

  it("rejects prompt longer than 400 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "x".repeat(401) })).toThrow();
  });

  it("rejects empty prompt", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "" })).toThrow();
  });

  it("rejects missing multiSelect", () => {
    const { multiSelect: _, ...rest } = okQuestion;
    expect(() => QuestionSchema.parse(rest)).toThrow();
  });

  it("accepts a real string evidence chip unchanged", () => {
    const parsed = QuestionSchema.parse({ ...okQuestion, evidence: "based on 18 people matching this intent" });
    expect(parsed.evidence).toBe("based on 18 people matching this intent");
  });

  it("normalizes evidence: null to undefined (never 'evidence present')", () => {
    const parsed = QuestionSchema.parse({ ...okQuestion, evidence: null });
    expect(parsed.evidence).toBeUndefined();
    // Behaves exactly like no evidence for the `!question.evidence` selection filter.
    expect(!parsed.evidence).toBe(true);
  });

  it("treats omitted evidence as undefined", () => {
    const parsed = QuestionSchema.parse(okQuestion);
    expect(parsed.evidence).toBeUndefined();
  });

  it("rejects empty-string evidence", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, evidence: "" })).toThrow();
  });
});

describe("UnderspecificationTypeSchema", () => {
  it.each(["missing_constituent", "missing_constraint", "open_alternative_set"])(
    "accepts '%s'",
    (type) => expect(UnderspecificationTypeSchema.safeParse(type).success).toBe(true),
  );

  it("rejects values outside the canonical taxonomy", () => {
    expect(UnderspecificationTypeSchema.safeParse("missing_context").success).toBe(false);
  });
});

describe("QuestionStrategySchema", () => {
  const strategies = [
    "refine_intent",
    "surface_missing_detail",
    "open_adjacent_thread",
    "reflective_summary",
    "surface_emergent_knowledge",
  ];

  for (const s of strategies) {
    it(`accepts strategy "${s}"`, () => {
      expect(() => QuestionStrategySchema.parse(s)).not.toThrow();
    });
  }

  it("rejects an unknown strategy", () => {
    expect(() => QuestionStrategySchema.parse("guess_lottery_numbers")).toThrow();
  });
});

describe("QuestionWithStrategySchema", () => {
  it("accepts a question with a valid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({
      ...okQuestion,
      strategy: "refine_intent",
      underspecificationType: "missing_constraint",
    })).not.toThrow();
  });
  it("rejects a question with an invalid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({
      ...okQuestion,
      strategy: "bogus",
      underspecificationType: null,
    })).toThrow();
  });
  it("requires nullable internal underspecification metadata", () => {
    expect(() => QuestionWithStrategySchema.parse({ ...okQuestion, strategy: "refine_intent" })).toThrow();
    expect(() => QuestionWithStrategySchema.parse({
      ...okQuestion,
      strategy: "open_adjacent_thread",
      underspecificationType: null,
    })).not.toThrow();
  });
});

describe("QuestionGeneratorResponseSchema", () => {
  it("accepts an empty questions array", () => {
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: [] })).not.toThrow();
  });
  it("accepts up to 3 questions", () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
      underspecificationType: null,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: three })).not.toThrow();
  });
  it("rejects more than 3 questions", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
      underspecificationType: null,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: four })).toThrow();
  });

  it("normalizes evidence: null to undefined inside a nested question", () => {
    const parsed = QuestionGeneratorResponseSchema.parse({
      questions: [{
        ...okQuestion,
        evidence: null,
        strategy: "refine_intent" as const,
        underspecificationType: null,
      }],
    });
    expect(parsed.questions[0].evidence).toBeUndefined();
  });
});

/**
 * Regression guard for the questioner LLM binding. `createStructuredModel`
 * (see questioner.agent.ts) hands QuestionGeneratorResponseSchema to
 * `@langchain/openai`, which converts it via OpenAI's zodResponseFormat in
 * strict structured-output mode. Strict mode throws on any
 * optional-without-nullable field, which previously made every QuestionerAgent
 * call fail client-side before any network I/O. Run the exact conversion here
 * (resolving the openai package @langchain/openai actually uses) so the binding
 * cannot silently regress. A bare `.optional()` evidence field fails this test.
 */
describe("QuestionGeneratorResponseSchema strict structured-output conversion", () => {
  const langchainRequire = createRequire(require.resolve("@langchain/openai/package.json"));
  const { zodResponseFormat } = langchainRequire("openai/helpers/zod") as {
    zodResponseFormat: (schema: unknown, name: string) => unknown;
  };

  it("serializes under OpenAI strict mode without throwing", () => {
    expect(() => zodResponseFormat(QuestionGeneratorResponseSchema, "clarifying_questions")).not.toThrow();
  });
});

describe("QuestionPurpose", () => {
  it("accepts only internal purpose discriminators", () => {
    expect(QuestionPurposeSchema.parse("uptake")).toBe("uptake");
    expect(QuestionPurposeSchema.parse("recovery")).toBe("recovery");
    expect(QuestionPurposeSchema.safeParse("negotiation").success).toBe(false);
  });
});

describe("QuestionPoolSnapshot", () => {
  const legacySnapshot = {
    poolSize: 8,
    minedAt: "2026-07-16T12:00:00.000Z",
    discriminator: {
      label: "Builders vs advisors",
      questionSeed: "Which matters more?",
      sides: ["Builders", "Advisors"],
      sideCounts: { Builders: 4, Advisors: 4 },
      voi: 0.5,
      evidenceRate: 1,
      assignments: [{ opportunityId: "legacy-opp", side: "Builders" }],
    },
    alternates: [],
  };

  it("accepts legacy snapshots that omit opportunityIds", () => {
    const result = QuestionPoolSnapshotSchema.safeParse(legacySnapshot);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.opportunityIds).toBeUndefined();
  });

  it("validates opportunityIds as UUIDs when present", () => {
    expect(QuestionPoolSnapshotSchema.safeParse({
      ...legacySnapshot,
      opportunityIds: ["00000000-0000-4000-8000-000000000001"],
    }).success).toBe(true);
    expect(QuestionPoolSnapshotSchema.safeParse({
      ...legacySnapshot,
      opportunityIds: ["not-a-uuid"],
    }).success).toBe(false);
  });
});

describe("QuestionDetection", () => {
  it("accepts a valid detection object", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "discovery",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts versioned exact negotiation provenance independently from QUD metadata", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "negotiation",
      purpose: "uptake",
      sourceType: "opportunity",
      sourceId: "opp-1",
      timestamp: new Date().toISOString(),
      underspecificationType: null,
      negotiation: {
        version: 1,
        purpose: "uptake",
        recipientUserId: "user-1",
        recipientIntentId: "intent-1",
        opportunityId: "opp-1",
        networkId: "network-1",
        counterpartyUserId: "user-2",
        counterpartyIntentId: "intent-2",
        counterpartyFelicityAuthority: 45,
        intentFingerprint: "fingerprint",
        opportunityStatus: "pending",
        opportunityUpdatedAt: new Date().toISOString(),
        questionOrdinal: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it("fails closed for legacy or mismatched negotiation detection", () => {
    const base = {
      mode: "negotiation_inflight" as const,
      purpose: "inflight_consultation" as const,
      sourceType: "opportunity",
      sourceId: "opp-1",
      timestamp: new Date().toISOString(),
    };
    expect(QuestionDetectionSchema.safeParse(base).success).toBe(false);
    const negotiation = {
      version: 1 as const,
      purpose: "inflight_consultation" as const,
      recipientUserId: "user-1",
      recipientIntentId: "intent-1",
      opportunityId: "opp-1",
      taskId: "task-1",
      networkId: "network-1",
      intentFingerprint: "fingerprint",
      opportunityStatus: "negotiating" as const,
      opportunityUpdatedAt: new Date().toISOString(),
      taskState: "input_required" as const,
      taskUpdatedAt: new Date().toISOString(),
      questionOrdinal: 0,
    };
    expect(QuestionDetectionSchema.safeParse({ ...base, negotiation }).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({ ...base, sourceId: "other-opp", negotiation }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, negotiation: { ...negotiation, taskId: undefined } }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, negotiation: { ...negotiation, taskState: "completed" } }).success).toBe(false);
  });

  it("accepts optional triggeredBy", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "intent",
      sourceType: "intent",
      sourceId: "abc-123",
      triggeredBy: "intent-456",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.triggeredBy).toBe("intent-456");
  });

  it("ties recovery metadata to exact ordinary intent provenance", () => {
    const base = {
      mode: "intent",
      purpose: "recovery",
      sourceType: "intent",
      sourceId: "intent-1",
      triggeredBy: "intent-1",
      timestamp: "2026-07-23T12:00:00.000Z",
      recovery: {
        version: 1,
        intentFingerprint: "a".repeat(64),
        completionSource: "discovery_run",
        rejectedNegotiationCount: 2,
        runId: "run-1",
      },
    };
    expect(QuestionDetectionSchema.safeParse(base).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({ ...base, mode: "discovery" }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, sourceType: "opportunity" }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, triggeredBy: "intent-2" }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, recovery: undefined }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, purpose: undefined }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      recovery: { ...base.recovery, rejectedNegotiationCount: 51 },
    }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      recovery: { ...base.recovery, completionSource: "intent_creation" },
    }).success).toBe(true);
  });

  it("accepts the complete internal proactive push ledger", () => {
    const push = {
      version: 1,
      source: "pool_discovery",
      recipientId: "user-1",
      intentId: "intent-1",
      cycleKey: "run:run-1",
      messageId: "question-1",
      surfaces: ["personal_agent_badge", "negotiator_dm"],
      claimedAt: "2026-07-16T12:00:00.000Z",
      deliveryStatus: "claimed",
    };
    expect(QuestionPoolPushSchema.safeParse(push).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({
      mode: "pool_discovery",
      sourceType: "intent",
      sourceId: "intent-1",
      triggeredBy: "intent-1",
      timestamp: "2026-07-16T12:00:00.000Z",
      pushRequestedAt: "2026-07-16T11:59:00.000Z",
      pushRecoveryAttemptedAt: "2026-07-16T11:59:30.000Z",
      pushRequestStatus: "requested",
      push,
      pushedAt: "2026-07-16T12:00:01.000Z",
    }).success).toBe(true);
  });

  it("requires pool intent identity to be explicit and exact", () => {
    const base = {
      mode: "pool_discovery",
      sourceType: "intent",
      sourceId: "intent-1",
      timestamp: "2026-07-16T12:00:00.000Z",
    };
    expect(QuestionDetectionSchema.safeParse(base).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, triggeredBy: "" }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, triggeredBy: "intent-2" }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({ ...base, triggeredBy: "intent-1" }).success).toBe(true);
  });

  it("accepts the internal recovery-attempt timestamp only as a non-empty string", () => {
    const base = {
      mode: "pool_discovery",
      sourceType: "intent",
      sourceId: "intent-1",
      triggeredBy: "intent-1",
      timestamp: "2026-07-16T12:00:00.000Z",
      pushRequestedAt: "2026-07-16T11:59:00.000Z",
      pushRequestStatus: "requested",
    };
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      pushRecoveryAttemptedAt: "2026-07-16T11:59:30.000Z",
    }).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      pushRecoveryAttemptedAt: "",
    }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      pushRequestedAt: undefined,
      pushRequestStatus: undefined,
      pushRecoveryAttemptedAt: "2026-07-16T11:59:30.000Z",
    }).success).toBe(false);
  });

  it("bounds suppressed request outcomes to permanent reasons with timestamps", () => {
    const base = {
      mode: "pool_discovery",
      sourceType: "intent",
      sourceId: "intent-1",
      triggeredBy: "intent-1",
      timestamp: "2026-07-16T12:00:00.000Z",
      pushRequestedAt: "2026-07-16T11:59:00.000Z",
      pushRequestStatus: "suppressed",
    };
    expect(QuestionPoolPushRequestReasonSchema.safeParse("visited").success).toBe(true);
    expect(QuestionPoolPushRequestReasonSchema.safeParse("database_unavailable").success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      pushRequestedAt: undefined,
      pushRequestStatus: "requested",
    }).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse(base).success).toBe(false);
    expect(QuestionDetectionSchema.safeParse({
      ...base,
      pushRequestReason: "visited",
      pushRequestSuppressedAt: "2026-07-16T12:00:01.000Z",
    }).success).toBe(true);
  });

  it("accepts only canonical internal void reasons", () => {
    expect(QuestionVoidedReasonSchema.safeParse("pool_drift").success).toBe(true);
    expect(QuestionVoidedReasonSchema.safeParse("intent_edit").success).toBe(true);
    expect(QuestionVoidedReasonSchema.safeParse("recovery_drift").success).toBe(true);
    expect(QuestionVoidedReasonSchema.safeParse("manual").success).toBe(false);

    const base = {
      mode: "pool_discovery",
      sourceType: "intent",
      sourceId: "intent-1",
      triggeredBy: "intent-1",
      timestamp: "2026-07-16T12:00:00.000Z",
    };
    expect(QuestionDetectionSchema.safeParse({ ...base, voidedReason: "pool_drift" }).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({ ...base, voidedReason: "intent_edit" }).success).toBe(true);
    expect(QuestionDetectionSchema.safeParse({ ...base, voidedReason: "manual" }).success).toBe(false);
  });

  it("rejects an invalid mode", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "invalid",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionActor", () => {
  it("accepts a minimal actor (userId + role only)", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBeUndefined();
  });

  it("accepts an actor with networkId", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      networkId: "net-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBe("net-1");
  });
});

describe("QuestionAnswer", () => {
  it("accepts a valid answer with selected options", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBeUndefined();
  });

  it("accepts an answer with freeText", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: [],
      freeText: "Custom answer",
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBe("Custom answer");
  });

  it("requires answeredBy", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionMode", () => {
  it.each(["discovery", "intent", "enrichment", "negotiation"])("accepts '%s'", (mode) => {
    const result = QuestionModeSchema.safeParse(mode);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mode", () => {
    const result = QuestionModeSchema.safeParse("unknown");
    expect(result.success).toBe(false);
  });
});
