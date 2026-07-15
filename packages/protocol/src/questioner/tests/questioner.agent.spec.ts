import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";
import { QuestionerAgent } from "../questioner.agent.js";
import type { QuestionerInput, DiscoveryContext, IntentContext, ProfileContext, NegotiationContext } from "../questioner.types.js";

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

function makeDiscoveryInput(): QuestionerInput {
  const context: DiscoveryContext = {
    query: "test query",
    userContext: "Tester is a builder.",
    negotiationDigests: [],
    summary: {
      totalCandidates: 0,
      opportunitiesFound: 0,
      noOpportunityCount: 0,
      timeoutCount: 0,
      roleDistribution: {},
    },
    now: "2026-05-24T12:00:00.000Z",
  };
  return {
    mode: "discovery",
    userId: "user-1",
    sourceType: "opportunity",
    sourceId: "opp-1",
    context,
  };
}

function makeAgent(
  invokeImpl: (input: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
): QuestionerAgent {
  const agent = new QuestionerAgent();
  // Swap the internal model for a mock, same pattern as question.generator.spec.ts
  (agent as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return agent;
}

function messageContent(message: unknown): string {
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : JSON.stringify(content);
}

function modeInput(mode: QuestionerInput["mode"]): QuestionerInput {
  const discoveryContext: DiscoveryContext = {
    query: "find decentralized identity protocol designers",
    userContext: "Dana is a builder of agent tools.",
    negotiationDigests: [],
    summary: {
      totalCandidates: 3,
      opportunitiesFound: 1,
      noOpportunityCount: 2,
      timeoutCount: 1,
      roleDistribution: {},
    },
    now: "2026-05-24T12:00:00.000Z",
  };
  const intentContext: IntentContext = {
    intentId: "i-1",
    payload: "Connect with people building decentralized identity protocols",
    summary: "Decentralized identity protocol design collaborations",
    userContext: "Dana is a builder of agent tools.",
  };
  const profileContext: ProfileContext = {
    userContext: "Dana is a builder of agent tools.",
    gaps: ["availability"],
    existingPremises: ["I build agent tools for event communities"],
  };
  const negotiationContext: NegotiationContext = {
    negotiationId: "n-1",
    counterpartyHint: "AI infra founder, Berlin",
    indexContext: "AI founders community",
    outcomeReason: "turn_cap",
    keyTake: "Both interested but scope unclear",
    userContext: "Dana is a builder of agent tools.",
  };
  const contexts = {
    discovery: discoveryContext,
    intent: intentContext,
    enrichment: profileContext,
    negotiation: negotiationContext,
  } satisfies Record<QuestionerInput["mode"], DiscoveryContext | IntentContext | ProfileContext | NegotiationContext>;
  return {
    mode,
    userId: "user-1",
    sourceType: "test",
    sourceId: "test-1",
    context: contexts[mode],
  };
}

describe("QuestionerAgent", () => {
  it("returns null when the LLM throws", async () => {
    const agent = makeAgent(async () => { throw new Error("model down"); });
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM output fails Zod parse", async () => {
    const agent = makeAgent(async () => ({ questions: "not-an-array" }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM emits an empty questions array", async () => {
    const agent = makeAgent(async () => ({ questions: [] }));
    const result = await agent.invoke(makeDiscoveryInput());
    expect(result).toBeNull();
  });

  it("returns parsed questions on a clean LLM output", async () => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await agent.invoke(makeDiscoveryInput());
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
    const result = await agent.invoke(makeDiscoveryInput());
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
    const result = await agent.invoke(makeDiscoveryInput());
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
    const result = await agent.invoke(makeDiscoveryInput());
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
    const result = await agent.invoke(makeDiscoveryInput(), { signal: controller.signal });
    expect(result).not.toBeNull();
    expect(captured?.signal).toBe(controller.signal);
  });

  it("returns null when the signal is already aborted", async () => {
    const controller = new AbortController();
    const agent = makeAgent(async () => {
      controller.abort(new Error("deadline"));
      throw new Error("aborted");
    });
    const result = await agent.invoke(makeDiscoveryInput(), { signal: controller.signal });
    expect(result).toBeNull();
  });

  it.each([
    { mode: "discovery" as const, contextNeedles: ["find decentralized identity protocol designers", "3 people reviewed"] },
    { mode: "intent" as const, contextNeedles: ["Connect with people building decentralized identity protocols", "Decentralized identity protocol design collaborations"] },
    { mode: "enrichment" as const, contextNeedles: ["availability", "I build agent tools for event communities"] },
    { mode: "negotiation" as const, contextNeedles: ["AI infra founder, Berlin", "Both interested but scope unclear"] },
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

  it.each(["discovery", "intent", "enrichment", "negotiation"] as const)("mode '%s' invokes the LLM and returns questions", async (mode) => {
    const agent = makeAgent(async () => ({
      questions: [makeQuestion({ title: "Test" })],
    }));
    const discoveryContext: DiscoveryContext = makeDiscoveryInput().context as DiscoveryContext;
    const intentContext: IntentContext = { intentId: "i-1", payload: "test intent", userContext: "Test user." };
    const profileContext: ProfileContext = { userContext: "Test user.", gaps: ["location"] };
    const negotiationContext: NegotiationContext = { negotiationId: "n-1", counterpartyHint: "founder", indexContext: "AI", outcomeReason: "turn_cap" as const, keyTake: "test", userContext: "Test user." };
    const contexts = {
      discovery: discoveryContext,
      intent: intentContext,
      enrichment: profileContext,
      negotiation: negotiationContext,
    };
    const input: QuestionerInput = {
      mode,
      userId: "user-1",
      sourceType: "test",
      sourceId: "test-1",
      context: contexts[mode],
    };
    const result = await agent.invoke(input);
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
  });
});
