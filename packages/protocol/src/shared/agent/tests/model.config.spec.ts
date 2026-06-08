import { describe, it, expect } from "bun:test";
import { getModelName } from "../model.config.js";

describe("getModelName", () => {
  it("returns the default chat model when no config is passed", () => {
    const model = getModelName("chat");
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });

  it("returns the override chatModel when config is passed", () => {
    const model = getModelName("chat", { chatModel: "test/override-model" });
    expect(model).toBe("test/override-model");
  });

  it("returns the hardcoded model for non-chat agents regardless of config", () => {
    const model = getModelName("opportunityEvaluator", { chatModel: "test/override-model" });
    expect(model).toBe("google/gemini-2.5-flash");
  });
});
