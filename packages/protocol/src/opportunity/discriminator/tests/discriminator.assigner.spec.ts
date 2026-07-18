import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY ??= "test";

import { describe, expect, it } from "bun:test";

import { PoolDiscriminatorAssigner, buildAssignmentPrompt } from "../discriminator.assigner.js";
import type { PoolDiscriminatorAssignmentInput } from "../discriminator.assigner.js";

const input: PoolDiscriminatorAssignmentInput = {
  axes: [
    { questionId: "q-1", label: "Working style", sides: ["Hands-on", "Advisory"] },
    { questionId: "q-2", label: "Stage", sides: ["Early", "Growth"] },
  ],
  candidates: [
    { id: "newborn-0", publicContext: "Bio: Hands-on engineer for early prototypes", score: 0.9 },
    { id: "newborn-1", publicContext: "Bio: Advisory operator scaling growth companies", score: 0.8 },
  ],
};

function makeAssigner(invoke: (input: unknown) => Promise<unknown>): PoolDiscriminatorAssigner {
  const assigner = new PoolDiscriminatorAssigner();
  (assigner as unknown as { model: { invoke: typeof invoke } }).model = { invoke };
  return assigner;
}

describe("PoolDiscriminatorAssigner", () => {
  it("batches fixed axes and candidates without exposing a chosen side", async () => {
    let messages: unknown;
    const assigner = makeAssigner(async (modelInput: unknown) => {
      messages = modelInput;
      return { axes: [] };
    });
    await assigner.assign(input);
    const prompt = buildAssignmentPrompt(input);
    expect(prompt).toContain("q-1");
    expect(prompt).toContain("newborn-1");
    expect(prompt).not.toContain("chosenSide");
    expect(messages).toBeDefined();
  });

  it("accepts fixed IDs, allowed sides, and normalized verbatim evidence", async () => {
    const assigner = makeAssigner(async () => ({
      axes: [
        {
          questionId: "q-1",
          assignments: [
            { candidateId: "newborn-0", side: "Hands-on", evidence: "hands-on   engineer" },
            { candidateId: "newborn-1", side: "Advisory", evidence: "Advisory operator" },
          ],
        },
        {
          questionId: "q-2",
          assignments: [
            { candidateId: "newborn-0", side: "Early", evidence: "early prototypes" },
            { candidateId: "newborn-1", side: "Growth", evidence: "growth companies" },
          ],
        },
      ],
    }));
    const result = await assigner.assign(input);
    expect(result).toHaveLength(2);
    expect(result[0].assignments).toEqual([
      { candidateId: "newborn-0", side: "Hands-on", evidence: "hands-on   engineer" },
      { candidateId: "newborn-1", side: "Advisory", evidence: "Advisory operator" },
    ]);
  });

  it("drops hallucinated IDs and demotes hallucinated sides or evidence to unknown", async () => {
    const assigner = makeAssigner(async () => ({
      axes: [{
        questionId: "q-1",
        assignments: [
          { candidateId: "invented", side: "Hands-on", evidence: "anything" },
          { candidateId: "newborn-0", side: "Invented side", evidence: "Hands-on engineer" },
          { candidateId: "newborn-1", side: "Advisory", evidence: "invented evidence" },
        ],
      }],
    }));
    expect((await assigner.assign(input))[0].assignments).toEqual([
      { candidateId: "newborn-0", side: null, evidence: null },
      { candidateId: "newborn-1", side: null, evidence: null },
    ]);
  });

  it("rejects trivial matching substrings as insufficient evidence", async () => {
    const assigner = makeAssigner(async () => ({
      axes: [{
        questionId: "q-1",
        assignments: [{ candidateId: "newborn-0", side: "Hands-on", evidence: "a" }],
      }],
    }));
    expect((await assigner.assign(input))[0].assignments[0]).toEqual({
      candidateId: "newborn-0",
      side: null,
      evidence: null,
    });
  });

  it("preserves explicit unknown and fills a missing candidate as unknown", async () => {
    const assigner = makeAssigner(async () => ({
      axes: [{
        questionId: "q-1",
        assignments: [{ candidateId: "newborn-0", side: null, evidence: null }],
      }],
    }));
    expect((await assigner.assign(input))[0].assignments).toEqual([
      { candidateId: "newborn-0", side: null, evidence: null },
      { candidateId: "newborn-1", side: null, evidence: null },
    ]);
  });

  it("skips missing, malformed, duplicate, and hallucinated axes without blanket unknowns", async () => {
    const assigner = makeAssigner(async () => ({
      axes: [
        { questionId: "q-1", assignments: [] },
        { questionId: "q-1", assignments: [] },
        { questionId: "q-2", nonsense: true },
        { questionId: "q-999", assignments: [] },
      ],
    }));
    const result = await assigner.assign(input);
    expect(result.map((axis) => axis.questionId)).toEqual(["q-1"]);
  });

  it("fails open when the outer structured response is invalid", async () => {
    const assigner = makeAssigner(async () => ({ axes: "invalid" }));
    expect(await assigner.assign(input)).toEqual([]);
  });

  it("propagates provider failure for host-level fail-open handling", async () => {
    const assigner = makeAssigner(async () => { throw new Error("provider down"); });
    await expect(assigner.assign(input)).rejects.toThrow("provider down");
  });
});
