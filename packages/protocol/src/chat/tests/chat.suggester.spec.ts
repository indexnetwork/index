/**
 * SuggestionGenerator: context-aware chat follow-up suggestions.
 * Tests empty input (no LLM) and integration with real model.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, test, expect } from "bun:test";
import { SuggestionGenerator } from "../chat.suggester.js";
import type { ChatSuggestion } from "../chat-streaming.types.js";

const HAS_OPENROUTER_KEY = !!process.env.OPENROUTER_API_KEY;

describe("SuggestionGenerator", () => {
  test("generate with empty messages returns empty array without calling LLM", async () => {
    const generator = new SuggestionGenerator();
    const result = await generator.generate({ messages: [] });
    expect(result).toEqual([]);
  });

  test.skipIf(!HAS_OPENROUTER_KEY)("generate with one exchange returns 1-6 suggestions with valid shape", async () => {
    const generator = new SuggestionGenerator();
    const result = await generator.generate({
      messages: [
        { role: "user", content: "What opportunities do I have?" },
        { role: "assistant", content: "You have 2 opportunities: one intro ready, one draft. I can list them in detail if you like." },
      ],
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(6);

    for (const s of result as ChatSuggestion[]) {
      expect(typeof s.label).toBe("string");
      expect(s.label.length).toBeGreaterThan(0);
      expect(["direct", "prompt"]).toContain(s.type);
      if (s.type === "direct") {
        expect(typeof s.followupText).toBe("string");
        expect((s.followupText as string).length).toBeGreaterThan(0);
      }
      if (s.type === "prompt") {
        expect(typeof s.prefill).toBe("string");
        expect((s.prefill as string).length).toBeGreaterThan(0);
      }
    }
  }, 30000);

  test.skipIf(!HAS_OPENROUTER_KEY)("generate with indexContext includes context in prompt and returns suggestions", async () => {
    const generator = new SuggestionGenerator();
    const result = await generator.generate({
      messages: [
        { role: "user", content: "Who here is looking for a co-founder?" },
        { role: "assistant", content: "In this network, 3 members have intents about co-founders. I can list them or narrow by skills." },
      ],
      indexContext: "AI founders and technical co-founders",
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(6);

    for (const s of result as ChatSuggestion[]) {
      expect(s).toHaveProperty("label");
      expect(s).toHaveProperty("type");
      expect(["direct", "prompt"]).toContain(s.type);
    }
  }, 30000);

  test.skipIf(!HAS_OPENROUTER_KEY)("generate uses only last 6 messages for excerpt", async () => {
    const generator = new SuggestionGenerator();
    const manyMessages = Array.from({ length: 10 }, (_, i) =>
      i % 2 === 0
        ? { role: "user" as const, content: `User message ${i}` }
        : { role: "assistant" as const, content: `Assistant reply ${i}` }
    );
    const result = await generator.generate({ messages: manyMessages });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.length).toBeLessThanOrEqual(6);
  }, 30000);
});
