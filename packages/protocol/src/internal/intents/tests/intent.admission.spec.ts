import { describe, expect, test } from "bun:test";

import { DecisionClient, type DecisionAnswer } from "../../shared/agent/decision.client.js";
import { admissionFromDecision, type AdmissionDecision } from "../intent.admission.js";
import { IntentPreparer } from "../intent.preparer.js";

function jevAnswers(speech = "directive", nouls: Record<string, number> = {}): Record<string, DecisionAnswer> {
  const scores = { too_vague: 0.1, too_broad: 0.1, role: 0.1, outcome: 0.1, location: 0.1, timeframe: 0.1, domain: 0.1, concrete_need: 0.1, ...nouls };
  return {
    speech_act: { type: "choice", choice: speech },
    ...Object.fromEntries(Object.entries(scores).map(([key, noul]) => [key, { type: "noul", noul }])),
  };
}

const open: AdmissionDecision = {
  speechAct: "directive",
  tooVague: 0.1,
  tooBroad: 0.1,
  constraints: { role: 0.1, outcome: 0.1, location: 0.1, timeframe: 0.1, domain: 0.1, concrete_need: 0.1 },
};

describe("admissionFromDecision", () => {
  test("a directive that is specific passes, and a noul under 0.8 is not missing", () => {
    const judged = admissionFromDecision({ ...open, constraints: { ...open.constraints, role: 0.79 } });
    expect(judged.failure).toBeUndefined();
    expect(judged.missing).toEqual([]);
  });

  test("other, then too vague, then too broad, and a noul at 0.8 is missing", () => {
    expect(admissionFromDecision({ ...open, speechAct: "other", tooVague: 0.9 }).failure?.category).toBe("non_actionable");
    expect(admissionFromDecision({ ...open, tooVague: 0.8, tooBroad: 0.9 }).failure?.message).toMatch(/more concrete/);
    const broad = admissionFromDecision({ ...open, tooBroad: 0.8, constraints: { ...open.constraints, location: 0.8 } });
    expect(broad.failure?.referentialBreadth).toBe("broad");
    expect(broad.missing).toEqual(["location"]);
  });
});

describe("IntentPreparer.check", () => {
  test("a passing read does not ask for question text", async () => {
    const preparer = new IntentPreparer({ invoke: async () => { throw new Error("verifier"); } }, { decide: async () => jevAnswers() });
    await expect(preparer.check({ payload: "looking for a cofounder in nyc this quarter" })).resolves.toEqual({ passed: true, missing: [], message: "" });
  });

  test("a broad draft names the missing constraint", async () => {
    const preparer = new IntentPreparer({ invoke: async () => { throw new Error("verifier"); } }, {
      decide: async () => jevAnswers("directive", { too_broad: 0.9, location: 0.91 }),
    });
    const check = await preparer.check({ payload: "meet people" });
    expect(check.passed).toBe(false);
    expect(check.missing).toEqual(["location"]);
    expect(check.message).toMatch(/broad/);
  });
});

describe("DecisionClient", () => {
  test("posts the pinned Jev model and reads typed answers", async () => {
    const original = globalThis.fetch;
    let body = "";
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({
        answers: {
          speech_act: { type: "choice", choice: "directive", probabilities: { directive: 1 }, confidence: 1 },
          too_vague: { type: "noul", noul: 0.2 },
        },
      }));
    }) as typeof fetch;
    try {
      const answers = await new DecisionClient("test-key").decide({ draft: "looking for a cofounder" }, {
        speech_act: { type: "choice", instructions: "act", criteria: { directive: "search" } },
        too_vague: { type: "noul", instructions: "vague" },
      });
      expect(JSON.parse(body).model).toBe("typesafe/jev-1.13");
      expect(answers.speech_act).toEqual({ type: "choice", choice: "directive" });
      expect(answers.too_vague).toEqual({ type: "noul", noul: 0.2 });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a missing key throws", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(new DecisionClient().decide({}, {})).rejects.toThrow(/OPENROUTER_API_KEY/);
    } finally {
      if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
    }
  });
});
