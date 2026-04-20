/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it } from "bun:test";
import { IntentIndexer } from "../intent.indexer.js";

describe("IntentIndexer", () => {
  const indexer = new IntentIndexer();

  it("should return structured output with indexScore, memberScore, and reasoning", async () => {
    const intent = "I want to find a technical co-founder for my AI startup.";
    const networkPrompt = "Founders and builders seeking co-founders or collaborators.";
    const memberPrompt = "Looking for technical co-founders with ML/AI experience.";

    const result = await indexer.invoke(intent, networkPrompt, memberPrompt);

    expect(result).not.toBeNull();
    expect(result!.indexScore).toBeGreaterThanOrEqual(0);
    expect(result!.indexScore).toBeLessThanOrEqual(1);
    expect(result!.memberScore).toBeGreaterThanOrEqual(0);
    expect(result!.memberScore).toBeLessThanOrEqual(1);
    expect(typeof result!.reasoning).toBe("string");
    expect(result!.reasoning.length).toBeGreaterThan(0);
  }, 60000);

  it("should evaluate when member prompt is null", async () => {
    const intent = "Looking for a React developer to join my team.";
    const networkPrompt = "Software engineering roles and hiring.";

    const result = await indexer.invoke(intent, networkPrompt, null);

    expect(result).not.toBeNull();
    expect(result!.indexScore).toBeGreaterThanOrEqual(0);
    expect(result!.indexScore).toBeLessThanOrEqual(1);
    // No member prompt: output rules say return 0.0 for memberScore
    expect(result!.memberScore).toBeGreaterThanOrEqual(0);
    expect(result!.memberScore).toBeLessThanOrEqual(1);
  }, 60000);

  it("should work with evaluate() alias", async () => {
    const intent = "I want to learn Rust.";
    const networkPrompt = "Learning goals and skill development.";

    const result = await indexer.evaluate(intent, networkPrompt, null);

    expect(result).not.toBeNull();
    expect(result!.indexScore).toBeGreaterThanOrEqual(0);
    expect(result!.indexScore).toBeLessThanOrEqual(1);
    expect(result!.reasoning).toBeDefined();
  }, 60000);
});
