/**
 * P4.0 personafication — persona-gated loop behavior tests.
 *
 * ChatAgent requires an injected ChatPersonaConfig — there is no default.
 * These tests prove that a stub persona with hallucination recovery OFF never
 * triggers it, that a stub with it ON does, and that the injected prompt
 * builder / toolset are the ones actually used.
 */

import { mock, describe, expect, it, afterAll } from "bun:test";

// ─── Mock model.config globally (same pattern as chat.agent.spec.ts) ────────

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

import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { ChatAgent, type AgentStreamEvent } from "../chat.agent.js";
import type { ChatPersonaConfig } from "../chat.persona.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STUB_PROMPT = "You are a stub persona for loop-behavior tests.";

type MockTool = {
  name: string;
  description: string;
  schema: unknown;
  invoke: ReturnType<typeof mock>;
};

function makeMockTools(): MockTool[] {
  return [
    {
      name: "create_intent",
      description: "Create an intent",
      schema: {},
      invoke: mock(async () =>
        JSON.stringify({ success: true, data: { intentId: "mock-intent-1", summary: "Intent created" } }),
      ),
    },
  ];
}

function makePersona(
  tools: MockTool[],
  loopBehaviors: ChatPersonaConfig["loopBehaviors"],
): ChatPersonaConfig {
  return {
    id: "stub",
    buildSystemContent: () => STUB_PROMPT,
    createTools: async () => tools as unknown as Awaited<ReturnType<ChatPersonaConfig["createTools"]>>,
    loopBehaviors,
  };
}

function createTestAgent(persona: ChatPersonaConfig) {
  return ChatAgent.create(
    {
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
      intentFollowUp: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      createUserDatabase: () => ({}) as any,
      createSystemDatabase: () => ({}) as any,
    } as any,
    persona,
  );
}

function makeTextStream(text: string): AsyncIterable<AIMessageChunk> {
  return (async function* () {
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
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

describe("ChatAgent persona injection", () => {
  it("uses the persona's prompt builder for the system message", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { hallucinationRecovery: false }),
    );

    mockModelInstance.stream = mock(() => makeTextStream("Hello from stub."));

    const { writer } = createEventCollector();
    await agent.streamRun([new HumanMessage("hi")], writer);

    const streamedMessages = mockModelInstance.stream.mock.calls[0][0] as BaseMessage[];
    expect(streamedMessages[0]).toBeInstanceOf(SystemMessage);
    expect(streamedMessages[0].content).toBe(STUB_PROMPT);
  }, 15000);

  it("uses the persona's toolset for tool execution", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { hallucinationRecovery: false }),
    );

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{ id: "tc-1", name: "create_intent", args: { description: "Find people" } }],
          });
        })();
      }
      return makeTextStream("Done.");
    });

    const { writer } = createEventCollector();
    await agent.streamRun([new HumanMessage("find people")], writer);

    const createIntent = tools.find((t) => t.name === "create_intent")!;
    expect(createIntent.invoke).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe("ChatAgent loop behaviors — persona-gated", () => {
  it("hallucinationRecovery OFF: hallucinated blocks are neither auto-invoked nor stripped", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { hallucinationRecovery: false }),
    );

    const hallucinatedText = `Here you go:

\`\`\`intent_proposal
{ "description": "Fabricated intent" }
\`\`\`

Done!`;

    mockModelInstance.stream = mock(() => makeTextStream(hallucinatedText));

    const { events, writer } = createEventCollector();
    const result = await agent.streamRun([new HumanMessage("make me an intent")], writer);

    // No tool auto-invocation
    const createIntent = tools.find((t) => t.name === "create_intent")!;
    expect(createIntent.invoke).toHaveBeenCalledTimes(0);

    // No hallucination events, no resets
    expect(events.filter((e) => e.type === "hallucination_detected").length).toBe(0);
    expect(events.filter((e) => e.type === "response_reset").length).toBe(0);

    // Text passes through unmodified (no stripUnbackedBlocks)
    expect(result.responseText).toBe(hallucinatedText);

    // Single LLM call — no correction/recovery iterations
    expect(mockModelInstance.stream).toHaveBeenCalledTimes(1);
  }, 15000);

  it("hallucinationRecovery ON: hallucinated block triggers auto-invoke", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { hallucinationRecovery: true }),
    );

    const hallucinatedText = `\`\`\`intent_proposal
{ "description": "Legit-looking intent" }
\`\`\``;

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) return makeTextStream(hallucinatedText);
      return makeTextStream("Created it for real.");
    });

    const { events, writer } = createEventCollector();
    const result = await agent.streamRun([new HumanMessage("make me an intent")], writer);

    const createIntent = tools.find((t) => t.name === "create_intent")!;
    expect(createIntent.invoke).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.type === "hallucination_detected").length).toBe(1);
    expect(result.responseText).toBe("Created it for real.");
  }, 15000);
});

// Restore all module mocks so subsequent test files get the real implementations.
afterAll(() => mock.restore());
