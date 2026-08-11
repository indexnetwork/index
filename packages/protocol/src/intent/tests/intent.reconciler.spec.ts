import { afterAll, describe, expect, it, mock } from "bun:test";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const prompt = String(messages.at(-1)?.content ?? "");
      if (prompt.includes('"Finish React Course"')) {
        return { actions: [{ type: "expire", id: "123", reason: "The course is complete." }] };
      }
      if (prompt.includes('"Build a Todo App in React with Redux"')) {
        return {
          actions: [{
            type: "update",
            id: "456",
            payload: "Build a Todo App in React with Redux",
            score: 90,
            reasoning: "The new goal refines the existing React application.",
            intentMode: "ATTRIBUTIVE",
          }],
        };
      }
      if (prompt.includes('"Collaborate on art direction')) {
        return {
          actions: [{
            type: "create",
            payload: "Collaborate on art direction for a text-first CRPG",
            score: 85,
            reasoning: "This is a distinct collaboration goal, not a compound update.",
            intentMode: "ATTRIBUTIVE",
            referentialAnchor: null,
            semanticEntropy: 0.2,
          }],
        };
      }
      return {
        actions: [{
          type: "create",
          payload: "Learn Rust",
          score: 85,
          reasoning: "No active intent matches the new learning goal.",
          intentMode: "ATTRIBUTIVE",
          referentialAnchor: null,
          semanticEntropy: 0.2,
        }],
      };
    },
  }),
}));

const { IntentReconciler } = await import("../../signals/application/intent.reconciler.js");

afterAll(() => mock.restore());

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
