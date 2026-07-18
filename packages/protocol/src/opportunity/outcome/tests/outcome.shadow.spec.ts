import { describe, expect, it } from "bun:test";

import { deduplicateOutcomeExamples, runOutcomeShadow } from "../outcome.shadow.js";
import type { OutcomeExample } from "../outcome.types.js";
import type { DiscriminatorMiningInput, MinedDiscriminator } from "../../discriminator/discriminator.types.js";

function example(
  id: string,
  label: "accepted" | "rejected",
  dedupKey: string,
  occurredAt: string,
): OutcomeExample {
  return { opportunityId: id, publicContext: `ctx ${id}`, label, dedupKey, occurredAt };
}

/** Miner that records what it saw and assigns first half "A", rest "B". */
function recordingMiner(splitAt: number) {
  const seen: DiscriminatorMiningInput[] = [];
  const mine = async (input: DiscriminatorMiningInput): Promise<MinedDiscriminator[]> => {
    seen.push(input);
    return [{
      label: "axis",
      questionSeed: "q",
      sides: ["A", "B"],
      assignments: input.candidates.map((c, i) => ({
        id: c.id,
        side: i < splitAt ? "A" : "B",
        evidence: "ev",
        verified: true,
      })),
      evidenceRate: 1,
    }];
  };
  return { mine, seen };
}

describe("deduplicateOutcomeExamples", () => {
  it("keeps one most-recent representative per dedup key (related-opp dedup)", () => {
    const examples = [
      example("o1", "accepted", "k1", "2026-01-01T00:00:00.000Z"),
      example("o2", "rejected", "k1", "2026-01-02T00:00:00.000Z"), // newer, same counterpart
      example("o3", "accepted", "k2", "2026-01-01T00:00:00.000Z"),
    ];
    const deduped = deduplicateOutcomeExamples(examples);
    expect(deduped.map((e) => e.opportunityId)).toEqual(["o2", "o3"]);
  });
});

describe("runOutcomeShadow", () => {
  it("returns empty below the k x minComparedSides independent floor", async () => {
    const miner = recordingMiner(4);
    // 8 distinct keys < 10 floor.
    const examples = Array.from({ length: 8 }, (_, i) =>
      example(`o${i}`, i % 2 ? "accepted" : "rejected", `k${i}`, `2026-01-0${(i % 9) + 1}T00:00:00.000Z`),
    );
    const result = await runOutcomeShadow({ intentText: "intent", examples, miner });
    expect(result.eligibleCount).toBe(0);
    expect(miner.seen.length).toBe(0); // never invoked the LLM below the floor
  });

  it("assigns candidates BLIND to outcome (miner input carries no label)", async () => {
    const miner = recordingMiner(5);
    const examples = [
      ...Array.from({ length: 5 }, (_, i) => example(`a${i}`, "accepted", `ka${i}`, "2026-01-01T00:00:00.000Z")),
      ...Array.from({ length: 5 }, (_, i) => example(`b${i}`, "rejected", `kb${i}`, "2026-01-02T00:00:00.000Z")),
    ];
    await runOutcomeShadow({ intentText: "intent", examples, miner });

    expect(miner.seen.length).toBe(1);
    const passed = miner.seen[0].candidates;
    expect(passed.length).toBe(10);
    const rawOpportunityIds = new Set(examples.map((item) => item.opportunityId));
    // The classifier never receives outcome information OR raw opportunity ids.
    // Candidate ids are deterministic run-local aliases only.
    for (const [index, c] of passed.entries()) {
      expect(c.id).toBe(`c${index}`);
      expect(rawOpportunityIds.has(c.id)).toBe(false);
      expect(JSON.stringify(c)).not.toContain("accepted");
      expect(JSON.stringify(c)).not.toContain("rejected");
      expect(Object.keys(c).sort()).toEqual(["id", "publicContext", "score"]);
    }
  });

  it("joins outcomes after assignment and thresholds by k", async () => {
    const miner = recordingMiner(6); // 6 on A, 6 on B
    const examples = [
      ...Array.from({ length: 6 }, (_, i) => example(`a${i}`, i < 4 ? "accepted" : "rejected", `ka${i}`, "2026-01-01T00:00:00.000Z")),
      ...Array.from({ length: 6 }, (_, i) => example(`b${i}`, i < 1 ? "accepted" : "rejected", `kb${i}`, "2026-01-02T00:00:00.000Z")),
    ];
    const result = await runOutcomeShadow({ intentText: "intent", examples, miner });
    expect(result.eligibleCount).toBe(1);
    const sides = result.hypotheses[0].sides;
    expect(sides.every((s) => s.independentSupport >= 5)).toBe(true);
  });
});
