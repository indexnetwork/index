/**
 * Tests for hallucination auto-retry in ChatAgent.streamRun().
 *
 * When the LLM writes a ```intent_proposal or ```opportunity code block
 * without calling the corresponding tool, the agent should auto-invoke
 * the tool directly instead of making another slow LLM retry call.
 */

// Env must be set before any imports that transitively call createModel
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY = "test-key-for-unit-tests";
process.env.NODE_ENV = "test";

import { mock, describe, expect, it, afterAll } from "bun:test";

// ─── Mock model.config globally ─────────────────────────────────────────────
// Every module that imports createModel (directly or transitively) will get
// the mock. We capture the instance created for the "chat" agent.

let mockModelInstance: {
  bindTools: ReturnType<typeof mock>;
  stream: ReturnType<typeof mock>;
};

const makeMockModel = () => {
  const inst = {
    bindTools: mock(function (this: typeof inst) { return this; }),
    stream: mock(() => (async function* () {})()),
  };
  return inst;
};

mock.module("../../shared/agent/model.config", () => ({
  createModel: (agent: string) => {
    const inst = makeMockModel();
    if (agent === "chat") {
      mockModelInstance = inst;
    }
    return inst;
  },
}));


// Track tools for inspection
let capturedTools: Array<{
  name: string;
  invoke: ReturnType<typeof mock>;
  description: string;
  schema: unknown;
}> = [];

function createMockTools() {
  capturedTools = [
    {
      name: "create_intent",
      description: "Create an intent",
      schema: {},
      invoke: mock(async () =>
        JSON.stringify({
          success: true,
          data: { intentId: "mock-intent-123", summary: "Intent created" },
        }),
      ),
    },
    {
      name: "discover_opportunities",
      description: "Find opportunities",
      schema: {},
      invoke: mock(async () =>
        JSON.stringify({
          success: true,
          data: { count: 2, summary: "Found 2 match(es)" },
        }),
      ),
    },
  ];
  return capturedTools;
}

mock.module("../../shared/agent/tool.factory", () => ({
  createChatTools: async () => createMockTools(),
}));

import {
  AIMessageChunk,
  HumanMessage,
} from "@langchain/core/messages";
import { ChatAgent, type AgentStreamEvent } from "../chat.agent.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTextStream(text: string): AsyncIterable<AIMessageChunk> {
  return (async function* () {
    await new Promise<void>((resolve) => setTimeout(resolve, 1)); // ensure measurable elapsed time for llm timing
    yield new AIMessageChunk({ content: text });
  })();
}

function createEventCollector(): {
  events: AgentStreamEvent[];
  writer: (e: unknown) => void;
} {
  const events: AgentStreamEvent[] = [];
  return {
    events,
    writer: (e: unknown) => events.push(e as AgentStreamEvent),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ChatAgent hallucination auto-retry", () => {
  it("auto-invokes create_intent when hallucinated intent_proposal block is detected", async () => {
    const agent = await ChatAgent.create({
      database: {
        getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com", location: null, socials: {} }),
        getProfile: async () => null,
        getNetworkMemberships: async () => [],
      } as any,
      embedder: {} as any,
      scraper: {} as any,
      userId: "test-user",
      sessionId: "test-session",
      cache: {} as any,
      hydeCache: {} as any,
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    });

    const hallucinatedText = `Here's what I found:

\`\`\`intent_proposal
{ "description": "AI-focused software engineering lead" }
\`\`\`

I've created an intent for you!`;

    const normalFollowUp =
      "I've set up your intent based on your interests.";

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) return makeTextStream(hallucinatedText);
      return makeTextStream(normalFollowUp);
    });

    const { events, writer } = createEventCollector();
    const result = await agent.streamRun(
      [new HumanMessage("I'm interested in AI engineering")],
      writer,
    );

    // response_reset emitted (frontend discards hallucinated text)
    const resetEvents = events.filter((e) => e.type === "response_reset");
    expect(resetEvents.length).toBeGreaterThanOrEqual(1);
    expect((resetEvents[0] as { reason: string }).reason).toContain(
      "intent_proposal",
    );

    // create_intent tool was auto-invoked
    const createIntentTool = capturedTools.find(
      (t) => t.name === "create_intent",
    )!;
    expect(createIntentTool.invoke).toHaveBeenCalledTimes(1);

    // Tool called with extracted description
    const callArgs = createIntentTool.invoke.mock.calls[0][0] as Record<
      string,
      string
    >;
    expect(callArgs.description).toBe(
      "AI-focused software engineering lead",
    );

    // tool_activity start+end events emitted
    const toolStarts = events.filter(
      (e) =>
        e.type === "tool_activity" &&
        (e as any).phase === "start" &&
        (e as any).name === "create_intent",
    );
    const toolEnds = events.filter(
      (e) =>
        e.type === "tool_activity" &&
        (e as any).phase === "end" &&
        (e as any).name === "create_intent",
    );
    expect(toolStarts.length).toBe(1);
    expect(toolEnds.length).toBe(1);
    expect((toolEnds[0] as any).success).toBe(true);

    // Final response is the clean follow-up
    expect(result.responseText).toBe(normalFollowUp);
    expect(callCount).toBe(2);
  }, 15000);

  it("auto-invokes discover_opportunities when hallucinated opportunity block is detected", async () => {
    const agent = await ChatAgent.create({
      database: {
        getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com", location: null, socials: {} }),
        getProfile: async () => null,
        getNetworkMemberships: async () => [],
      } as any,
      embedder: {} as any,
      scraper: {} as any,
      userId: "test-user",
      sessionId: "test-session",
      cache: {} as any,
      hydeCache: {} as any,
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    });

    const hallucinatedText = `I found matches:

\`\`\`opportunity
{ "name": "Blockchain developer meetup", "reasoning": "Aligns with interests" }
\`\`\``;

    const normalFollowUp =
      "I've searched for opportunities matching your interests.";

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) return makeTextStream(hallucinatedText);
      return makeTextStream(normalFollowUp);
    });

    const { events, writer } = createEventCollector();
    await agent.streamRun(
      [new HumanMessage("Find me connections in blockchain")],
      writer,
    );

    // discover_opportunities auto-invoked with searchQuery from user's message (not hallucinated block)
    const createOpsTool = capturedTools.find(
      (t) => t.name === "discover_opportunities",
    )!;
    expect(createOpsTool.invoke).toHaveBeenCalledTimes(1);
    const callArgs = createOpsTool.invoke.mock.calls[0][0] as Record<
      string,
      string
    >;
    expect(callArgs.searchQuery).toBe("Find me connections in blockchain");

    // response_reset emitted
    const resetEvents = events.filter((e) => e.type === "response_reset");
    expect(resetEvents.length).toBeGreaterThanOrEqual(1);
    expect((resetEvents[0] as { reason: string }).reason).toContain(
      "opportunity",
    );
  }, 15000);

  it("falls back to correction message if auto-invoked tool throws", async () => {
    const agent = await ChatAgent.create({
      database: {
        getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com", location: null, socials: {} }),
        getProfile: async () => null,
        getNetworkMemberships: async () => [],
      } as any,
      embedder: {} as any,
      scraper: {} as any,
      userId: "test-user",
      sessionId: "test-session",
      cache: {} as any,
      hydeCache: {} as any,
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    });

    // Make create_intent throw on invoke
    const createIntentTool = capturedTools.find(
      (t) => t.name === "create_intent",
    )!;
    createIntentTool.invoke = mock(async () => {
      throw new Error("DB connection lost");
    });

    const hallucinatedText = `\`\`\`intent_proposal
{ "description": "Test intent" }
\`\`\``;
    const normalFollowUp = "Let me try calling the tool for you.";

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) return makeTextStream(hallucinatedText);
      return makeTextStream(normalFollowUp);
    });

    const { events, writer } = createEventCollector();
    const result = await agent.streamRun(
      [new HumanMessage("Create an intent")],
      writer,
    );

    // Tool was attempted
    expect(createIntentTool.invoke).toHaveBeenCalledTimes(1);

    // Tool failure emitted
    const toolEnds = events.filter(
      (e) =>
        e.type === "tool_activity" &&
        (e as any).phase === "end" &&
        (e as any).name === "create_intent",
    );
    expect(toolEnds.length).toBe(1);
    expect((toolEnds[0] as any).success).toBe(false);

    // Agent still produced a response via correction fallback + LLM retry
    expect(result.responseText).toBe(normalFollowUp);
    expect(callCount).toBe(2);
  }, 15000);

  it("does not trigger hallucination detection when model makes a real tool call", async () => {
    const agent = await ChatAgent.create({
      database: {
        getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com", location: null, socials: {} }),
        getProfile: async () => null,
        getNetworkMemberships: async () => [],
      } as any,
      embedder: {} as any,
      scraper: {} as any,
      userId: "test-user",
      sessionId: "test-session",
      cache: {} as any,
      hydeCache: {} as any,
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    });

    // Model returns a tool call (not hallucinated text)
    let streamCallCount = 0;
    mockModelInstance.stream = mock(() => {
      streamCallCount++;
      if (streamCallCount === 1) {
        return (async function* () {
          yield new AIMessageChunk({
            content: "Creating your intent now...",
            tool_calls: [
              {
                id: "tc-1",
                name: "create_intent",
                args: { description: "Real intent" },
              },
            ],
          });
        })();
      }
      return makeTextStream("Done! Your intent has been created.");
    });

    const { events, writer } = createEventCollector();
    await agent.streamRun(
      [new HumanMessage("Create an intent for me")],
      writer,
    );

    // No hallucination response_reset should have been emitted
    const hallucinationResets = events.filter(
      (e) =>
        e.type === "response_reset" &&
        (e as { reason: string }).reason.includes("Hallucinated"),
    );
    expect(hallucinationResets.length).toBe(0);
  }, 15000);
});

describe("ChatAgent streamRun — debugMeta.llm accumulator", () => {
  it("increments llm.calls on each llm_start", async () => {
    // Create agent first — this sets mockModelInstance via the mock.module factory
    const agent = await ChatAgent.create({
      database: {
        getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com", location: null, socials: {} }),
        getProfile: async () => null,
        getNetworkMemberships: async () => [],
      } as any,
      embedder: {} as any,
      scraper: {} as any,
      userId: "test-user",
      sessionId: "test-session",
      cache: {} as any,
      hydeCache: {} as any,
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    });

    // mockModelInstance is now set — override stream to return a plain response
    if (!mockModelInstance) {
      throw new Error("mockModelInstance not set after ChatAgent.create()");
    }
    mockModelInstance.stream = mock(() =>
      makeTextStream("Here is a plain response with no tool calls."),
    );

    const { writer } = createEventCollector();
    const result = await agent.streamRun(
      [new HumanMessage("Hello, what can you do?")],
      writer,
    );

    expect(result.debugMeta.llm.calls).toBe(1);
    expect(result.debugMeta.llm.totalDurationMs).toBeGreaterThan(0);
    expect(Array.isArray(result.debugMeta.llm.resets)).toBe(true);
    expect(Array.isArray(result.debugMeta.llm.hallucinations)).toBe(true);
  }, 15000);
});

// Restore all module mocks so subsequent test files get the real implementations.
afterAll(() => mock.restore());
