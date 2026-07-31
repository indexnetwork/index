import { afterEach, describe, expect, it } from "bun:test";

import { getModelName } from "../model.config.js";

const ORIGINAL_OVERRIDES = process.env.EVAL_MODEL_OVERRIDES;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_OVERRIDES === undefined) delete process.env.EVAL_MODEL_OVERRIDES;
  else process.env.EVAL_MODEL_OVERRIDES = ORIGINAL_OVERRIDES;
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("EVAL_MODEL_OVERRIDES", () => {
  it("returns the hardcoded default when unset", () => {
    delete process.env.EVAL_MODEL_OVERRIDES;
    expect(getModelName("opportunityEvaluator")).toBe("google/gemini-2.5-flash");
  });

  it("overrides the model for the named agent only", () => {
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ opportunityEvaluator: "anthropic/claude-sonnet-4" });
    expect(getModelName("opportunityEvaluator")).toBe("anthropic/claude-sonnet-4");
    expect(getModelName("premiseAnalyzer")).toBe("google/gemini-2.5-flash");
  });

  it("is ignored entirely in production", () => {
    process.env.NODE_ENV = "production";
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ opportunityEvaluator: "anthropic/claude-sonnet-4" });
    expect(getModelName("opportunityEvaluator")).toBe("google/gemini-2.5-flash");
  });

  it("throws on an unknown agent key rather than silently measuring the default", () => {
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ notAnAgent: "anthropic/claude-sonnet-4" });
    expect(() => getModelName("opportunityEvaluator")).toThrow(/notAnAgent/);
  });

  it("throws on malformed JSON", () => {
    process.env.EVAL_MODEL_OVERRIDES = "{not json";
    expect(() => getModelName("opportunityEvaluator")).toThrow(/EVAL_MODEL_OVERRIDES/);
  });

  it("throws when a value is not a non-empty string", () => {
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ opportunityEvaluator: "" });
    expect(() => getModelName("opportunityEvaluator")).toThrow(/EVAL_MODEL_OVERRIDES/);
  });
});
