import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";

import { PoolDiscriminatorMiner, buildMiningPrompt, verifyAxis } from "../discriminator.miner.js";
import type { PoolCandidate } from "../discriminator.types.js";

const candidates: PoolCandidate[] = [
  { id: "opp-1", publicContext: "Name: Ada. Bio: Hands-on Rust engineer shipping embedded firmware.", score: 0.9 },
  { id: "opp-2", publicContext: "Name: Grace. Bio: Fractional CTO advising early-stage teams.", score: 0.7 },
  { id: "opp-3", publicContext: "Name: Alan. Bio: Researcher exploring formal verification.", score: 0.5 },
];

function rawAxis(assignments: Array<{ id: string; side: string | null; evidence: string | null }>) {
  return {
    axis: "Builders vs advisors",
    questionSeed: "Do you want someone hands-on or advisory?",
    sides: ["Hands-on builder", "Advisor"],
    assignments,
  };
}

describe("verifyAxis", () => {
  it("keeps assignments whose evidence substring-matches the candidate context", () => {
    const verified = verifyAxis(
      rawAxis([
        { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer" },
        { id: "opp-2", side: "Advisor", evidence: "Fractional CTO advising" },
        { id: "opp-3", side: null, evidence: null },
      ]),
      candidates,
    );
    expect(verified.assignments).toEqual([
      { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer", verified: true },
      { id: "opp-2", side: "Advisor", evidence: "Fractional CTO advising", verified: true },
      { id: "opp-3", side: null, evidence: null, verified: false },
    ]);
    expect(verified.evidenceRate).toBe(1);
  });

  it("demotes hallucinated evidence to unknown and reflects it in evidenceRate", () => {
    const verified = verifyAxis(
      rawAxis([
        { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer" },
        { id: "opp-2", side: "Advisor", evidence: "loves whiteboard strategy sessions" }, // not in context
        { id: "opp-3", side: "Advisor", evidence: null }, // side without evidence
      ]),
      candidates,
    );
    const byId = new Map(verified.assignments.map((a) => [a.id, a]));
    expect(byId.get("opp-1")?.verified).toBe(true);
    expect(byId.get("opp-2")).toEqual({
      id: "opp-2",
      side: null,
      evidence: "loves whiteboard strategy sessions",
      verified: false,
    });
    expect(byId.get("opp-3")?.side).toBeNull();
    expect(verified.evidenceRate).toBeCloseTo(1 / 3, 6);
  });

  it("matches evidence case- and whitespace-insensitively", () => {
    const verified = verifyAxis(
      rawAxis([
        { id: "opp-1", side: "Hands-on builder", evidence: "hands-on   RUST\nengineer" },
      ]),
      candidates,
    );
    expect(verified.assignments.find((a) => a.id === "opp-1")?.verified).toBe(true);
  });

  it("tolerates sentence-ized spans: trailing period / wrapping quotes added by the LLM", () => {
    // Source continues with a comma: "...shipping embedded firmware." — the
    // model habitually appends terminal punctuation to copied spans.
    const verified = verifyAxis(
      rawAxis([
        { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer shipping embedded firmware." },
        { id: "opp-2", side: "Advisor", evidence: "\"Fractional CTO advising early-stage teams\"." },
      ]),
      candidates,
    );
    expect(verified.assignments.find((a) => a.id === "opp-1")?.verified).toBe(true);
    expect(verified.assignments.find((a) => a.id === "opp-2")?.verified).toBe(true);
    expect(verified.evidenceRate).toBe(1);
  });

  it("folds typographic punctuation (curly apostrophes) on both sides", () => {
    const curly: PoolCandidate[] = [
      { id: "opp-c", publicContext: "Name: Ashley O\u2019Brien. Bio: co\u2011founder \u2014 systems thinker", score: 0.5 },
    ];
    const verified = verifyAxis(
      {
        axis: "a",
        questionSeed: "q",
        sides: ["X", "Y"],
        assignments: [{ id: "opp-c", side: "X", evidence: "Ashley O'Brien" }],
      },
      curly,
    );
    expect(verified.assignments[0].verified).toBe(true);
  });

  it("still rejects evidence that is only punctuation after stripping", () => {
    const verified = verifyAxis(
      rawAxis([{ id: "opp-1", side: "Hands-on builder", evidence: "\"...\"" }]),
      candidates,
    );
    expect(verified.assignments.find((a) => a.id === "opp-1")?.verified).toBe(false);
    expect(verified.evidenceRate).toBe(0);
  });

  it("demotes sides that are not in the axis side list", () => {
    const verified = verifyAxis(
      rawAxis([{ id: "opp-1", side: "Mentor", evidence: "Hands-on Rust engineer" }]),
      candidates,
    );
    expect(verified.assignments.find((a) => a.id === "opp-1")?.side).toBeNull();
    expect(verified.evidenceRate).toBe(0);
  });

  it("drops hallucinated candidate ids and fills missing candidates as unknown", () => {
    const verified = verifyAxis(
      rawAxis([
        { id: "opp-999", side: "Advisor", evidence: "anything" },
        { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer" },
      ]),
      candidates,
    );
    expect(verified.assignments).toHaveLength(3);
    expect(verified.assignments.map((a) => a.id).sort()).toEqual(["opp-1", "opp-2", "opp-3"]);
    expect(verified.assignments.find((a) => a.id === "opp-2")).toEqual({
      id: "opp-2",
      side: null,
      evidence: null,
      verified: false,
    });
  });

  it("has evidenceRate 0 when the LLM proposes no sides", () => {
    const verified = verifyAxis(
      rawAxis(candidates.map((c) => ({ id: c.id, side: null, evidence: null }))),
      candidates,
    );
    expect(verified.evidenceRate).toBe(0);
    expect(verified.assignments.every((a) => a.side === null)).toBe(true);
  });
});

describe("buildMiningPrompt", () => {
  it("includes the intent text and every candidate id + context verbatim", () => {
    const prompt = buildMiningPrompt({ intentText: "find a cofounder", candidates });
    expect(prompt).toContain("find a cofounder");
    for (const c of candidates) {
      expect(prompt).toContain(`[${c.id}]`);
      expect(prompt).toContain(c.publicContext);
    }
  });
});

describe("PoolDiscriminatorMiner.mine", () => {
  function makeMiner(invokeImpl: (input: unknown) => Promise<unknown>): PoolDiscriminatorMiner {
    const miner = new PoolDiscriminatorMiner();
    // Swap the internal model for a mock, same pattern as questioner.agent.spec.ts
    (miner as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
    return miner;
  }

  it("returns verified axes from a valid LLM response", async () => {
    const miner = makeMiner(async () => ({
      axes: [
        rawAxis([
          { id: "opp-1", side: "Hands-on builder", evidence: "Hands-on Rust engineer" },
          { id: "opp-2", side: "Advisor", evidence: "made-up quote" },
          { id: "opp-3", side: null, evidence: null },
        ]),
      ],
    }));
    const axes = await miner.mine({ intentText: "find a cofounder", candidates });
    expect(axes).toHaveLength(1);
    expect(axes[0].evidenceRate).toBeCloseTo(0.5, 6);
    expect(axes[0].assignments.filter((a) => a.verified)).toHaveLength(1);
  });

  it("returns [] when the response fails schema validation", async () => {
    const miner = makeMiner(async () => ({ axes: [{ nonsense: true }] }));
    const axes = await miner.mine({ intentText: "x", candidates });
    expect(axes).toEqual([]);
  });

  it("propagates LLM errors to the caller (fire-and-forget catches upstream)", async () => {
    const miner = makeMiner(async () => {
      throw new Error("provider down");
    });
    await expect(miner.mine({ intentText: "x", candidates })).rejects.toThrow("provider down");
  });
});
