import { describe, expect, it } from "bun:test";

import { evidenceSpanMatches, verifyHypotheses } from "../negotiation-evidence.verifier.js";
import type { AllowlistedEvidence, MinedEvidenceHypothesis } from "../negotiation-evidence.types.js";

/** Build one allowlisted evidence unit tied to a given opportunity/speaker. */
function ev(
  ordinal: number,
  opportunityId: string,
  content: string,
  speaker: AllowlistedEvidence["speaker"] = "owner",
  kind: AllowlistedEvidence["kind"] = "owner_answer",
): AllowlistedEvidence {
  return {
    evidenceId: `${kind}:${opportunityId}:${ordinal}`,
    kind,
    speaker,
    content,
    recipientUserId: "owner-1",
    intentId: "intent-1",
    intentFingerprint: "fp-1",
    opportunityId,
    taskId: `task-${opportunityId}`,
    conversationId: `conv-${opportunityId}`,
    networkId: "net-1",
  };
}

/** Evidence spanning 5 distinct opportunities, all quoting "equity only". */
function fiveOpportunityEvidence(speaker: AllowlistedEvidence["speaker"] = "owner"): AllowlistedEvidence[] {
  return Array.from({ length: 5 }, (_, i) => ev(0, `opp-${i}`, "equity only, no cash", speaker));
}

function hypothesis(evidence: AllowlistedEvidence[], claimType: MinedEvidenceHypothesis["claimType"]): MinedEvidenceHypothesis {
  return {
    statement: "Owner prefers equity compensation",
    claimType,
    supportRefs: evidence.map((e) => ({ evidenceId: e.evidenceId, span: "equity only" })),
  };
}

const K = 5;

describe("evidenceSpanMatches", () => {
  it("matches a verbatim substring tolerant of case/punctuation", () => {
    expect(evidenceSpanMatches("I only take EQUITY deals", "equity deals")).toBe(true);
    expect(evidenceSpanMatches("I only take equity deals", '"equity deals".')).toBe(true);
  });

  it("rejects paraphrase and too-short spans", () => {
    expect(evidenceSpanMatches("I only take equity deals", "loves equity compensation")).toBe(false);
    expect(evidenceSpanMatches("I only take equity deals", "eq")).toBe(false);
  });
});

describe("verifyHypotheses — support resolution", () => {
  it("retains a hypothesis whose every ref resolves and recurs across k opportunities", () => {
    const evidence = fiveOpportunityEvidence();
    const result = verifyHypotheses([hypothesis(evidence, "recipient_preference")], evidence, K);
    expect(result.supported).toBe(1);
    expect(result.recurrent).toBe(1);
    expect(result.retained).toHaveLength(1);
    expect(result.retained[0].distinctOpportunities).toBe(5);
  });

  it("discards a hypothesis with any reference to a non-allowlisted evidence id", () => {
    const evidence = fiveOpportunityEvidence();
    const hyp = hypothesis(evidence, "recipient_preference");
    hyp.supportRefs.push({ evidenceId: "hallucinated:opp-x:0", span: "equity only" });
    const result = verifyHypotheses([hyp], evidence, K);
    expect(result.supported).toBe(0);
    expect(result.retained).toHaveLength(0);
  });

  it("discards a hypothesis whose span is not a verbatim substring", () => {
    const evidence = fiveOpportunityEvidence();
    const hyp = hypothesis(evidence, "observation");
    hyp.supportRefs[0] = { evidenceId: evidence[0].evidenceId, span: "totally invented span" };
    const result = verifyHypotheses([hyp], evidence, K);
    expect(result.supported).toBe(0);
  });

  it("discards a hypothesis with no support references", () => {
    const evidence = fiveOpportunityEvidence();
    const result = verifyHypotheses(
      [{ statement: "unfounded", claimType: "observation", supportRefs: [] }],
      evidence,
      K,
    );
    expect(result.supported).toBe(0);
  });
});

describe("verifyHypotheses — speaker constraint", () => {
  it("forbids counterparty statements from establishing a fact/preference about the recipient", () => {
    const evidence = fiveOpportunityEvidence("counterparty");
    for (const claimType of ["recipient_fact", "recipient_preference"] as const) {
      const result = verifyHypotheses([hypothesis(evidence, claimType)], evidence, K);
      expect(result.supported).toBe(0);
      expect(result.retained).toHaveLength(0);
    }
  });

  it("allows counterparty statements to support an observation", () => {
    const evidence = fiveOpportunityEvidence("counterparty");
    const result = verifyHypotheses([hypothesis(evidence, "observation")], evidence, K);
    expect(result.recurrent).toBe(1);
    expect(result.retained).toHaveLength(1);
  });

  it("allows system (bilateral) evidence to support a recipient claim", () => {
    const evidence = Array.from({ length: 5 }, (_, i) =>
      ev(0, `opp-${i}`, "hasOpportunity=true reason=turn_cap", "system", "coarse_outcome"),
    );
    const hyp: MinedEvidenceHypothesis = {
      statement: "Owner reliably reaches agreement",
      claimType: "recipient_fact",
      supportRefs: evidence.map((e) => ({ evidenceId: e.evidenceId, span: "hasOpportunity=true" })),
    };
    const result = verifyHypotheses([hyp], evidence, K);
    expect(result.recurrent).toBe(1);
  });
});

describe("verifyHypotheses — recurrence gate (contamination-proof)", () => {
  it("rejects support that repeats within the SAME opportunity (below distinct floor)", () => {
    // 5 refs, but all point at the same opportunity → 1 distinct → discarded.
    const sameOpp = Array.from({ length: 5 }, (_, i) => ev(i, "opp-single", "equity only, no cash"));
    const result = verifyHypotheses([hypothesis(sameOpp, "recipient_preference")], sameOpp, K);
    expect(result.supported).toBe(1); // refs resolve...
    expect(result.recurrent).toBe(0); // ...but recurrence across distinct opportunities fails
    expect(result.retained).toHaveLength(0);
  });

  it("rejects when distinct opportunities is one short of the floor", () => {
    const fourOpps = Array.from({ length: 4 }, (_, i) => ev(0, `opp-${i}`, "equity only, no cash"));
    const result = verifyHypotheses([hypothesis(fourOpps, "recipient_preference")], fourOpps, K);
    expect(result.recurrent).toBe(0);
  });

  it("counts distinct opportunities in discarded telemetry", () => {
    const evidence = fiveOpportunityEvidence();
    const good = hypothesis(evidence, "observation");
    const bad: MinedEvidenceHypothesis = { statement: "x", claimType: "observation", supportRefs: [] };
    const result = verifyHypotheses([good, bad], evidence, K);
    expect(result.discarded).toBe(1); // 2 mined − 1 recurrent
  });
});
