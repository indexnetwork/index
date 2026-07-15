import { describe, expect, it } from "bun:test";

import { CASES } from "../clarification.cases.js";
import { runCase } from "../clarification.runner.js";
import { scoreCase } from "../clarification.scorer.js";
import type { ClarifierLike } from "../clarification.types.js";

const baseOutput = {
  needsClarification: true as const,
  reason: "test",
  suggestedDescription: "specific intent",
  clarificationMessage: "Did you mean this?",
  underspecificationType: "missing_constituent" as const,
};

describe("clarification corpus", () => {
  it("covers all exact taxonomy values plus null", () => {
    expect(new Set(CASES.map((c) => c.expectedType))).toEqual(new Set([
      "missing_constituent",
      "missing_constraint",
      "open_alternative_set",
      null,
    ]));
  });
});

describe("clarification scorer", () => {
  it("passes only an exact type match", () => {
    const c = CASES[0];
    expect(scoreCase(c, baseOutput).passed).toBe(true);
    expect(scoreCase(c, {
      ...baseOutput,
      underspecificationType: "missing_constraint",
    }).passed).toBe(false);
  });

  it("exact-matches null for sufficiently specific inputs", () => {
    const c = CASES.find((candidate) => candidate.expectedType === null)!;
    const output = {
      needsClarification: false as const,
      reason: "specific",
      suggestedDescription: null,
      clarificationMessage: null,
      underspecificationType: null,
    };
    expect(scoreCase(c, output).passed).toBe(true);
  });

  it("does not count the model-error fallback as a correct null classification", () => {
    const c = CASES.find((candidate) => candidate.expectedType === null)!;
    const fallback = {
      needsClarification: false as const,
      reason: "fallback_on_model_error",
      suggestedDescription: null,
      clarificationMessage: null,
      underspecificationType: null,
    };
    expect(scoreCase(c, fallback).passed).toBe(false);
  });

  it("requires the clarification decision to agree with the expected type", () => {
    const c = CASES[0];
    const contradictory = {
      needsClarification: false as const,
      reason: "specific",
      suggestedDescription: null,
      clarificationMessage: null,
      underspecificationType: null,
    };
    expect(scoreCase(c, contradictory).passed).toBe(false);
  });

  it("requires non-empty clarification content", () => {
    const c = CASES[0];
    const incomplete = {
      ...baseOutput,
      suggestedDescription: "",
      clarificationMessage: "",
    };
    expect(scoreCase(c, incomplete).passed).toBe(false);
  });

  it("requires open-alternative questions to name the fixture alternatives", () => {
    const c = CASES.find((candidate) => candidate.expectedType === "open_alternative_set")!;
    const generic = {
      ...baseOutput,
      underspecificationType: "open_alternative_set" as const,
      clarificationMessage: "Which option do you prefer?",
    };
    expect(scoreCase(c, generic).passed).toBe(false);
    expect(scoreCase(c, {
      ...generic,
      clarificationMessage: "Do you need a technical co-founder or a channel partner?",
    }).passed).toBe(true);
  });
});

describe("clarification runner", () => {
  it("passes fixture context to the clarifier", async () => {
    let args: string[] = [];
    const clarifier: ClarifierLike = {
      invoke: async (...values) => {
        args = values;
        return baseOutput;
      },
    };
    await runCase(clarifier, CASES[0]);
    expect(args).toEqual([
      CASES[0].input,
      CASES[0].profileContext,
      CASES[0].activeIntentsContext,
    ]);
  });
});
