import { describe, it, expect } from "bun:test";
import { getModelName } from "../model.config.js";

describe("getModelName", () => {
  it("returns the hardcoded default when CHAT_MODEL env var is unset", () => {
    const saved = process.env.CHAT_MODEL;
    delete process.env.CHAT_MODEL;
    try {
      expect(getModelName("chat")).toBe("google/gemini-3-pro-preview");
    } finally {
      if (saved !== undefined) process.env.CHAT_MODEL = saved;
    }
  });

  it("returns the CHAT_MODEL env var when set and no config is passed", () => {
    const saved = process.env.CHAT_MODEL;
    process.env.CHAT_MODEL = "test/env-model";
    try {
      expect(getModelName("chat")).toBe("test/env-model");
    } finally {
      if (saved !== undefined) process.env.CHAT_MODEL = saved;
      else delete process.env.CHAT_MODEL;
    }
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
