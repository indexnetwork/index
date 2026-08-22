// Stub API key so createModel() doesn't throw in tests (no network call is made).
process.env.OPENROUTER_API_KEY ??= "test-key-unused";

import { afterEach, describe, expect, it } from "bun:test";

import { createModel, getModelName } from "../model.config.js";

const ORIGINAL_OVERRIDES = process.env.EVAL_MODEL_OVERRIDES;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  if (ORIGINAL_OVERRIDES === undefined) delete process.env.EVAL_MODEL_OVERRIDES;
  else process.env.EVAL_MODEL_OVERRIDES = ORIGINAL_OVERRIDES;
  if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
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

  it.each(["[]", '["anthropic/claude-sonnet-4"]', '"5"', "5"])(
    "throws when the payload is not a JSON object (%p)",
    (value) => {
      process.env.EVAL_MODEL_OVERRIDES = value as string;
      expect(() => getModelName("opportunityEvaluator")).toThrow(/must be a JSON object/);
    },
  );

  it("trims the override value so a padded model id is not sent verbatim", () => {
    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ chat: "  openai/gpt-4o  " });
    expect(getModelName("chat")).toBe("openai/gpt-4o");
  });

  it("overrides only the model id, leaving the agent's other settings intact", () => {
    // hydeValidator is a non-default agent: temperature 0.0, maxTokens 2048.
    delete process.env.EVAL_MODEL_OVERRIDES;
    const base = createModel("hydeValidator");
    expect(base.model).toBe("google/gemini-2.5-flash");
    expect(base.temperature).toBe(0.0);
    expect(base.maxTokens).toBe(2048);

    process.env.EVAL_MODEL_OVERRIDES = JSON.stringify({ hydeValidator: "x/y" });
    const overridden = createModel("hydeValidator");
    expect(overridden.model).toBe("x/y");
    expect(overridden.temperature).toBe(0.0);
    expect(overridden.maxTokens).toBe(2048);
  });
});
