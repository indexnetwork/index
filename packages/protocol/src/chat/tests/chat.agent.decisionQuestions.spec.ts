/**
 * Tests for ChatAgent.normalizeToolResult — decision-question harvest.
 *
 * Verifies that `discover_opportunities` results are correctly parsed:
 *   - `questions` is extracted as decisionQuestions and PRESERVED in the LLM-facing string.
 *   - `_discoveryQuestionsDebug` is extracted as discoveryQuestionsDebug and STRIPPED
 *     from the LLM-facing string (internal trace data only).
 */

// Env must be set before any imports that transitively call createModel
import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";
process.env.NODE_ENV = "test";

import { mock, describe, it, expect, afterAll } from "bun:test";

// ─── Mock model.config so no real API key is needed ──────────────────────────
mock.module("../../shared/agent/model.config", () => ({
  createModel: () => ({
    bindTools: function (this: object) { return this; },
    stream: async function* () { /* never used */ },
  }),
}));

// ─── Mock tool.factory so create() doesn't hit the DB ────────────────────────
mock.module("../../shared/agent/tool.factory", () => ({
  createChatTools: async () => [],
  resolveChatContext: async (_ctx: unknown) => ({ userId: "u-test", networkId: undefined, sessionId: undefined, personal: null, memberships: [] }),
}));

mock.module("../../shared/agent/tool.helpers", () => ({
  resolveChatContext: async (_ctx: unknown) => ({ userId: "u-test", networkId: undefined, sessionId: undefined, personal: null, memberships: [] }),
}));

afterAll(() => mock.restore());

import { ChatAgent } from "../chat.agent.js";
import type { Question, QuestionStrategy } from "../../shared/schemas/question.schema.js";
import type { DebugMetaDiscoveryQuestions } from "../chat-streaming.types.js";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const sampleQuestion: Question = {
  title: "Stage",
  prompt: "Where in your journey?",
  options: [
    { label: "ideating", description: "" },
    { label: "shipping", description: "" },
  ],
  multiSelect: false,
};

const sampleDebug: DebugMetaDiscoveryQuestions = {
  inputMode: "transcripts",
  finalCount: 1,
  strategies: ["refine_intent" as QuestionStrategy],
  durationMs: 100,
};

// ─── Type for the private method we're testing ────────────────────────────────

type NormalizeToolResultFn = (
  toolName: string,
  resultStr: string,
  toolArgs: Record<string, unknown>,
) => Promise<{
  resultStr: string;
  summary: string;
  decisionQuestions?: Question[];
  discoveryQuestionsDebug?: DebugMetaDiscoveryQuestions;
}>;

async function makeAgent(): Promise<ChatAgent> {
  return ChatAgent.create({
    database: {
      getUser: async () => ({ id: "u-test", name: "Test User", email: "test@example.com", location: null, socials: {} }),
      getProfile: async () => null,
      getNetworkMemberships: async () => [],
    } as never,
    embedder: {} as never,
    scraper: {} as never,
    userId: "u-test",
    sessionId: "s-test",
    cache: {} as never,
    hydeCache: {} as never,
    integration: {} as never,
    intentQueue: {} as never,
    contactService: {} as never,
    chatSession: {} as never,
    enricher: {} as never,
    negotiationDatabase: {} as never,
    integrationImporter: {} as never,
    createUserDatabase: () => ({} as never),
    createSystemDatabase: () => ({} as never),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ChatAgent.normalizeToolResult — decision-question harvest", () => {
  it("extracts questions + discoveryQuestionsDebug from a discover_opportunities envelope", async () => {
    const agent = await makeAgent();
    const normalizeToolResult = (agent as unknown as { normalizeToolResult: NormalizeToolResultFn }).normalizeToolResult.bind(agent);

    const envelope = JSON.stringify({
      success: true,
      data: {
        found: true,
        count: 1,
        summary: "Found 1 match",
        questions: [sampleQuestion],
        _discoveryQuestionsDebug: sampleDebug,
        debugSteps: [],
      },
    });

    const result = await normalizeToolResult("discover_opportunities", envelope, {});

    // Metadata correctly extracted
    expect(result.decisionQuestions).toEqual([sampleQuestion]);
    expect(result.discoveryQuestionsDebug).toEqual(sampleDebug);

    // _discoveryQuestionsDebug stripped from the LLM-facing string
    const parsed = JSON.parse(result.resultStr) as { data?: Record<string, unknown> } & Record<string, unknown>;
    const payload = (parsed.data ?? parsed) as Record<string, unknown>;
    expect(payload._discoveryQuestionsDebug).toBeUndefined();

    // questions PRESERVED in the LLM-facing string (per the prompt addendum)
    expect(payload.questions).toEqual([sampleQuestion]);
  });

  it("extracts from flat (non-wrapped) envelopes too", async () => {
    const agent = await makeAgent();
    const normalizeToolResult = (agent as unknown as { normalizeToolResult: NormalizeToolResultFn }).normalizeToolResult.bind(agent);

    // Some tool results don't wrap in { success, data }
    const envelope = JSON.stringify({
      found: true,
      count: 1,
      summary: "Found 1 match",
      questions: [sampleQuestion],
      _discoveryQuestionsDebug: sampleDebug,
    });

    const result = await normalizeToolResult("discover_opportunities", envelope, {});

    expect(result.decisionQuestions).toEqual([sampleQuestion]);
    expect(result.discoveryQuestionsDebug).toEqual(sampleDebug);

    const parsed = JSON.parse(result.resultStr) as Record<string, unknown>;
    expect(parsed._discoveryQuestionsDebug).toBeUndefined();
    expect(parsed.questions).toEqual([sampleQuestion]);
  });

  it("returns no decisionQuestions for tool results without the field", async () => {
    const agent = await makeAgent();
    const normalizeToolResult = (agent as unknown as { normalizeToolResult: NormalizeToolResultFn }).normalizeToolResult.bind(agent);

    const envelope = JSON.stringify({
      success: true,
      data: { found: false, count: 0, summary: "no matches", debugSteps: [] },
    });

    const result = await normalizeToolResult("discover_opportunities", envelope, {});

    expect(result.decisionQuestions).toBeUndefined();
    expect(result.discoveryQuestionsDebug).toBeUndefined();
  });

  it("harvests questions by JSON envelope shape regardless of tool name", async () => {
    const agent = await makeAgent();
    const normalizeToolResult = (agent as unknown as { normalizeToolResult: NormalizeToolResultFn }).normalizeToolResult.bind(agent);

    // Same shape but from a different tool
    const envelope = JSON.stringify({
      success: true,
      data: {
        summary: "ok",
        questions: [sampleQuestion],
        _discoveryQuestionsDebug: sampleDebug,
      },
    });

    // normalizeToolResult harvests questions from any tool that carries them,
    // because the extraction is shape-based. This test documents that the
    // createIntentCallback guard is only for discover_opportunities, while
    // question harvesting is available for any tool result.
    const result = await normalizeToolResult("read_intents", envelope, {});

    // questions and debug are extracted regardless of tool name
    expect(result.decisionQuestions).toEqual([sampleQuestion]);
    expect(result.discoveryQuestionsDebug).toEqual(sampleDebug);
  });
});
