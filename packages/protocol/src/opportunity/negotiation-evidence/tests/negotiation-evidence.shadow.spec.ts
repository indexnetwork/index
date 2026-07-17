import { describe, expect, it } from "bun:test";

import { runNegotiationEvidenceShadow } from "../negotiation-evidence.shadow.js";
import type { NegotiationEvidenceMiner } from "../negotiation-evidence.miner.js";
import type { AllowlistedEvidence, EvidenceMiningScope, MinedEvidenceHypothesis, RawEvidenceSegment } from "../negotiation-evidence.types.js";

const SCOPE: EvidenceMiningScope = {
  recipientUserId: "owner-1",
  intentId: "intent-1",
  intentFingerprint: "fp-1",
  networkId: "net-1",
};

/** One in-scope segment per opportunity, all quoting "equity only". */
function segmentFor(opportunityId: string): RawEvidenceSegment {
  return {
    recipientUserId: "owner-1",
    intentId: "intent-1",
    intentFingerprint: "fp-1",
    networkId: "net-1",
    opportunityId,
    taskId: `task-${opportunityId}`,
    conversationId: `conv-${opportunityId}`,
    counterpartyUserId: `cp-${opportunityId}`,
    turns: [
      {
        senderUserId: "owner-1",
        action: "propose",
        message: "equity only, no cash",
        sharedTagged: true,
        reasoning: "SECRET_REASONING",
        disclosureSubject: "SECRET_DISCLOSURE",
      },
    ],
    outcome: { hasOpportunity: true, reason: "turn_cap", reasoning: "SECRET_EVAL" },
    ownerAnswers: [],
  };
}

/** Records what the miner was asked, and returns a scripted hypothesis set. */
class FakeMiner implements Pick<NegotiationEvidenceMiner, "mine"> {
  calls = 0;
  lastEvidence: AllowlistedEvidence[] = [];
  constructor(private readonly script: (evidence: AllowlistedEvidence[]) => MinedEvidenceHypothesis[]) {}
  async mine(evidence: AllowlistedEvidence[]): Promise<MinedEvidenceHypothesis[]> {
    this.calls += 1;
    this.lastEvidence = evidence;
    return this.script(evidence);
  }
}

describe("runNegotiationEvidenceShadow", () => {
  it("never calls the miner when below the distinct-opportunity floor", async () => {
    const miner = new FakeMiner(() => []);
    const result = await runNegotiationEvidenceShadow({
      scope: SCOPE,
      segments: [segmentFor("opp-0"), segmentFor("opp-1")], // only 2 distinct < 5
      miner,
    });
    expect(miner.calls).toBe(0);
    expect(result.telemetry.hypothesesMined).toBe(0);
    expect(result.hypotheses).toHaveLength(0);
    expect(result.telemetry.distinctOpportunities).toBe(2);
  });

  it("mines, verifies, and recurrence-gates across k distinct opportunities", async () => {
    const segments = Array.from({ length: 5 }, (_, i) => segmentFor(`opp-${i}`));
    const miner = new FakeMiner((evidence) => [
      {
        statement: "Owner prefers equity",
        claimType: "recipient_preference",
        supportRefs: evidence
          .filter((e) => e.kind === "shared_message")
          .map((e) => ({ evidenceId: e.evidenceId, span: "equity only" })),
      },
    ]);
    const result = await runNegotiationEvidenceShadow({ scope: SCOPE, segments, miner });
    expect(miner.calls).toBe(1);
    expect(result.telemetry.distinctOpportunities).toBe(5);
    expect(result.telemetry.hypothesesRecurrent).toBe(1);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0].distinctOpportunities).toBe(5);
  });

  it("passes ONLY allowlisted evidence to the miner (no reasoning/disclosure leakage)", async () => {
    const segments = Array.from({ length: 5 }, (_, i) => segmentFor(`opp-${i}`));
    const miner = new FakeMiner(() => []);
    await runNegotiationEvidenceShadow({ scope: SCOPE, segments, miner });
    const serialized = JSON.stringify(miner.lastEvidence);
    expect(serialized).not.toContain("SECRET_REASONING");
    expect(serialized).not.toContain("SECRET_DISCLOSURE");
    expect(serialized).not.toContain("SECRET_EVAL");
  });

  it("emits aggregate-only telemetry (counts, no hypothesis text or spans)", async () => {
    const segments = Array.from({ length: 5 }, (_, i) => segmentFor(`opp-${i}`));
    const miner = new FakeMiner((evidence) => [
      {
        statement: "PRIVATE_HYPOTHESIS_TEXT",
        claimType: "observation",
        supportRefs: evidence.slice(0, 5).map((e) => ({ evidenceId: e.evidenceId, span: "equity only" })),
      },
    ]);
    const result = await runNegotiationEvidenceShadow({ scope: SCOPE, segments, miner });
    const telemetryJson = JSON.stringify(result.telemetry);
    // Telemetry is safe to log: it must carry no hypothesis text and no spans.
    expect(telemetryJson).not.toContain("PRIVATE_HYPOTHESIS_TEXT");
    expect(telemetryJson).not.toContain("equity only");
    expect(Object.keys(result.telemetry).sort()).toEqual(
      [
        "distinctOpportunities",
        "evidenceCounts",
        "excludedRecords",
        "hypothesesDiscarded",
        "hypothesesMined",
        "hypothesesRecurrent",
        "hypothesesSupported",
        "intentId",
        "recipientUserId",
        "segments",
      ].sort(),
    );
  });
});
