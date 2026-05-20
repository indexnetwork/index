import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { runDiscoverFromQuery, type DiscoverInput } from "../opportunity.discover.js";
import type { Question, ChatContextDigest, QuestionGeneratorReader, ChatSummaryReader, NegotiationSummaryReader, DiscoveryNegotiation } from "@indexnetwork/protocol";

const baseQuestion: Question = {
  title: "Stage",
  prompt: "Where are you in your journey?",
  options: [
    { label: "ideating", description: "" },
    { label: "shipping", description: "" },
  ],
  multiSelect: false,
};

function makeFakeGraph(opportunities: unknown[] = [], extras: Record<string, unknown> = {}) {
  return {
    invoke: async () => ({
      opportunities,
      remainingCandidates: [],
      trace: [],
      existingBetweenActors: [],
      dedupAlreadyAccepted: [],
      sourceProfile: null,
      discoveryNegotiations: extras.discoveryNegotiations ?? [],
      discoverySummary: extras.discoverySummary ?? {
        totalCandidates: 0,
        opportunitiesFound: 0,
        noOpportunityCount: 0,
        timeoutCount: 0,
        roleDistribution: {},
      },
      ...extras,
    }),
  } as unknown as DiscoverInput["opportunityGraph"];
}

function makeFakeDatabase(): DiscoverInput["database"] {
  return {
    getProfile: async () => null,
    getUser: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesByIds: async () => [],
  } as unknown as DiscoverInput["database"];
}

const originalFlag = process.env.ENABLE_DISCOVERY_QUESTIONS;
beforeEach(() => { process.env.ENABLE_DISCOVERY_QUESTIONS = "true"; });
afterEach(() => { process.env.ENABLE_DISCOVERY_QUESTIONS = originalFlag; });

describe("runDiscoverFromQuery — decision-question integration", () => {
  it("returns questions when trigger=orchestrator and the generator yields a result", async () => {
    const chatSummary: ChatSummaryReader = { getDigest: async () => null };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => ({ questions: [baseQuestion], strategies: ["refine_intent"] }),
    };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "find mentors",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(result.questions).toEqual([baseQuestion]);
    expect(result.discoveryQuestionsDebug?.finalCount).toBe(1);
    expect(result.discoveryQuestionsDebug?.strategies).toEqual(["refine_intent"]);
  });

  it("does not call generator when trigger=ambient (even with flag on)", async () => {
    let called = 0;
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => { called += 1; return null; },
    };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "ambient",
      enableQuestions: true,
      questionGenerator,
    });
    expect(called).toBe(0);
    expect(result.questions).toBeUndefined();
    expect(result.discoveryQuestionsDebug).toBeUndefined();
  });

  it("does not call generator when enableQuestions is false", async () => {
    let called = 0;
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => { called += 1; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      enableQuestions: false,
      questionGenerator,
    });
    expect(called).toBe(0);
  });

  it("passes the chat-session digest when chatSummary returns one", async () => {
    const digest: ChatContextDigest = { statedFacts: ["pre-rev"], openQuestions: [], rejectionReasons: [], surfacedFindings: [] };
    let observedDigest: ChatContextDigest | undefined;
    const chatSummary: ChatSummaryReader = { getDigest: async () => digest };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async (input) => { observedDigest = input.chatContext; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(observedDigest).toEqual(digest);
  });

  it("survives a chatSummary failure and still runs the generator with undefined chatContext", async () => {
    const chatSummary: ChatSummaryReader = { getDigest: async () => { throw new Error("db down"); } };
    let observedDigest: ChatContextDigest | undefined = { statedFacts: [], openQuestions: [], rejectionReasons: [], surfacedFindings: [] };
    const questionGenerator: QuestionGeneratorReader = {
      generate: async (input) => { observedDigest = input.chatContext; return null; },
    };
    await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      chatSummary,
      questionGenerator,
    });
    expect(observedDigest).toBeUndefined();
  });

  it("returns no questions when the generator returns null", async () => {
    const questionGenerator: QuestionGeneratorReader = { generate: async () => null };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      questionGenerator,
    });
    expect(result.questions).toBeUndefined();
    expect(result.discoveryQuestionsDebug?.finalCount).toBe(0);
  });

  // Wiring test for DISCOVERY_QUESTIONS_TIMEOUT_MS. Verifies the deadline is
  // actually allocated AT THE DISCOVER LAYER and that `{ signal }` is forwarded
  // to the generator. A leaf-class unit test on QuestionGenerator alone would
  // not catch a regression where the `{ signal: questionsSignal }` arg is
  // dropped at this call site.
  it("forwards a deadline-bound AbortSignal to the generator (DISCOVERY_QUESTIONS_TIMEOUT_MS wiring)", async () => {
    const previous = process.env.DISCOVERY_QUESTIONS_TIMEOUT_MS;
    process.env.DISCOVERY_QUESTIONS_TIMEOUT_MS = "100";
    try {
      let receivedSignal: AbortSignal | undefined;
      const questionGenerator: QuestionGeneratorReader = {
        generate: async (_input, options) => {
          receivedSignal = options?.signal;
          // Resolve before the deadline so the timing-sensitive parts of this
          // test never race the timer — we only care that the signal arrived.
          return null;
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: makeFakeGraph(),
        database: makeFakeDatabase(),
        userId: "u-1",
        query: "q",
        indexScope: ["i-1"],
        trigger: "orchestrator",
        chatSessionId: "s-1",
        enableQuestions: true,
        questionGenerator,
      });
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal!.aborted).toBe(false);
      // Event-driven assertion — wait for the signal to fire rather than
      // sleeping a fixed slack budget. Wrapped in an outer race so a wiring
      // regression that drops the signal entirely fails loudly rather than
      // hanging the suite.
      await new Promise<void>((resolve, reject) => {
        const safety = setTimeout(
          () => reject(new Error("signal did not abort within 2000ms")),
          2000,
        );
        receivedSignal!.addEventListener('abort', () => {
          clearTimeout(safety);
          resolve();
        }, { once: true });
      });
      expect(receivedSignal!.aborted).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.DISCOVERY_QUESTIONS_TIMEOUT_MS;
      else process.env.DISCOVERY_QUESTIONS_TIMEOUT_MS = previous;
    }
  });

  it("returns no questions when the generator rejects with an AbortError (deadline fired)", async () => {
    const questionGenerator: QuestionGeneratorReader = {
      generate: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
    };
    const result = await runDiscoverFromQuery({
      opportunityGraph: makeFakeGraph(),
      database: makeFakeDatabase(),
      userId: "u-1",
      query: "q",
      indexScope: ["i-1"],
      trigger: "orchestrator",
      chatSessionId: "s-1",
      enableQuestions: true,
      questionGenerator,
    });
    expect(result.questions).toBeUndefined();
    expect(result.discoveryQuestionsDebug?.finalCount).toBe(0);
  });

  // Wiring test for NEGOTIATION_SUMMARY_TIMEOUT_MS. Mirrors the question-
  // generator wiring test above; same regression-risk shape (someone drops
  // `{ signal }` at the call site).
  it("forwards a deadline-bound AbortSignal to the negotiation summarizer (NEGOTIATION_SUMMARY_TIMEOUT_MS wiring)", async () => {
    const previous = process.env.NEGOTIATION_SUMMARY_TIMEOUT_MS;
    process.env.NEGOTIATION_SUMMARY_TIMEOUT_MS = "100";
    try {
      const negotiation: DiscoveryNegotiation = {
        counterpartyId: "user-x",
        counterpartyHint: "infra engineer",
        indexContext: "AI infra",
        turns: [
          {
            action: "propose",
            reasoning: "Seed match.",
            suggestedRoles: { ownUser: "peer", otherUser: "peer" },
          },
        ],
        outcome: { hasOpportunity: true, reasoning: "Strong overlap." },
      };
      let receivedSignal: AbortSignal | undefined;
      const negotiationSummary: NegotiationSummaryReader = {
        summarize: async (_n, options) => {
          receivedSignal = options?.signal;
          return null; // forces fallback digest; not relevant to signal wiring
        },
      };
      const questionGenerator: QuestionGeneratorReader = { generate: async () => null };

      await runDiscoverFromQuery({
        opportunityGraph: makeFakeGraph([], { discoveryNegotiations: [negotiation] }),
        database: makeFakeDatabase(),
        userId: "u-1",
        query: "q",
        indexScope: ["i-1"],
        trigger: "orchestrator",
        chatSessionId: "s-1",
        enableQuestions: true,
        questionGenerator,
        negotiationSummary,
      });

      expect(receivedSignal).toBeDefined();
      await new Promise<void>((resolve, reject) => {
        const safety = setTimeout(
          () => reject(new Error("summarizer signal did not abort within 2000ms")),
          2000,
        );
        if (receivedSignal!.aborted) {
          clearTimeout(safety);
          resolve();
          return;
        }
        receivedSignal!.addEventListener('abort', () => {
          clearTimeout(safety);
          resolve();
        }, { once: true });
      });
      expect(receivedSignal!.aborted).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.NEGOTIATION_SUMMARY_TIMEOUT_MS;
      else process.env.NEGOTIATION_SUMMARY_TIMEOUT_MS = previous;
    }
  });
});
