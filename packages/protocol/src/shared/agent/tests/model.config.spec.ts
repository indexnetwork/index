// Stub API key so createModel()/createStructuredModel() don't throw in tests
process.env.OPENROUTER_API_KEY ??= "test-key-unused";

import { describe, it, expect, afterEach } from "bun:test";
import { RunnableRetry, RunnableWithFallbacks } from "@langchain/core/runnables";
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
  const savedFallback = process.env.OPENROUTER_FALLBACK_MODEL;

  afterEach(() => {
    if (savedFallback !== undefined) process.env.OPENROUTER_FALLBACK_MODEL = savedFallback;
    else delete process.env.OPENROUTER_FALLBACK_MODEL;
  });

  it("defaults to openai/gpt-4o-mini when env is unset", () => {
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    const fallback = createFallbackModel("opportunityEvaluator");
    expect(fallback?.model).toBe("openai/gpt-4o-mini");
  });

  it("respects OPENROUTER_FALLBACK_MODEL override", () => {
    process.env.OPENROUTER_FALLBACK_MODEL = "anthropic/claude-3-5-haiku";
    const fallback = createFallbackModel("opportunityEvaluator");
    expect(fallback?.model).toBe("anthropic/claude-3-5-haiku");
  });

  it.each(["none", "off", "  ", "NONE"])("returns undefined when env is %p", (value) => {
    process.env.OPENROUTER_FALLBACK_MODEL = value as string;
    expect(createFallbackModel("opportunityEvaluator")).toBeUndefined();
  });

  it("returns undefined when the fallback equals the primary model", () => {
    process.env.OPENROUTER_FALLBACK_MODEL = getModelName("opportunityEvaluator");
    expect(createFallbackModel("opportunityEvaluator")).toBeUndefined();
  });

  it("inherits the agent's sampling settings but never reasoning kwargs", () => {
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    const fallback = createFallbackModel("suggestionGenerator");
    expect(fallback?.temperature).toBe(0.4);
    expect(fallback?.maxTokens).toBe(512);
    const chatFallback = createFallbackModel("chat");
    expect(chatFallback?.modelKwargs?.reasoning).toBeUndefined();
  });
});

describe("resilient model wiring", () => {
  const savedFallback = process.env.OPENROUTER_FALLBACK_MODEL;
  const savedAttempts = process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS;

  afterEach(() => {
    if (savedFallback !== undefined) process.env.OPENROUTER_FALLBACK_MODEL = savedFallback;
    else delete process.env.OPENROUTER_FALLBACK_MODEL;
    if (savedAttempts !== undefined) process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS = savedAttempts;
    else delete process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS;
  });

  const schema = z.object({ answer: z.string() });

  it("wraps structured models in retry + fallbacks by default", () => {
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    delete process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS;
    const model = createStructuredModel("opportunityEvaluator", schema, { name: "test" });
    expect(model).toBeInstanceOf(RunnableWithFallbacks);
  });

  it("skips the fallback wrapper when fallbacks are disabled", () => {
    process.env.OPENROUTER_FALLBACK_MODEL = "none";
    delete process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS;
    const model = createStructuredModel("opportunityEvaluator", schema, { name: "test" });
    expect(model).toBeInstanceOf(RunnableRetry);
  });

  it("skips the retry wrapper when max attempts is 1", () => {
    process.env.OPENROUTER_FALLBACK_MODEL = "none";
    process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS = "1";
    const model = createStructuredModel("opportunityEvaluator", schema, { name: "test" });
    expect(model).not.toBeInstanceOf(RunnableRetry);
    expect(model).not.toBeInstanceOf(RunnableWithFallbacks);
  });

  it("wraps plain-completion models in retry + fallbacks by default", () => {
    delete process.env.OPENROUTER_FALLBACK_MODEL;
    delete process.env.OPENROUTER_RUNNABLE_MAX_ATTEMPTS;
    const model = createResilientModel("chatTitleGenerator");
    expect(model).toBeInstanceOf(RunnableWithFallbacks);
  });
});
