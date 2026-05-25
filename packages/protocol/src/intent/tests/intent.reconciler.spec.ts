/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from "bun:test";
import { IntentReconciler } from "../intent.reconciler.js";

describe('IntentReconciler', () => {
  const reconciler = new IntentReconciler();

  it('should create a new intent if no match found', async () => {
    const inferred = `- [GOAL] "Learn Rust" (Confidence: high, Score: 85) \n Reasoning: Explicit statement.`;
    const active = "No active intents.";

    const result = await reconciler.invoke(inferred, active);

    expect(result.actions.length).toBe(1);
    expect(result.actions[0].type).toBe("create");
    expect((result.actions[0] as any).payload).toContain("Rust");
  }, 30000);

  it('should expire an intent if a tombstone matches', async () => {
    const inferred = `- [TOMBSTONE] "Finish React Course" \n Reasoning: User said 'I am done with the react course'.`;
    const active = `1. [ID: 123] "Complete the React Course" (Status: Active)`;

    const result = await reconciler.invoke(inferred, active);

    expect(result.actions.length).toBe(1);
    expect(result.actions[0].type).toBe("expire");
    expect((result.actions[0] as any).id).toBe("123");
  }, 30000);

  it('should update an intent description if better', async () => {
    const inferred = `- [GOAL] "Build a Todo App in React with Redux" (Confidence: high, Score: 90)`;
    const active = `1. [ID: 456] "Build a React app" (Status: Active)`;

    const result = await reconciler.invoke(inferred, active);

    expect(result.actions.length).toBe(1);
    expect(result.actions[0].type).toBe("update");
    expect((result.actions[0] as any).id).toBe("456");
    expect((result.actions[0] as any).payload).toContain("Redux");
  }, 30000);

  it('should create (not compound) when inferred goal is distinct from active intent on same topic', async () => {
    // Two related but distinct goals about game art - should NOT be merged into a compound
    const inferred = `- [GOAL] "Collaborate on art direction for a text-first CRPG" (Confidence: high, Score: 85)`;
    const active = `1. [ID: 789] "Find an artist for visual identity, UI language, and iconography for a desktop CRPG interface" (Status: Active)`;

    const result = await reconciler.invoke(inferred, active);

    // Should create a new intent, not update the existing one
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].type).toBe("create");
    // The payload should NOT be a compound (should not contain both goals joined by "and")
    const payload = (result.actions[0] as any).payload;
    expect(payload).not.toMatch(/find.*and.*collaborate/i);
    expect(payload).not.toMatch(/artist.*and.*art direction/i);
  }, 30000);
});
