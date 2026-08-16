import { afterAll, describe, expect, it, mock } from "bun:test";

const primaryCalls: Array<Array<{ content?: unknown }>> = [];
let modelSlot = 0;

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => {
    const slot = modelSlot++;
    return {
      invoke: async (messages: Array<{ content?: unknown }>) => {
        const prompt = String(messages.at(-1)?.content ?? "");
        if (slot === 0) {
          primaryCalls.push(messages);
          if (prompt.includes("find a job")) {
            return {
              needsClarification: true,
              reason: "The target role and constraints are unresolved.",
              suggestedDescription: "Find a suitable job.",
              clarificationMessage: "Which role and location should this job search target?",
              underspecificationType: "missing_constituent",
            };
          }
          return {
            needsClarification: false,
            reason: "The target, location, engagement, specialty, and timing are actionable.",
            suggestedDescription: null,
            clarificationMessage: null,
            underspecificationType: null,
          };
        }
        if (slot === 2) {
          return {
            suggestedDescription: "Find a senior ML engineer in Berlin for a full-time role this quarter.",
            clarificationMessage: "Which role and location should this job search target?",
          };
        }
        return { suggestedDescription: "Find a suitable job." };
      },
    };
  },
}));

const { IntentClarifier } = await import("../../intents/application/intent.clarifier.js");

afterAll(() => mock.restore());

describe('IntentClarifier', () => {
  const clarifier = new IntentClarifier();

  it('returns needsClarification=false for a specific, actionable intent', async () => {
    const result = await clarifier.invoke(
      'Looking for a senior ML engineer in Berlin for a full-time role building production LLM evaluation systems this quarter',
      'Full-stack developer building AI-native apps',
      '',
    );
    expect(result.needsClarification).toBe(false);
    expect(result.underspecificationType).toBeNull();
    expect(String(primaryCalls[0]?.[0]?.content)).toContain("consequential unresolved Question Under Discussion");
    expect(String(primaryCalls[0]?.at(-1)?.content)).toContain("full-time role");
  }, 60000);

  it('returns needsClarification=true for a vague, unactionable intent', async () => {
    const result = await clarifier.invoke(
      'find a job',
      '',
      '',
    );
    expect(result.needsClarification).toBe(true);
    if (!result.needsClarification) throw new Error('expected clarification');
    expect(result.clarificationMessage.length).toBeGreaterThan(0);
    expect(result.suggestedDescription.length).toBeGreaterThan(0);
    expect(result.underspecificationType).toBe("missing_constituent");
  }, 60000);

  it('returns suggestedDescription for any intent', async () => {
    const result = await clarifier.invoke(
      'seeking investors for climate tech startup in Europe',
      'Founder at a carbon capture startup',
      '',
    );
    expect(typeof result.suggestedDescription === 'string' || result.suggestedDescription === null).toBe(true);
    expect(result.needsClarification).toBeDefined();
  }, 60000);
});
