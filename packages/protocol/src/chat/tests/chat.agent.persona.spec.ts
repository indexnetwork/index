/**
 * P4.0 personafication — persona-gated loop behavior tests.
 *
 * ChatAgent accepts an injected ChatPersonaConfig. The orchestrator persona
 * keeps the create-intent callback and hallucination recovery ON (covered by
 * chat.agent.spec.ts via the default persona); these tests prove that a stub
 * persona with behaviors OFF never triggers them, and that the injected
 * prompt builder / toolset are actually used.
 */

// Env must be set before any imports that transitively call createModel
import { config } from "dotenv";
config({ path: ".env.test", override: true });
process.env.OPENROUTER_API_KEY = "test-key-for-unit-tests";
process.env.NODE_ENV = "test";

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
import { resolveReporterDeterministicResponse } from "../reporter.prompt.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

const STUB_PROMPT = "You are a stub persona for loop-behavior tests.";

type MockTool = {
  name: string;
  description: string;
  schema: unknown;
  invoke: ReturnType<typeof mock>;
};

function makeMockTools(opts?: { discoverSuggestsIntent?: boolean }): MockTool[] {
  const discoverResult = opts?.discoverSuggestsIntent
    ? JSON.stringify({
        success: true,
        data: {
          createIntentSuggested: true,
          suggestedIntentDescription: "Suggested intent from discovery",
          summary: "Found 0 match(es)",
        },
      })
    : JSON.stringify({
        success: true,
        data: { count: 2, summary: "Found 2 match(es)" },
      });

  return [
    {
      name: "create_intent",
      description: "Create an intent",
      schema: {},
      invoke: mock(async () =>
        JSON.stringify({ success: true, data: { intentId: "mock-intent-1", summary: "Intent created" } }),
      ),
    },
    {
      name: "discover_opportunities",
      description: "Find opportunities",
      schema: {},
      invoke: mock(async () => discoverResult),
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
      integration: {} as any,
      intentQueue: {} as any,
      contactService: {} as any,
      chatSession: {} as any,
      enricher: {} as any,
      negotiationDatabase: {} as any,
      integrationImporter: {} as any,
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
      makePersona(tools, { createIntentCallback: false, hallucinationRecovery: false }),
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
      makePersona(tools, { createIntentCallback: false, hallucinationRecovery: false }),
    );

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{ id: "tc-1", name: "discover_opportunities", args: { searchQuery: "x" } }],
          });
        })();
      }
      return makeTextStream("Done.");
    });

    const { writer } = createEventCollector();
    await agent.streamRun([new HumanMessage("find people")], writer);

    const discover = tools.find((t) => t.name === "discover_opportunities")!;
    expect(discover.invoke).toHaveBeenCalledTimes(1);
  }, 15000);

  it("bypasses the model and tools for contextual reporter confirmations only", async () => {
    const tools: MockTool[] = ["report_agent_activity", "propose_cleanup_actions"].map((name) => ({
      name,
      description: name,
      schema: {},
      invoke: mock(async () => JSON.stringify({ success: true })),
    }));
    const persona = makePersona(
      tools,
      { createIntentCallback: false, hallucinationRecovery: false },
    );
    persona.resolveDeterministicResponse = (_ctx, iterCtx) => resolveReporterDeterministicResponse(iterCtx);
    const agent = await createTestAgent(persona);
    const proposal = new AIMessage({
      content: [
        "```agent_action_proposal",
        JSON.stringify({
          proposalId: "11111111-1111-4111-8111-111111111111",
          actions: [{
            type: "pause_signal",
            entityId: "22222222-2222-4222-8222-222222222222",
            currentState: "ACTIVE",
            proposedOperation: "PAUSE_SIGNAL",
          }],
        }),
        "```",
      ].join("\n"),
    });

    for (const phrase of [
      "i confirm",
      "confirm",
      "confirm it",
      "approve",
      "approved",
      "approve it",
      "i approve",
      "yes",
      "yes i confirm",
      "yes please",
      "please do it",
      "proceed",
      "go ahead",
    ]) {
      const { events, writer } = createEventCollector();
      const result = await agent.streamRun([
        new HumanMessage("Review my signals"),
        proposal,
        new HumanMessage(phrase),
      ], writer);
      expect(result.responseText).toContain("visible proposal card's Confirm control");
      expect(result.debugMeta.llm.calls).toBe(0);
      expect(events.some((event) => event.type === "llm_start")).toBe(false);
    }

    const iteration = await agent.runIteration([
      new HumanMessage("Review my signals"),
      proposal,
      new HumanMessage("confirm it"),
    ], 0);
    expect(iteration.responseText).toContain("visible proposal card's Confirm control");
    expect(iteration.shouldContinue).toBe(false);
    expect(mockModelInstance.stream).not.toHaveBeenCalled();
    for (const candidate of tools) expect(candidate.invoke).not.toHaveBeenCalled();

    mockModelInstance.stream = mock(() => makeTextStream("Ordinary response."));
    const ordinary = await agent.streamRun([new HumanMessage("yes")]);
    expect(ordinary.responseText).toBe("Ordinary response.");
    expect(mockModelInstance.stream).toHaveBeenCalledTimes(1);
  }, 15000);
});

describe("ChatAgent loop behaviors — persona-gated", () => {
  it("createIntentCallback OFF: discovery createIntentSuggested does NOT auto-create an intent", async () => {
    const tools = makeMockTools({ discoverSuggestsIntent: true });
    const agent = await createTestAgent(
      makePersona(tools, { createIntentCallback: false, hallucinationRecovery: false }),
    );

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{ id: "tc-1", name: "discover_opportunities", args: { searchQuery: "ai" } }],
          });
        })();
      }
      return makeTextStream("No matches found.");
    });

    const { writer } = createEventCollector();
    await agent.streamRun([new HumanMessage("find ai people")], writer);

    const createIntent = tools.find((t) => t.name === "create_intent")!;
    const discover = tools.find((t) => t.name === "discover_opportunities")!;
    expect(createIntent.invoke).toHaveBeenCalledTimes(0);
    expect(discover.invoke).toHaveBeenCalledTimes(1); // no re-run either
  }, 15000);

  it("createIntentCallback ON: discovery createIntentSuggested auto-creates intent and re-runs discovery", async () => {
    const tools = makeMockTools({ discoverSuggestsIntent: true });
    const agent = await createTestAgent(
      makePersona(tools, { createIntentCallback: true, hallucinationRecovery: true }),
    );

    let callCount = 0;
    mockModelInstance.stream = mock(() => {
      callCount++;
      if (callCount === 1) {
        return (async function* () {
          yield new AIMessageChunk({
            content: "",
            tool_calls: [{ id: "tc-1", name: "discover_opportunities", args: { searchQuery: "ai" } }],
          });
        })();
      }
      return makeTextStream("Created an intent and looked again.");
    });

    const { writer } = createEventCollector();
    await agent.streamRun([new HumanMessage("find ai people")], writer);

    const createIntent = tools.find((t) => t.name === "create_intent")!;
    const discover = tools.find((t) => t.name === "discover_opportunities")!;
    expect(createIntent.invoke).toHaveBeenCalledTimes(1);
    expect(discover.invoke).toHaveBeenCalledTimes(2); // original + post-intent re-run
  }, 15000);

  it("hallucinationRecovery OFF: hallucinated blocks are neither auto-invoked nor stripped", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { createIntentCallback: false, hallucinationRecovery: false }),
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

  it("hallucinationRecovery ON: hallucinated block triggers auto-invoke (orchestrator behavior preserved)", async () => {
    const tools = makeMockTools();
    const agent = await createTestAgent(
      makePersona(tools, { createIntentCallback: true, hallucinationRecovery: true }),
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
