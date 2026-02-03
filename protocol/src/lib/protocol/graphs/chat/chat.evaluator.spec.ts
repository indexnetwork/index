/**
 * Chat Agent Evaluation Tests
 *
 * Runs user need fulfillment tests against the chat agent.
 * Tests are generative - scenarios are created dynamically based on
 * user needs, personas, and contexts.
 */

import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it, beforeAll } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGraphFactory } from "./chat.graph";
import {
  ScenarioGenerator,
  runNeedFulfillmentTest,
  runTestSuite,
  USER_NEEDS,
  USER_PERSONAS,
  USER_JOURNEYS,
  type ChatAgentInterface,
  type GeneratedScenario,
  type UserNeedId,
  type UserPersonaId,
  type UserJourneyId,
} from "./chat.evaluator";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a mock database that simulates realistic state.
 */
function createStatefulMockDatabase(): ChatGraphCompositeDatabase & { _state: any } {
  const state = {
    profile: null as any,
    intents: [] as any[],
    indexes: [
      { id: "idx-1", title: "AI Founders", prompt: "AI startup founders" },
      { id: "idx-2", title: "ML Engineers", prompt: "Machine learning engineers" },
    ],
    memberships: [{ indexId: "idx-1", role: "member" }],
  };

  return {
    _state: state,

    getProfile: async () => state.profile,

    saveProfile: async (userId: string, profile: any) => {
      state.profile = { ...profile, userId, updatedAt: new Date() };
    },

    saveHydeProfile: async () => {},

    getActiveIntents: async () => state.intents.filter((i) => !i.deletedAt),

    getIntentsInIndexForMember: async (indexId: string) =>
      state.intents.filter((i) => i.indexId === indexId && !i.deletedAt),

    createIntent: async (data: any) => {
      const intent = {
        id: `intent-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        payload: data.payload,
        summary: data.payload.slice(0, 100),
        userId: data.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        isIncognito: false,
      };
      state.intents.push(intent);
      return intent;
    },

    updateIntent: async (intentId: string, updates: any) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (intent) {
        Object.assign(intent, updates, { updatedAt: new Date() });
        return intent;
      }
      return null;
    },

    archiveIntent: async (intentId: string) => {
      const intent = state.intents.find((i) => i.id === intentId);
      if (intent) {
        intent.deletedAt = new Date();
        return { success: true };
      }
      return { success: false };
    },

    getUser: async () => ({ id: "test-user", email: "test@example.com" }),

    getUserIndexIds: async () => state.memberships.map((m) => m.indexId),

    getIndexMemberships: async () =>
      state.memberships.map((m) => ({
        ...m,
        index: state.indexes.find((i) => i.id === m.indexId),
      })),

    getIntentForIndexing: async () => null,
    getIndexMemberContext: async () => null,
    isIntentAssignedToIndex: async () => false,
    assignIntentToIndex: async () => {},
    unassignIntentFromIndex: async () => {},

    getOwnedIndexes: async () => [],
    isIndexOwner: async () => false,
    getIndexMembersForOwner: async () => [],
    getIndexIntentsForOwner: async () => [],
    updateIndexSettings: async () => ({}) as any,
  } as unknown as ChatGraphCompositeDatabase & { _state: any };
}

const mockEmbedder: Embedder = {
  generate: async () => new Array(2000).fill(0),
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const mockScraper: Scraper = {
  scrape: async () => "Scraped content from the page.",
  extractUrlContent: async (url: string) =>
    `Content from ${url}: This is a professional profile page showing experience in software engineering, AI/ML, and startup building.`,
} as unknown as Scraper;

/**
 * Wrap the ChatGraph as a ChatAgentInterface for the evaluator.
 */
function createChatAgentAdapter(
  database: ChatGraphCompositeDatabase
): ChatAgentInterface & { getToolsUsed: () => string[] } {
  const factory = new ChatGraphFactory(database, mockEmbedder, mockScraper);
  let graph = factory.createGraph();
  let messages: any[] = [];
  let toolsUsed: string[] = [];

  return {
    async chat(message: string) {
      messages.push(new HumanMessage(message));

      const result = await graph.invoke({
        userId: "test-eval-user",
        messages,
      });

      messages = result.messages;

      // Extract tools used from messages (AIMessages with tool_calls)
      const newTools: string[] = [];
      for (const msg of result.messages) {
        if (msg.tool_calls?.length) {
          for (const tc of msg.tool_calls) {
            newTools.push(tc.name);
          }
        }
      }
      toolsUsed.push(...newTools);

      return {
        response: result.responseText || "",
        toolsUsed: newTools,
      };
    },

    reset() {
      graph = factory.createGraph();
      messages = [];
      toolsUsed = [];
    },

    getToolsUsed() {
      return toolsUsed;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO GENERATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario Generation", () => {
  it("should generate diverse messages for EXPRESS_WANT need", async () => {
    const generator = new ScenarioGenerator();
    const scenarios = await generator.generateScenariosForNeed("EXPRESS_WANT", 3);

    expect(scenarios.length).toBe(3);

    // Each scenario should have different persona
    const personas = new Set(scenarios.map((s) => s.persona.id));
    expect(personas.size).toBeGreaterThan(1);

    // Messages should be non-empty and different
    const messages = scenarios.map((s) => s.generatedMessage);
    expect(messages.every((m) => m.length > 5)).toBe(true);

    console.log("\nGenerated EXPRESS_WANT scenarios:");
    for (const s of scenarios) {
      console.log(`  [${s.persona.id}]: "${s.generatedMessage}"`);
    }
  }, 60000);

  it("should generate journey scenarios with context progression", async () => {
    const generator = new ScenarioGenerator();
    const scenarios = await generator.generateJourneyScenario("ONBOARDING_FLOW", "NEW_USER");

    expect(scenarios.length).toBe(3); // ESTABLISH_PRESENCE, EXPRESS_WANT, FIND_PEOPLE

    // Context should evolve
    expect(scenarios[0].context.hasProfile).toBe(false);
    expect(scenarios[1].context.hasProfile).toBe(true); // After ESTABLISH_PRESENCE

    console.log("\nGenerated ONBOARDING_FLOW journey:");
    for (const s of scenarios) {
      console.log(`  [${s.need.id}]: "${s.generatedMessage}"`);
    }
  }, 90000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLE NEED FULFILLMENT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Need Fulfillment - Single Needs", () => {
  let database: ChatGraphCompositeDatabase;
  let chatAgent: ChatAgentInterface;
  let generator: ScenarioGenerator;

  beforeAll(() => {
    database = createStatefulMockDatabase();
    chatAgent = createChatAgentAdapter(database);
    generator = new ScenarioGenerator();
  });

  it("should fulfill EXPRESS_WANT need", async () => {
    const scenarios = await generator.generateScenariosForNeed("EXPRESS_WANT", 1);
    const result = await runNeedFulfillmentTest(scenarios[0], chatAgent, {
      verbose: true,
      maxTurns: 3,
      timeoutMs: 90000,
    });

    console.log("\n=== EXPRESS_WANT Result ===");
    console.log(`Verdict: ${result.evaluation.overallVerdict}`);
    console.log(`Score: ${result.evaluation.fulfillmentScore}`);
    console.log(`Reasoning: ${result.evaluation.reasoning}`);
    console.log(`Tools: ${result.metadata.toolsUsed.join(", ")}`);

    // We expect success or partial - the agent should at least try
    expect(["success", "partial"]).toContain(result.evaluation.overallVerdict);
  }, 120000);

  it("should fulfill FIND_PEOPLE need", async () => {
    const scenarios = await generator.generateScenariosForNeed("FIND_PEOPLE", 1);
    const result = await runNeedFulfillmentTest(scenarios[0], chatAgent, {
      verbose: true,
      maxTurns: 3,
      timeoutMs: 90000,
    });

    console.log("\n=== FIND_PEOPLE Result ===");
    console.log(`Verdict: ${result.evaluation.overallVerdict}`);
    console.log(`Reasoning: ${result.evaluation.reasoning}`);

    // Agent should use discovery tool
    expect(result.metadata.toolsUsed.length).toBeGreaterThan(0);
  }, 120000);

  it("should handle UNDERSTAND_SYSTEM need without tools", async () => {
    const scenarios = await generator.generateScenariosForNeed("UNDERSTAND_SYSTEM", 1);
    const result = await runNeedFulfillmentTest(scenarios[0], chatAgent, {
      verbose: true,
      maxTurns: 2,
      timeoutMs: 60000,
    });

    console.log("\n=== UNDERSTAND_SYSTEM Result ===");
    console.log(`Verdict: ${result.evaluation.overallVerdict}`);
    console.log(`Reasoning: ${result.evaluation.reasoning}`);

    // Should have a conversation at minimum
    expect(result.conversation.length).toBeGreaterThan(0);
  }, 90000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PERSONA VARIATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Need Fulfillment - Persona Variations", () => {
  let database: ChatGraphCompositeDatabase;
  let chatAgent: ChatAgentInterface;
  let generator: ScenarioGenerator;

  beforeAll(() => {
    database = createStatefulMockDatabase();
    chatAgent = createChatAgentAdapter(database);
    generator = new ScenarioGenerator();
  });

  const testPersonas: UserPersonaId[] = ["BUSY_FOUNDER", "VAGUE_USER", "NON_NATIVE_SPEAKER"];

  for (const personaId of testPersonas) {
    it(`should handle ${personaId} persona for EXPRESS_WANT`, async () => {
      const need = USER_NEEDS.EXPRESS_WANT;
      const persona = USER_PERSONAS[personaId];

      const scenario: GeneratedScenario = {
        id: `test-${personaId}`,
        need,
        persona,
        context: { hasProfile: true, hasIntents: false, isIndexOwner: false },
        generatedMessage: await generator.generateMessage(need, persona, {
          hasProfile: true,
          hasIntents: false,
          isIndexOwner: false,
        }),
        evaluationCriteria: {
          needFulfilled: need.description,
          successSignals: need.successSignals,
          failureSignals: need.failureSignals,
          qualityFactors: ["Adapted to user's communication style"],
        },
      };

      const result = await runNeedFulfillmentTest(scenario, chatAgent, {
        verbose: true,
        maxTurns: 3,
        timeoutMs: 90000,
      });

      console.log(`\n=== ${personaId} Result ===`);
      console.log(`Message: "${scenario.generatedMessage}"`);
      console.log(`Verdict: ${result.evaluation.overallVerdict}`);
      console.log(`Quality: ${result.evaluation.qualityScore}`);

      // Agent should handle all personas - conversation should happen
      expect(result.conversation.length).toBeGreaterThan(0);
    }, 120000);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// JOURNEY TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Need Fulfillment - User Journeys", () => {
  let generator: ScenarioGenerator;

  beforeAll(() => {
    generator = new ScenarioGenerator();
  });

  it("should complete ONBOARDING_FLOW journey", async () => {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);

    const scenarios = await generator.generateJourneyScenario("ONBOARDING_FLOW", "NEW_USER");

    console.log("\n=== ONBOARDING_FLOW Journey ===");

    const results = [];
    for (const scenario of scenarios) {
      // Don't reset between journey steps - maintain context
      const result = await runNeedFulfillmentTest(scenario, chatAgent, {
        verbose: true,
        maxTurns: 2,
        timeoutMs: 60000,
      });
      results.push(result);
    }

    // At least some conversations should happen
    const withConversation = results.filter((r) => r.conversation.length > 0).length;
    console.log(`\nJourney conversations: ${withConversation}/${results.length}`);

    expect(withConversation).toBeGreaterThanOrEqual(2);
  }, 240000);

  it("should complete INTENT_LIFECYCLE journey", async () => {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);

    const scenarios = await generator.generateJourneyScenario("INTENT_LIFECYCLE", "POWER_USER");

    console.log("\n=== INTENT_LIFECYCLE Journey ===");

    const results = [];
    for (const scenario of scenarios) {
      const result = await runNeedFulfillmentTest(scenario, chatAgent, {
        verbose: true,
        maxTurns: 2,
        timeoutMs: 60000,
      });
      results.push(result);
    }

    const withConversation = results.filter((r) => r.conversation.length > 0).length;
    console.log(`\nJourney conversations: ${withConversation}/${results.length}`);

    expect(withConversation).toBeGreaterThanOrEqual(2);
  }, 240000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPREHENSIVE TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

describe("Comprehensive Test Suite", () => {
  it("should run full test suite across all needs", async () => {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);
    const generator = new ScenarioGenerator();

    // Only test 2 needs for speed
    const testNeeds: UserNeedId[] = ["EXPRESS_WANT", "UNDERSTAND_SYSTEM"];

    const allScenarios: GeneratedScenario[] = [];
    for (const needId of testNeeds) {
      const scenarios = await generator.generateScenariosForNeed(needId, 1);
      allScenarios.push(...scenarios);
    }

    console.log(`\nRunning ${allScenarios.length} scenarios...`);

    const { results, summary } = await runTestSuite(allScenarios, chatAgent, { verbose: false });

    console.log("\n=== TEST SUITE SUMMARY ===");
    console.log(`Total: ${summary.total}`);
    console.log(`Success: ${summary.success}`);
    console.log(`Partial: ${summary.partial}`);
    console.log(`Failure: ${summary.failure}`);
    console.log(`Blocked: ${summary.blocked}`);

    // At least some conversations should complete
    expect(results.some((r) => r.conversation.length > 0)).toBe(true);
  }, 300000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// REGRESSION DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe("Regression Detection", () => {
  it("should not leak internal JSON in any response", async () => {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database);
    const generator = new ScenarioGenerator();

    const scenarios = await generator.generateScenariosForNeed("EXPRESS_WANT", 1);

    const jsonLeakPatterns = [
      '"classification"',
      '"felicity_scores"',
      '"indexScore"',
      '"semantic_entropy"',
      '"intentMode"',
    ];

    const result = await runNeedFulfillmentTest(scenarios[0], chatAgent, {
      verbose: false,
      maxTurns: 2,
      timeoutMs: 60000,
    });

    for (const turn of result.conversation) {
      if (turn.role === "assistant") {
        for (const pattern of jsonLeakPatterns) {
          if (turn.content.includes(pattern)) {
            console.error(`JSON leak detected in: ${turn.content.slice(0, 200)}`);
          }
          expect(turn.content).not.toContain(pattern);
        }
      }
    }
  }, 90000);

  it("should always use get_active_intents before delete_intent", async () => {
    const database = createStatefulMockDatabase();
    const chatAgent = createChatAgentAdapter(database) as ChatAgentInterface & { getToolsUsed: () => string[] };
    const generator = new ScenarioGenerator();

    // Pre-populate with an intent
    (database as any)._state.intents.push({
      id: "intent-to-delete",
      payload: "Looking for ML engineers",
      summary: "Hiring ML engineers",
      userId: "test-eval-user",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const scenarios = await generator.generateScenariosForNeed("WITHDRAW_INTENT", 1);
    await runNeedFulfillmentTest(scenarios[0], chatAgent, {
      verbose: true,
      maxTurns: 3,
      timeoutMs: 90000,
    });

    const toolsUsed = chatAgent.getToolsUsed();
    console.log("Tools used:", toolsUsed);

    // If delete_intent was called, get_active_intents should have been called first
    if (toolsUsed.includes("delete_intent")) {
      const deleteIndex = toolsUsed.indexOf("delete_intent");
      const getIndex = toolsUsed.indexOf("get_active_intents");
      expect(getIndex).toBeLessThan(deleteIndex);
    }
  }, 120000);
});
