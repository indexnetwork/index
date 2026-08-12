import { describe, expect, it } from "bun:test";

import { CANONICAL_MODEL_AGENTS, resolveCanonicalAllAgentModels } from "../model.resolver.js";

describe("canonical all-agent model resolver", () => {
  it("returns every production agent assignment from an explicit empty environment", () => {
    const models = resolveCanonicalAllAgentModels({});
    expect(Object.keys(models)).toEqual([...CANONICAL_MODEL_AGENTS]);
    expect(models.intentInferrer).toBe("google/gemini-2.5-flash");
    expect(models.opportunityEvaluator).toBe("google/gemini-2.5-flash");
    expect(models.chat).toBe("google/gemini-3-pro-preview");
  });

  it("applies CHAT_MODEL and EVAL_MODEL_OVERRIDES without reading process.env", () => {
    const original = process.env.CHAT_MODEL;
    process.env.CHAT_MODEL = "process/should-not-be-read";
    try {
      expect(resolveCanonicalAllAgentModels({
        CHAT_MODEL: "chat/explicit",
        EVAL_MODEL_OVERRIDES: JSON.stringify({ opportunityEvaluator: "judge/explicit", lensInferrer: " lens/explicit " }),
      })).toMatchObject({
        chat: "chat/explicit",
        opportunityEvaluator: "judge/explicit",
        lensInferrer: "lens/explicit",
      });
    } finally {
      if (original === undefined) delete process.env.CHAT_MODEL;
      else process.env.CHAT_MODEL = original;
    }
  });

  it.each([
    ["malformed JSON", "{", /not valid JSON/],
    ["non-object", "[]", /must be a JSON object/],
    ["unknown agent", '{"unknown":"model"}', /unknown agent/],
    ["blank model", '{"chat":" "}', /non-empty model id/],
  ])("rejects %s", (_label, raw, expected) => {
    expect(() => resolveCanonicalAllAgentModels({ EVAL_MODEL_OVERRIDES: raw })).toThrow(expected);
  });
});
