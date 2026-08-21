// Stub API key so createModel()/createStructuredModel() don't throw in tests
process.env.OPENROUTER_API_KEY ??= "test-key-unused";

import { describe, it, expect } from "bun:test";
import { RunnableWithFallbacks } from "@langchain/core/runnables";
import { z } from "zod";
import { createFallbackModel, createResilientModel, createStructuredModel, getModelName } from "../model.config.js";

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

describe("createFallbackModel", () => {
  it("falls back to openai/gpt-4o-mini", () => {
    const fallback = createFallbackModel("opportunityEvaluator");
    expect(fallback?.model).toBe("openai/gpt-4o-mini");
  });

  it("returns undefined when the fallback equals the primary model", () => {
    expect(createFallbackModel("chat", { chatModel: "openai/gpt-4o-mini" })).toBeUndefined();
  });

  it("inherits the agent's sampling settings but never reasoning kwargs", () => {
    const fallback = createFallbackModel("suggestionGenerator");
    expect(fallback?.temperature).toBe(0.4);
    expect(fallback?.maxTokens).toBe(512);
    const chatFallback = createFallbackModel("chat");
    expect(chatFallback?.modelKwargs?.reasoning).toBeUndefined();
  });
});

describe("resilient model wiring", () => {
  const schema = z.object({ answer: z.string() });

  it("wraps structured models in retry + fallbacks", () => {
    const model = createStructuredModel("opportunityEvaluator", schema, { name: "test" });
    expect(model).toBeInstanceOf(RunnableWithFallbacks);
  });

  it("wraps plain-completion models in retry + fallbacks", () => {
    const model = createResilientModel("chatTitleGenerator");
    expect(model).toBeInstanceOf(RunnableWithFallbacks);
  });
});
