import { describe, expect, it } from "bun:test";

import { extractAllowlistedEvidence } from "../negotiation-evidence.extractor.js";
import type { EvidenceMiningScope, RawEvidenceSegment } from "../negotiation-evidence.types.js";

const SCOPE: EvidenceMiningScope = {
  recipientUserId: "owner-1",
  intentId: "intent-1",
  intentFingerprint: "fp-1",
  networkId: "net-1",
};

/** A fully-populated in-scope segment with one of every allowlisted source. */
function segment(overrides: Partial<RawEvidenceSegment> = {}): RawEvidenceSegment {
  return {
    recipientUserId: "owner-1",
    intentId: "intent-1",
    intentFingerprint: "fp-1",
    networkId: "net-1",
    opportunityId: "opp-1",
    taskId: "task-1",
    conversationId: "conv-1",
    counterpartyUserId: "cp-1",
    turns: [
      {
        senderUserId: "owner-1",
        action: "propose",
        message: "I only take equity deals",
        sharedTagged: true,
        reasoning: "SECRET_CHAIN_OF_THOUGHT should never surface",
        disclosureSubject: "SECRET_DISCLOSURE_SUBJECT should never surface",
      },
    ],
    outcome: {
      hasOpportunity: true,
      reason: "turn_cap",
      agreedRoles: [{ userId: "owner-1", role: "peer" }],
      reasoning: "SECRET_EVALUATOR_REASONING should never surface",
    },
    ownerAnswers: [{ answererUserId: "owner-1", selectedOptions: ["Async only"], freeText: "prefer remote" }],
    ...overrides,
  };
}

/** Concatenate all extracted evidence content for leakage assertions. */
function allContent(segments: RawEvidenceSegment[]): string {
  return extractAllowlistedEvidence(SCOPE, segments)
    .evidence.map((e) => e.content)
    .join("\n");
}

describe("extractAllowlistedEvidence — allowlist (positive)", () => {
  it("extracts owner answers, bilateral actions, coarse outcomes, and tagged shared messages", () => {
    const result = extractAllowlistedEvidence(SCOPE, [segment()]);
    expect(result.distinctOpportunities).toBe(1);
    expect(result.evidenceCounts).toEqual({
      owner_answer: 1,
      bilateral_action: 1,
      coarse_outcome: 1,
      shared_message: 1,
    });
    const owner = result.evidence.find((e) => e.kind === "owner_answer");
    expect(owner?.speaker).toBe("owner");
    expect(owner?.content).toContain("Async only");
    expect(result.evidence.find((e) => e.kind === "bilateral_action")?.speaker).toBe("system");
    expect(result.evidence.find((e) => e.kind === "shared_message")?.speaker).toBe("owner");
    // Every unit carries the pass provenance so downstream keying is exact.
    for (const e of result.evidence) {
      expect(e.recipientUserId).toBe("owner-1");
      expect(e.intentId).toBe("intent-1");
      expect(e.opportunityId).toBe("opp-1");
    }
  });

  it("labels a counterparty-sent shared message with the counterparty speaker", () => {
    const result = extractAllowlistedEvidence(SCOPE, [
      segment({
        turns: [{ senderUserId: "cp-1", action: "counter", message: "we prefer cash", sharedTagged: true }],
        outcome: null,
        ownerAnswers: [],
      }),
    ]);
    const shared = result.evidence.find((e) => e.kind === "shared_message");
    expect(shared?.speaker).toBe("counterparty");
  });
});

describe("extractAllowlistedEvidence — exclusions", () => {
  it("never surfaces chain-of-thought, disclosure subjects, or evaluator reasoning", () => {
    const content = allContent([segment()]);
    expect(content).not.toContain("SECRET_CHAIN_OF_THOUGHT");
    expect(content).not.toContain("SECRET_DISCLOSURE_SUBJECT");
    expect(content).not.toContain("SECRET_EVALUATOR_REASONING");
  });

  it("excludes untagged messages (only explicitly shared content is mined)", () => {
    const result = extractAllowlistedEvidence(SCOPE, [
      segment({
        turns: [{ senderUserId: "owner-1", action: "propose", message: "untagged private line" }],
        outcome: null,
        ownerAnswers: [],
      }),
    ]);
    expect(result.evidenceCounts.shared_message).toBe(0);
    expect(result.evidenceCounts.bilateral_action).toBe(1); // action still allowlisted
    expect(result.excludedRecords).toBeGreaterThanOrEqual(1);
    expect(result.evidence.some((e) => e.content.includes("untagged private line"))).toBe(false);
  });

  it("drops screened_out outcomes (private client gate) entirely", () => {
    const result = extractAllowlistedEvidence(SCOPE, [
      segment({
        turns: [],
        ownerAnswers: [],
        outcome: { hasOpportunity: false, reason: "screened_out" },
      }),
    ]);
    expect(result.evidenceCounts.coarse_outcome).toBe(0);
    expect(result.distinctOpportunities).toBe(0);
    expect(result.excludedRecords).toBeGreaterThanOrEqual(1);
  });

  it("rejects owner answers not authored by the recipient", () => {
    const result = extractAllowlistedEvidence(SCOPE, [
      segment({
        turns: [],
        outcome: null,
        ownerAnswers: [{ answererUserId: "cp-1", selectedOptions: ["counterparty answer"] }],
      }),
    ]);
    expect(result.evidenceCounts.owner_answer).toBe(0);
    expect(result.excludedRecords).toBeGreaterThanOrEqual(1);
  });

  it("rejects turns from a speaker who is neither owner nor counterparty", () => {
    const result = extractAllowlistedEvidence(SCOPE, [
      segment({
        turns: [{ senderUserId: "stranger-9", action: "counter", message: "leaked", sharedTagged: true }],
        outcome: null,
        ownerAnswers: [],
      }),
    ]);
    expect(result.evidenceCounts.bilateral_action).toBe(0);
    expect(result.evidenceCounts.shared_message).toBe(0);
    expect(result.excludedRecords).toBeGreaterThanOrEqual(1);
  });
});

describe("extractAllowlistedEvidence — contamination guards", () => {
  const mismatches: Array<[string, Partial<RawEvidenceSegment>]> = [
    ["recipient", { recipientUserId: "other-owner" }],
    ["intent", { intentId: "intent-2" }],
    ["fingerprint", { intentFingerprint: "fp-2" }],
    ["network", { networkId: "net-2" }],
  ];

  for (const [label, override] of mismatches) {
    it(`rejects a whole segment on ${label} mismatch`, () => {
      const result = extractAllowlistedEvidence(SCOPE, [segment(override)]);
      expect(result.distinctOpportunities).toBe(0);
      expect(result.evidence).toHaveLength(0);
      expect(result.excludedRecords).toBeGreaterThanOrEqual(1);
    });
  }

  it("rejects a self-negotiation (recipient === counterparty)", () => {
    const result = extractAllowlistedEvidence(SCOPE, [segment({ counterpartyUserId: "owner-1" })]);
    expect(result.distinctOpportunities).toBe(0);
    expect(result.evidence).toHaveLength(0);
  });
});

describe("extractAllowlistedEvidence — continuation grouping", () => {
  it("groups continuation segments of one opportunity and dedupes repeated content", () => {
    const cont1 = segment({ taskId: "task-1" });
    const cont2 = segment({ taskId: "task-2" }); // same opportunityId, identical content
    const result = extractAllowlistedEvidence(SCOPE, [cont1, cont2]);
    // One opportunity, deduped: identical evidence must not double-count.
    expect(result.distinctOpportunities).toBe(1);
    expect(result.evidenceCounts).toEqual({
      owner_answer: 1,
      bilateral_action: 1,
      coarse_outcome: 1,
      shared_message: 1,
    });
    expect(result.evidence.every((e) => e.taskId === "task-1")).toBe(true);
  });

  it("preserves each accepted continuation unit's exact task and conversation provenance", () => {
    const cont1 = segment({
      taskId: "task-1",
      conversationId: "conv-1",
      turns: [{ senderUserId: "owner-1", action: "propose" }],
      outcome: null,
      ownerAnswers: [],
    });
    const cont2 = segment({
      taskId: "task-2",
      conversationId: "conv-2",
      turns: [{ senderUserId: "cp-1", action: "counter" }],
      outcome: null,
      ownerAnswers: [],
    });
    const result = extractAllowlistedEvidence(SCOPE, [cont1, cont2]);

    expect(result.distinctOpportunities).toBe(1);
    expect(result.evidence.find((e) => e.content === "propose")).toMatchObject({
      taskId: "task-1",
      conversationId: "conv-1",
    });
    expect(result.evidence.find((e) => e.content === "counter")).toMatchObject({
      taskId: "task-2",
      conversationId: "conv-2",
    });
  });

  it("a single opportunity contributes at most one distinct-opportunity unit no matter how many continuations", () => {
    const conts = Array.from({ length: 6 }, (_, i) =>
      segment({ taskId: `task-${i}`, turns: [{ senderUserId: "owner-1", action: "counter" }], outcome: null, ownerAnswers: [] }),
    );
    const result = extractAllowlistedEvidence(SCOPE, conts);
    expect(result.distinctOpportunities).toBe(1);
    expect(result.evidenceCounts.bilateral_action).toBe(1); // "counter" deduped across all continuations
  });
});
