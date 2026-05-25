/**
 * Chat Prompt Multi-Step Tests: verify module activation across iterations and turns.
 *
 * Unlike chat.prompt.modules.spec.ts (single-step triggers) and
 * chat.prompt.dynamic.spec.ts (LLM-driven behavioral tests), these tests
 * simulate realistic multi-iteration and multi-turn conversations by building
 * up message histories and asserting which modules are injected at each step.
 *
 * No LLM calls — purely deterministic buildSystemContent / resolveModules checks.
 */
/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, test, expect } from "bun:test";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";

import type { ResolvedToolContext } from "../../shared/agent/tool.factory.js";
import { buildSystemContent } from "../chat.prompt.js";
import {
  extractRecentToolCalls,
  resolveModules,
  type IterationContext,
} from "../chat.prompt.modules.js";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(
  overrides: Partial<ResolvedToolContext> = {},
): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice Test",
    userEmail: "alice@example.com",
    user: { id: "user-1", name: "Alice Test", email: "alice@example.com" },
    userProfile: { bio: "Builder", skills: ["typescript"], interests: ["AI"] },
    userNetworks: [
      {
        networkId: "idx-personal",
        networkTitle: "My Network",
        indexPrompt: null,
        permissions: ["owner"],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: true,
        joinedAt: "2024-01-01T00:00:00Z",
      },
      {
        networkId: "idx-community",
        networkTitle: "AI Builders",
        indexPrompt: "AI enthusiasts",
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: "2024-02-01T00:00:00Z",
      },
    ],
    isOnboarding: false,
    hasName: true,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

/** Build an IterationContext from a message array, optionally overriding ctx. */
function iterCtxFrom(
  messages: BaseMessage[],
  ctx?: ResolvedToolContext,
): IterationContext {
  const lastHuman = messages
    .filter((m) => m._getType() === "human")
    .pop();
  return {
    recentTools: extractRecentToolCalls(messages),
    currentMessage:
      lastHuman && typeof lastHuman.content === "string"
        ? lastHuman.content
        : undefined,
    ctx: ctx ?? makeCtx(),
  };
}

let tcCounter = 0;
function tcId(): string {
  return `tc-${++tcCounter}`;
}

/** Append a tool call (AIMessage + ToolMessage) to a message array. Returns new array. */
function withToolCall(
  messages: BaseMessage[],
  name: string,
  args: Record<string, unknown> = {},
  toolResult = "ok",
): BaseMessage[] {
  const id = tcId();
  return [
    ...messages,
    new AIMessage({
      content: "",
      tool_calls: [{ id, name, args, type: "tool_call" as const }],
    }),
    new ToolMessage({ tool_call_id: id, content: toolResult, name }),
  ];
}

/** Append a new user turn (HumanMessage) to a message array. */
function withUserTurn(
  messages: BaseMessage[],
  text: string,
): BaseMessage[] {
  return [...messages, new HumanMessage(text)];
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("Multi-step: discovery flow", () => {
  test("iteration 1 (no tools yet) → no modules; iteration 2 (after discover_opportunities) → discovery module", () => {
    const ctx = makeCtx();

    // Iteration 1: user just sent the message, no tool calls yet
    const iter1Messages = [new HumanMessage("find me a mentor in AI")];
    const iter1 = iterCtxFrom(iter1Messages, ctx);
    const iter1Result = resolveModules(iter1);
    expect(iter1Result).toBe("");

    // Iteration 2: agent called discover_opportunities
    const iter2Messages = withToolCall(iter1Messages, "discover_opportunities", {
      searchQuery: "mentor in AI",
    });
    const iter2 = iterCtxFrom(iter2Messages, ctx);
    const iter2Result = resolveModules(iter2);
    expect(iter2Result).toContain("### 1. User wants to find connections or discover");
    expect(iter2Result).toContain("### 7. Opportunities in chat");
    expect(iter2Result).not.toContain("### 6. Introduce two people");
  });

  test("discovery module persists across iterations within same turn", () => {
    const ctx = makeCtx();

    // Iteration 2: agent called discover_opportunities
    let messages: BaseMessage[] = [new HumanMessage("find me a mentor")];
    messages = withToolCall(messages, "discover_opportunities", { searchQuery: "mentor" });

    // Iteration 3: agent then called read_user_profiles (person-lookup joins)
    messages = withToolCall(messages, "read_user_profiles", { query: "Bob" });

    const iterCtx = iterCtxFrom(messages, ctx);
    const result = resolveModules(iterCtx);

    // Both modules should be active
    expect(result).toContain("### 1. User wants to find connections or discover");
    expect(result).toContain("### 0. User asks about a specific person by name");
  });
});

describe("Multi-step: discovery → signal follow-up (multi-turn)", () => {
  test("turn 2 resets tool context; create_intent activates intent-creation module", () => {
    const ctx = makeCtx();

    // Turn 1: discovery
    let turn1: BaseMessage[] = [new HumanMessage("find me a mentor in AI")];
    turn1 = withToolCall(turn1, "discover_opportunities", { searchQuery: "mentor" });

    // Verify turn 1 has discovery module
    const turn1Ctx = iterCtxFrom(turn1, ctx);
    expect(resolveModules(turn1Ctx)).toContain("### 1. User wants to find connections");

    // Turn 2: user sends follow-up
    let turn2 = withUserTurn(turn1, "yes, create a signal for that");

    // Before any tool calls in turn 2 → no modules (tool context reset)
    const turn2PreTool = iterCtxFrom(turn2, ctx);
    expect(resolveModules(turn2PreTool)).toBe("");

    // Agent calls create_intent in turn 2
    turn2 = withToolCall(turn2, "create_intent", {
      description: "Looking for a mentor in AI",
    });

    const turn2PostTool = iterCtxFrom(turn2, ctx);
    const turn2Result = resolveModules(turn2PostTool);

    // Intent-creation active, discovery gone (no discover_opportunities in turn 2)
    expect(turn2Result).toContain("### 2. User explicitly wants to create or save an intent");
    expect(turn2Result).not.toContain("### 1. User wants to find connections");
  });
});

describe("Multi-step: person lookup → direct connection", () => {
  test("@mention triggers mentions module, then read_user_profiles adds person-lookup, then discover_opportunities adds discovery", () => {
    const ctx = makeCtx();

    // Iteration 1: user mentions someone
    let messages: BaseMessage[] = [
      new HumanMessage("tell me about @[Alice Smith](user-alice)"),
    ];
    const iter1 = iterCtxFrom(messages, ctx);
    const iter1Result = resolveModules(iter1);
    // Only mentions module via regex
    expect(iter1Result).toContain("@[Display Name](userId)");
    expect(iter1Result).not.toContain("### 0. User asks about a specific person");

    // Iteration 2: agent looked up the person
    messages = withToolCall(messages, "read_user_profiles", { userId: "user-alice" });
    const iter2 = iterCtxFrom(messages, ctx);
    const iter2Result = resolveModules(iter2);
    // Person-lookup via trigger + mentions via regex
    expect(iter2Result).toContain("### 0. User asks about a specific person by name");
    expect(iter2Result).toContain("@[Display Name](userId)");

    // Iteration 3: agent decides to connect → calls discover_opportunities
    messages = withToolCall(messages, "discover_opportunities", {
      targetUserId: "user-alice",
      searchQuery: "shared interest in AI",
    });
    const iter3 = iterCtxFrom(messages, ctx);
    const iter3Result = resolveModules(iter3);
    // Discovery + person-lookup + mentions all active
    expect(iter3Result).toContain("### 1. User wants to find connections or discover");
    expect(iter3Result).toContain("### 0. User asks about a specific person by name");
    expect(iter3Result).toContain("@[Display Name](userId)");
  });
});

describe("Multi-step: introduction flow with exclusion", () => {
  test("gathering context activates person-lookup + shared-context; discover_opportunities with partyUserIds activates introduction and excludes discovery", () => {
    const ctx = makeCtx();

    // Iteration 1: user asks to introduce two people
    let messages: BaseMessage[] = [
      new HumanMessage("introduce @[Alice](user-a) and @[Bob](user-b)"),
    ];

    // Iteration 2: agent gathers context
    messages = withToolCall(messages, "read_user_profiles", { userId: "user-a" });
    messages = withToolCall(messages, "read_network_memberships", { userId: "user-a" });
    const iter2 = iterCtxFrom(messages, ctx);
    const iter2Result = resolveModules(iter2);
    // person-lookup + shared-context active
    expect(iter2Result).toContain("### 0. User asks about a specific person by name");
    expect(iter2Result).toContain("### 5. Find shared context between two users");
    // No introduction or discovery yet
    expect(iter2Result).not.toContain("### 6. Introduce two people");
    expect(iter2Result).not.toContain("### 1. User wants to find connections");

    // Iteration 3: agent calls discover_opportunities with partyUserIds (introduction)
    messages = withToolCall(messages, "discover_opportunities", {
      partyUserIds: ["user-a", "user-b"],
      entities: [],
    });
    const iter3 = iterCtxFrom(messages, ctx);
    const iter3Result = resolveModules(iter3);
    // Introduction module active
    expect(iter3Result).toContain("### 6. Introduce two people");
    // Discovery module excluded by introduction
    expect(iter3Result).not.toContain("### 1. User wants to find connections or discover");
    // person-lookup and shared-context still active
    expect(iter3Result).toContain("### 0. User asks about a specific person by name");
    expect(iter3Result).toContain("### 5. Find shared context between two users");
  });
});

describe("Multi-step: URL scraping → intent creation", () => {
  test("URL in message triggers scraping module via regex; after scrape_url + create_intent both modules active", () => {
    const ctx = makeCtx();

    // Iteration 1: user sends URL
    let messages: BaseMessage[] = [
      new HumanMessage("check out https://example.com/article and create a signal from it"),
    ];
    const iter1 = iterCtxFrom(messages, ctx);
    const iter1Result = resolveModules(iter1);
    // URL scraping via regex
    expect(iter1Result).toContain("### 3. User includes a URL");
    expect(iter1Result).not.toContain("### 2. User explicitly wants to create");

    // Iteration 2: agent scraped the URL
    messages = withToolCall(messages, "scrape_url", {
      url: "https://example.com/article",
    });
    const iter2 = iterCtxFrom(messages, ctx);
    const iter2Result = resolveModules(iter2);
    // URL scraping still active (both regex and trigger now)
    expect(iter2Result).toContain("### 3. User includes a URL");

    // Iteration 3: agent creates intent from scraped content
    messages = withToolCall(messages, "create_intent", {
      description: "Advances in AI healthcare applications",
    });
    const iter3 = iterCtxFrom(messages, ctx);
    const iter3Result = resolveModules(iter3);
    // Both URL scraping and intent-creation active
    expect(iter3Result).toContain("### 3. User includes a URL");
    expect(iter3Result).toContain("### 2. User explicitly wants to create or save an intent");
  });
});

describe("Multi-step: buildSystemContent integration", () => {
  test("system prompt grows as modules activate across iterations", () => {
    const ctx = makeCtx();

    // Baseline: no iteration context → no modules
    const baseline = buildSystemContent(ctx);
    expect(baseline).not.toContain("### 1. User wants to find connections");

    // Iteration 1: no tools → same as baseline
    const iter1Messages = [new HumanMessage("find people")];
    const iter1Ctx = iterCtxFrom(iter1Messages, ctx);
    const iter1Prompt = buildSystemContent(ctx, iter1Ctx);
    expect(iter1Prompt).toBe(baseline);

    // Iteration 2: after discover_opportunities → modules injected
    const iter2Messages = withToolCall(
      iter1Messages,
      "discover_opportunities",
      { searchQuery: "AI" },
    );
    const iter2Ctx = iterCtxFrom(iter2Messages, ctx);
    const iter2Prompt = buildSystemContent(ctx, iter2Ctx);
    expect(iter2Prompt.length).toBeGreaterThan(baseline.length);
    expect(iter2Prompt).toContain("### 1. User wants to find connections or discover");

    // Core sections remain intact
    expect(iter2Prompt).toContain("You are Index.");
    expect(iter2Prompt).toContain("## Tools Reference");
    expect(iter2Prompt).toContain("### Output Format");
  });

  test("multi-turn: system prompt resets modules when tool context resets", () => {
    const ctx = makeCtx();

    // Turn 1: discovery active
    let turn1: BaseMessage[] = [new HumanMessage("find mentors")];
    turn1 = withToolCall(turn1, "discover_opportunities", { searchQuery: "mentors" });
    const turn1Prompt = buildSystemContent(ctx, iterCtxFrom(turn1, ctx));
    expect(turn1Prompt).toContain("### 1. User wants to find connections");

    // Turn 2: new user message, no tool calls yet → modules reset
    const turn2 = withUserTurn(turn1, "now list my intents");
    const turn2Prompt = buildSystemContent(ctx, iterCtxFrom(turn2, ctx));
    expect(turn2Prompt).not.toContain("### 1. User wants to find connections");
    expect(turn2Prompt).not.toContain("### 2. User explicitly wants to create");
  });
});

describe("Multi-step: disambiguation edge cases", () => {
  test("discover_opportunities with both searchQuery and partyUserIds → introduction wins (partyUserIds is the intro signal)", () => {
    const ctx = makeCtx();
    let messages: BaseMessage[] = [new HumanMessage("connect these two people")];
    messages = withToolCall(messages, "discover_opportunities", {
      searchQuery: "AI collaboration",
      partyUserIds: ["user-a", "user-b"],
    });

    const iterCtx = iterCtxFrom(messages, ctx);
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 6. Introduce two people");
    expect(result).not.toContain("### 1. User wants to find connections or discover");
  });

  test("discover_opportunities with introTargetUserId (discover-for-person) → introduction wins", () => {
    const ctx = makeCtx();
    let messages: BaseMessage[] = [
      new HumanMessage("who should I introduce to @[Alice](user-a)?"),
    ];
    messages = withToolCall(messages, "discover_opportunities", {
      introTargetUserId: "user-a",
    });

    const iterCtx = iterCtxFrom(messages, ctx);
    const result = resolveModules(iterCtx);
    expect(result).toContain("### 6. Introduce two people");
    expect(result).toContain("### 6a. Discover who to introduce to someone");
    expect(result).not.toContain("### 1. User wants to find connections or discover");
  });

  test("two discover_opportunities calls — one discovery, one introduction — introduction excludes discovery", () => {
    const ctx = makeCtx();
    let messages: BaseMessage[] = [new HumanMessage("help me connect")];
    // First call: discovery-style
    messages = withToolCall(messages, "discover_opportunities", { searchQuery: "AI" });
    // Second call: introduction-style
    messages = withToolCall(messages, "discover_opportunities", {
      partyUserIds: ["user-a", "user-b"],
    });

    const iterCtx = iterCtxFrom(messages, ctx);
    const result = resolveModules(iterCtx);
    // Both triggers fire, but introduction's triggerFilter wins and its excludes removes discovery
    expect(result).toContain("### 6. Introduce two people");
    expect(result).not.toContain("### 1. User wants to find connections or discover");
  });

  test("contacts flow: add_contact then list_contacts — single contacts module (no duplication)", () => {
    const ctx = makeCtx();
    let messages: BaseMessage[] = [new HumanMessage("add alice@example.com and show my contacts")];
    messages = withToolCall(messages, "add_contact", { email: "alice@example.com" });
    messages = withToolCall(messages, "list_contacts", {});

    const iterCtx = iterCtxFrom(messages, ctx);
    const result = resolveModules(iterCtx);
    // Contacts module active once (Map deduplicates by module ID)
    expect(result).toContain("### 9. Import contacts from Gmail");
    const count = (result.match(/### 9\. Import contacts from Gmail/g) ?? []).length;
    expect(count).toBe(1);
  });
});

// ─── Dynamic modules tests (LLM-driven behavioral tests) ────────────────────


import { describe, test, expect, beforeAll } from "bun:test";
import { HumanMessage, type BaseMessage } from "@langchain/core/messages";

import { assertLLM } from "../../shared/agent/tests/llm-assert.js";
import { ChatGraphFactory } from "../chat.graph.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import type { Scraper } from "../../shared/interfaces/scraper.interface.js";
import {
  createChatGraphMockDb,
  mockProfile,
  mockActiveIntent,
  createMockProtocolDeps,
} from "./chat.graph.mocks.js";
import type { ChatSessionReader } from "../../shared/interfaces/chat-session.interface.js";
import type { NetworkMembership } from "../../shared/interfaces/database.interface.js";

/**
 * Checks if any AIMessage in the output messages array made a tool call with the given name.
 */
function hasToolCall(messages: unknown[], toolName: string): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((msg) => {
    const m = msg as BaseMessage;
    if (m?._getType?.() === "ai") {
      const toolCalls = (m as { tool_calls?: Array<{ name: string }> }).tool_calls;
      return toolCalls?.some((tc) => tc.name === toolName) ?? false;
    }
    return false;
  });
}

/**
 * Extracts tool call args for a specific tool from the messages array.
 */
function getToolCallArgs(
  messages: unknown[],
  toolName: string,
): Record<string, unknown> | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const msg of messages) {
    const m = msg as BaseMessage;
    if (m?._getType?.() === "ai") {
      const toolCalls = (m as { tool_calls?: Array<{ name: string; args: Record<string, unknown> }> }).tool_calls;
      const match = toolCalls?.find((tc) => tc.name === toolName);
      if (match) return match.args;
    }
  }
  return undefined;
}

const testUserId = "test-dynamic-prompt-user";

const mockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const mockScraper: Scraper = {
  scrape: async (_url: string) => "Scraped content: This article discusses advances in artificial intelligence and machine learning applications in healthcare.",
  extractUrlContent: async (_url: string) => "Scraped content: This article discusses advances in artificial intelligence and machine learning applications in healthcare.",
} as unknown as Scraper;

/** Returns a user record with onboarding completed so tests don't enter onboarding mode. */
function completedUser(userId: string, nameOverride?: string) {
  return {
    id: userId,
    name: nameOverride ?? "Test User",
    email: `${userId}@example.com`,
    onboarding: { completedAt: new Date().toISOString() },
  };
}

/** Shared index that multiple test users belong to. */
const SHARED_INDEX_ID = "idx-shared-ai-builders";
const SHARED_INDEX = { id: SHARED_INDEX_ID, title: "AI Builders" };

/** Build a NetworkMembership for a user in the shared index. */
function sharedMembership(extra?: Partial<NetworkMembership>): NetworkMembership {
  return {
    networkId: SHARED_INDEX_ID,
    networkTitle: "AI Builders",
    indexPrompt: "AI enthusiasts and builders",
    permissions: ["member"],
    memberPrompt: null,
    autoAssign: false,
    isPersonal: false,
    joinedAt: new Date(),
    ...extra,
  };
}

const mockChatSession: ChatSessionReader = { getSessionMessages: async () => [] };
const mockProtocolDeps = createMockProtocolDeps();

describe("Chat Prompt Dynamic Modules", () => {
  let factory: ChatGraphFactory;

  beforeAll(() => {
    const mockDatabase = createChatGraphMockDb({
      getUser: (userId: string) => completedUser(userId),
    });
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper, mockChatSession, mockProtocolDeps);
  });

  describe("Discovery routing (core rule, no module needed)", () => {
    test("'find me a mentor in AI' calls discover_opportunities, not create_intent", async () => {
      const compiledGraph = factory.createGraph();

      const output = await compiledGraph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("find me a mentor in AI")],
      });

      await assertLLM(
        output,
        "Agent must have called discover_opportunities tool (not create_intent). Response should present connections or state no matches found.",
      );

      expect(output.responseText).toBeDefined();
      expect(output.responseText!.length).toBeGreaterThan(0);

      // Deterministic: agent must have called discover_opportunities, not create_intent
      expect(hasToolCall(output.messages ?? [], "discover_opportunities")).toBe(true);
      expect(hasToolCall(output.messages ?? [], "create_intent")).toBe(false);
    }, 180000);
  });

  describe("URL triggers scraping module", () => {
    test("message with URL triggers scrape_url call", async () => {
      const compiledGraph = factory.createGraph();

      const output = await compiledGraph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("check out https://example.com/article and tell me what it's about")],
      });

      await assertLLM(
        output,
        "Agent must have called scrape_url tool with the URL. Response should summarize or reference the scraped content.",
      );

      expect(output.responseText).toBeDefined();
      expect(output.responseText!.length).toBeGreaterThan(0);

      // Deterministic: agent must have called scrape_url
      expect(hasToolCall(output.messages ?? [], "scrape_url")).toBe(true);
    }, 180000);
  });

  describe("@mention handling", () => {
    test("message with @[Name](userId) triggers read_user_profiles", async () => {
      const mockDatabase = createChatGraphMockDb({
        getUser: (userId: string) => {
          if (userId === "user-123") {
            return { id: "user-123", name: "Alice Smith", email: "alice@example.com", onboarding: { completedAt: new Date().toISOString() } };
          }
          return completedUser(userId);
        },
      });
      const mentionFactory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper, mockChatSession, mockProtocolDeps);
      const compiledGraph = mentionFactory.createGraph();

      const output = await compiledGraph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("tell me about @[Alice Smith](user-123)")],
      });

      await assertLLM(
        output,
        "Agent must have attempted to look up information about Alice (called read_user_profiles or similar tool). Response should mention Alice by name — either presenting information or acknowledging the lookup attempt.",
      );

      expect(output.responseText).toBeDefined();
      expect(output.responseText!.length).toBeGreaterThan(0);

      // Deterministic: agent must have called read_user_profiles
      expect(hasToolCall(output.messages ?? [], "read_user_profiles")).toBe(true);
    }, 180000);
  });

  // ─── Multi-turn tests ──────────────────────────────────────────────────────

  describe("Multi-turn: discovery → signal creation", () => {
    test("turn 1: discover connections; turn 2: user asks to create a signal → agent calls create_intent", async () => {
      const compiledGraph = factory.createGraph();

      // ── Turn 1: discovery ──
      const turn1 = await compiledGraph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("find me a mentor in AI")],
      });

      expect(turn1.responseText).toBeDefined();
      expect(hasToolCall(turn1.messages, "discover_opportunities")).toBe(true);

      // ── Turn 2: user asks to create a signal from the discovery ──
      const turn2Messages = [
        ...turn1.messages,
        new HumanMessage(
          "Yes, create a signal so others can find me for AI mentorship",
        ),
      ];

      const turn2 = await compiledGraph.invoke({
        userId: testUserId,
        messages: turn2Messages,
      });

      expect(turn2.responseText).toBeDefined();
      expect(turn2.responseText!.length).toBeGreaterThan(0);

      // Agent should have called create_intent in turn 2
      // Extract only turn 2's messages (after the last HumanMessage we added)
      const turn2NewMessages = turn2.messages.slice(turn1.messages.length + 1);
      expect(hasToolCall(turn2NewMessages, "create_intent")).toBe(true);
    }, 300000);
  });

  describe("Multi-turn: URL scraping → signal creation", () => {
    test("turn 1: user sends URL → agent scrapes; turn 2: user asks to create signal from it → agent calls create_intent", async () => {
      const compiledGraph = factory.createGraph();

      // ── Turn 1: URL scraping ──
      const turn1 = await compiledGraph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage(
            "check out https://example.com/ai-healthcare-article and tell me what it's about",
          ),
        ],
      });

      expect(turn1.responseText).toBeDefined();
      expect(hasToolCall(turn1.messages, "scrape_url")).toBe(true);

      // ── Turn 2: create signal from scraped content ──
      const turn2Messages = [
        ...turn1.messages,
        new HumanMessage("Create a signal from that article"),
      ];

      const turn2 = await compiledGraph.invoke({
        userId: testUserId,
        messages: turn2Messages,
      });

      expect(turn2.responseText).toBeDefined();
      expect(turn2.responseText!.length).toBeGreaterThan(0);

      // Agent should have called create_intent in turn 2
      const turn2NewMessages = turn2.messages.slice(turn1.messages.length + 1);
      expect(hasToolCall(turn2NewMessages, "create_intent")).toBe(true);
    }, 300000);
  });

  // ─── Multi-turn: @mention → person lookup → direct connection ────────────

  describe("Multi-turn: @mention → person lookup → direct connection", () => {
    test("turn 1: look up @mentioned person; turn 2: connect us → agent calls discover_opportunities with targetUserId", async () => {
      const mentionDb = createChatGraphMockDb({
        getUser: (userId: string) => {
          if (userId === "user-alice")
            return completedUser("user-alice", "Alice Smith");
          return completedUser(userId);
        },
        profile: mockProfile({ userId: testUserId, name: "Test User" }),
        networkMemberships: (userId: string) => {
          if (userId === testUserId || userId === "user-alice")
            return [sharedMembership()];
          return [];
        },
        isNetworkMember: (networkId: string, userId: string) =>
          networkId === SHARED_INDEX_ID &&
          (userId === testUserId || userId === "user-alice"),
        getNetwork: (networkId: string) =>
          networkId === SHARED_INDEX_ID ? SHARED_INDEX : null,
      });
      const mentionFactory = new ChatGraphFactory(
        mentionDb,
        mockEmbedder,
        mockScraper,
        mockChatSession,
        mockProtocolDeps,
      );
      const graph = mentionFactory.createGraph();

      // ── Turn 1: look up the mentioned person ──
      const turn1 = await graph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage("tell me about @[Alice Smith](user-alice)"),
        ],
      });

      expect(turn1.responseText).toBeDefined();
      expect(hasToolCall(turn1.messages, "read_user_profiles")).toBe(true);

      // ── Turn 2: connect with that person ──
      const turn2 = await graph.invoke({
        userId: testUserId,
        messages: [
          ...turn1.messages,
          new HumanMessage("I'd like to connect with her"),
        ],
      });

      expect(turn2.responseText).toBeDefined();
      expect(turn2.responseText!.length).toBeGreaterThan(0);

      // Agent should have called discover_opportunities for direct connection.
      // Check full turn2 messages — turn1 didn't call discover_opportunities,
      // so any occurrence is from turn 2.
      expect(hasToolCall(turn2.messages, "discover_opportunities")).toBe(true);
    }, 300000);
  });

  // ─── Multi-turn: intent creation → intent management ─────────────────────

  describe("Multi-turn: intent listing → intent management", () => {
    test("turn 1: list my signals; turn 2: update one → agent calls update_intent", async () => {
      const intentDb = createChatGraphMockDb({
        getUser: (userId: string) => completedUser(userId),
        profile: mockProfile({ userId: testUserId, name: "Test User" }),
        activeIntents: (userId: string) => {
          if (userId === testUserId)
            return [
              mockActiveIntent({
                id: "intent-ai-collab",
                payload: "Looking for AI collaborators in healthcare",
              }),
              mockActiveIntent({
                id: "intent-design",
                payload: "Seeking UX designers for fintech startup",
              }),
            ];
          return [];
        },
      });
      const intentFactory = new ChatGraphFactory(
        intentDb,
        mockEmbedder,
        mockScraper,
        mockChatSession,
        mockProtocolDeps,
      );
      const graph = intentFactory.createGraph();

      // ── Turn 1: list existing signals ──
      const turn1 = await graph.invoke({
        userId: testUserId,
        messages: [new HumanMessage("What signals do I have?")],
      });

      expect(turn1.responseText).toBeDefined();
      expect(hasToolCall(turn1.messages, "read_intents")).toBe(true);

      // ── Turn 2: update one of them ──
      const turn2 = await graph.invoke({
        userId: testUserId,
        messages: [
          ...turn1.messages,
          new HumanMessage(
            "Update the AI collaborators one to focus on AI in drug discovery specifically",
          ),
        ],
      });

      expect(turn2.responseText).toBeDefined();
      expect(turn2.responseText!.length).toBeGreaterThan(0);

      // Agent should call update_intent (turn 1 only had read_intents)
      expect(hasToolCall(turn2.messages, "update_intent")).toBe(true);
    }, 300000);
  });

  // ─── Multi-turn: community exploration → discovery (module reset) ────────

  describe("Multi-turn: community exploration → discovery", () => {
    test("turn 1: ask about communities; turn 2: find connections → modules reset, discovery activates", async () => {
      const communityDb = createChatGraphMockDb({
        getUser: (userId: string) => completedUser(userId),
        profile: mockProfile({ userId: testUserId, name: "Test User" }),
        networkMemberships: (userId: string) => {
          if (userId === testUserId)
            return [
              sharedMembership(),
              {
                networkId: "idx-personal",
                networkTitle: "My Network",
                indexPrompt: null,
                permissions: ["owner"],
                memberPrompt: null,
                autoAssign: false,
                isPersonal: true,
                joinedAt: new Date(),
              },
            ];
          return [];
        },
        getNetwork: (networkId: string) => {
          if (networkId === SHARED_INDEX_ID) return SHARED_INDEX;
          if (networkId === "idx-personal")
            return { id: "idx-personal", title: "My Network" };
          return null;
        },
        isNetworkMember: (networkId: string, userId: string) =>
          userId === testUserId &&
          (networkId === SHARED_INDEX_ID || networkId === "idx-personal"),
      });
      const communityFactory = new ChatGraphFactory(
        communityDb,
        mockEmbedder,
        mockScraper,
        mockChatSession,
        mockProtocolDeps,
      );
      const graph = communityFactory.createGraph();

      // ── Turn 1: explore communities ──
      const turn1 = await graph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage("What communities am I part of?"),
        ],
      });

      expect(turn1.responseText).toBeDefined();
      // Agent should reference community info (may use preloaded data or read_indexes)

      // ── Turn 2: switch to discovery ──
      const turn2 = await graph.invoke({
        userId: testUserId,
        messages: [
          ...turn1.messages,
          new HumanMessage("Find me people interested in AI safety"),
        ],
      });

      expect(turn2.responseText).toBeDefined();
      expect(turn2.responseText!.length).toBeGreaterThan(0);

      // Agent should have called discover_opportunities (discovery), not read_indexes
      const turn2NewMessages = turn2.messages.slice(turn1.messages.length + 1);
      expect(hasToolCall(turn2NewMessages, "discover_opportunities")).toBe(true);
    }, 300000);
  });

  // ─── Introduction: triggerFilter + excludes disambiguation ────────────────

  describe("Introduction between two mentioned people", () => {
    test("'introduce @Alice and @Bob' → agent gathers context and calls discover_opportunities with partyUserIds", async () => {
      const introDb = createChatGraphMockDb({
        getUser: (userId: string) => {
          if (userId === "user-alice")
            return completedUser("user-alice", "Alice Smith");
          if (userId === "user-bob")
            return completedUser("user-bob", "Bob Jones");
          return completedUser(userId);
        },
        profile: mockProfile({ userId: testUserId, name: "Test User" }),
        networkMemberships: (userId: string) => {
          if (
            userId === testUserId ||
            userId === "user-alice" ||
            userId === "user-bob"
          )
            return [sharedMembership()];
          return [];
        },
        isNetworkMember: (networkId: string, userId: string) =>
          networkId === SHARED_INDEX_ID &&
          [testUserId, "user-alice", "user-bob"].includes(userId),
        getNetwork: (networkId: string) =>
          networkId === SHARED_INDEX_ID ? SHARED_INDEX : null,
        activeIntents: (userId: string) => {
          if (userId === "user-alice")
            return [
              mockActiveIntent({ payload: "Looking for ML engineers" }),
            ];
          if (userId === "user-bob")
            return [
              mockActiveIntent({ payload: "Seeking AI research collaborators" }),
            ];
          return [];
        },
      });
      const introFactory = new ChatGraphFactory(
        introDb,
        mockEmbedder,
        mockScraper,
        mockChatSession,
        mockProtocolDeps,
      );
      const graph = introFactory.createGraph();

      const result = await graph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage(
            "I think @[Alice Smith](user-alice) and @[Bob Jones](user-bob) should meet — they're both into AI. Can you introduce them?",
          ),
        ],
      });

      expect(result.responseText).toBeDefined();
      expect(result.responseText!.length).toBeGreaterThan(0);

      // Agent must have called discover_opportunities with partyUserIds (introduction flow)
      expect(hasToolCall(result.messages, "discover_opportunities")).toBe(true);
      const oppArgs = getToolCallArgs(
        result.messages,
        "discover_opportunities",
      );
      // partyUserIds or introTargetUserId should be present — this is an introduction, not a discovery
      const isIntroduction =
        oppArgs?.partyUserIds !== undefined ||
        oppArgs?.introTargetUserId !== undefined;
      expect(isIntroduction).toBe(true);

      // If partyUserIds is set, verify it contains alice and bob
      if (oppArgs?.partyUserIds) {
        const parties = oppArgs.partyUserIds as string[];
        expect(parties).toContain("user-alice");
        expect(parties).toContain("user-bob");
      }
    }, 300000);
  });

  // ─── Contacts: add a contact ──────────────────────────────────────────────

  describe("Contacts management", () => {
    test("'add alice@test.com to my contacts' → agent calls add_contact", async () => {
      const graph = factory.createGraph();

      const result = await graph.invoke({
        userId: testUserId,
        messages: [
          new HumanMessage(
            "Add alice@test.com to my contacts. Her name is Alice.",
          ),
        ],
      });

      expect(result.responseText).toBeDefined();
      expect(result.responseText!.length).toBeGreaterThan(0);
      expect(hasToolCall(result.messages, "add_contact")).toBe(true);
    }, 180000);
  });
});
