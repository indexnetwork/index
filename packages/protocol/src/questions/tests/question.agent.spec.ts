import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";
import { QuestionerAgent } from "../question.agent.js";
import type { QuestionerInput, IntentContext, NegotiationContext } from "../question.input.js";

const okOption = { label: "A", description: "desc-a" };

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    title: "T",
    prompt: "Does it?",
    options: [okOption, { label: "B", description: "desc-b" }],
    multiSelect: false,
    strategy: "refine_intent",
    underspecificationType: null,
    ...overrides,
  };
}

function makeIntentInput(): QuestionerInput {
  const context: IntentContext = {
    intentId: "i-0",
    payload: "test query",
    userContext: "Tester is a builder.",
  };
  return {
    mode: "intent",
    userId: "user-1",
    sourceType: "intent",
    sourceId: "i-0",
    context,
  };
}

function makeAgent(
  invokeImpl: (input: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
): QuestionerAgent {
  const agent = new QuestionerAgent();
  // Swap the internal model for a mock, same pattern as the removed question.generator.spec.ts
  (agent as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return agent;
}

function messageContent(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function modeInput(mode: 'intent' | 'negotiation'): QuestionerInput {
  const intentContext: IntentContext = {
    intentId: "i-1",
    payload: "Connect with people building decentralized identity protocols",
    summary: "Decentralized identity protocol design collaborations",
    userContext: "Dana is a builder of agent tools.",
  };
  if (mode === 'negotiation') {
    const negotiationContext: NegotiationContext = {
      negotiationId: 'task-1',
      counterpartyHint: 'the other participant',
      indexContext: 'the selected network',
      outcomeReason: 'turn_cap',
      recipientIntent: 'Find an AI infrastructure collaborator',
      userContext: 'Dana is a builder of agent tools.',
    };
    return {
      mode: 'negotiation',
      purpose: 'stalled_followup',
      userId: 'user-1',
      sourceType: 'opportunity',
      sourceId: 'opp-1',
      negotiation: {
        purpose: 'stalled_followup',
        recipientUserId: 'user-1',
        recipientIntentId: 'intent-1',
        opportunityId: 'opp-1',
        taskId: 'task-1',
        networkId: 'network-1',
      },
      context: negotiationContext,
    };
  }
  const contexts = { intent: intentContext };
  return {
    mode,
    userId: 'user-1',
    sourceType: 'test',
    sourceId: 'test-1',
    context: contexts[mode],
  } as QuestionerInput;
}

describe("QuestionerAgent", () => {
  it("returns null when the LLM throws", async () => {
    const agent = makeAgent(async () => { throw new Error("model down"); });
    const result = await agent.invoke(makeIntentInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM output fails Zod parse", async () => {
    const agent = makeAgent(async () => ({ questions: "not-an-array" }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM emits an empty questions array", async () => {
    const agent = makeAgent(async () => ({ questions: [] }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).toBeNull();
  });

  it("returns parsed questions on a clean LLM output", async () => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].title).toBe("Stage");
    expect(result!.strategies).toEqual(["refine_intent"]);
    expect(result!.underspecificationTypes).toEqual([null]);
  });

  it("propagates QUD types in parallel and strips internal metadata publicly", async () => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({
        title: "Stage",
        underspecificationType: "missing_constraint",
      })],
    }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).not.toBeNull();
    expect(result!.underspecificationTypes).toEqual(["missing_constraint"]);
    const publicQuestion = result!.questions[0] as Record<string, unknown>;
    expect("strategy" in publicQuestion).toBe(false);
    expect("underspecificationType" in publicQuestion).toBe(false);
  });

  it("dedupes questions by title, keeping the first occurrence", async () => {
    const agent = makeAgent(async () => ({
      questions: [
        makeQuestion({ title: "Stage", prompt: "first?" }),
        makeQuestion({ title: "Stage", prompt: "second?" }),
        makeQuestion({ title: "Timing", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].prompt).toBe("first?");
  });

  it("drops the 3rd same-strategy question", async () => {
    const agent = makeAgent(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
      ],
    }));
    const result = await agent.invoke(makeIntentInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
  });

  it("forwards the AbortSignal to the model", async () => {
    let captured: { signal?: AbortSignal } | undefined;
    const agent = makeAgent(async (_input, config) => {
      captured = config;
      return { questions: [makeQuestion({ title: "Stage" })] };
    });
    const controller = new AbortController();
    const result = await agent.invoke(makeIntentInput(), { signal: controller.signal });
    expect(result).not.toBeNull();
    expect(captured?.signal).toBe(controller.signal);
  });

  it("returns null when the signal is already aborted", async () => {
    const controller = new AbortController();
    const agent = makeAgent(async () => {
      controller.abort(new Error("deadline"));
      throw new Error("aborted");
    });
    const result = await agent.invoke(makeIntentInput(), { signal: controller.signal });
    expect(result).toBeNull();
  });

  it.each([
    { mode: "intent" as const, contextNeedles: ["Connect with people building decentralized identity protocols", "Decentralized identity protocol design collaborations"] },
    { mode: "negotiation" as const, contextNeedles: ["the other participant", "Find an AI infrastructure collaborator"] },
  ])("mode '$mode' sends standalone-context instructions alongside source evidence", async ({ mode, contextNeedles }) => {
    let capturedMessages: unknown[] | undefined;
    const agent = makeAgent(async (input) => {
      capturedMessages = input as unknown[];
      return { questions: [makeQuestion({ title: "Test" })] };
    });

    const result = await agent.invoke(modeInput(mode));

    expect(result).not.toBeNull();
    expect(capturedMessages).toHaveLength(2);
    const systemPrompt = messageContent(capturedMessages![0]);
    const humanPrompt = messageContent(capturedMessages![1]);
    expect(systemPrompt).toContain("Standalone prompt rule");
    expect(systemPrompt).toContain("Every generated `prompt` must be understandable outside the conversation where it was created");
    expect(systemPrompt).toContain("question text itself");
    for (const needle of contextNeedles) {
      expect(humanPrompt).toContain(needle);
    }
  });

  it.each(["intent", "negotiation"] as const)("mode '%s' invokes the LLM and returns questions", async (mode) => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Test" })],
    }));
    const result = await agent.invoke(modeInput(mode));
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
  });
});
