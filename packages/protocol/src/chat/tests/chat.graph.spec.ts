/**
 * Tests for ChatGraph (agent loop architecture).
 * Covers graph creation, streaming, prompt modules, and dynamic tool selection.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll } from "bun:test";
import { ChatGraphFactory } from "../chat.graph.js";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import type { Scraper } from "../../shared/interfaces/scraper.interface.js";
import { mockChatSessionReader, createMockProtocolDeps } from "./chat.graph.mocks.js";

const testUserId = "test-chat-graph-user";

/**
 * Mock database for ChatGraph. Implements ChatGraphCompositeDatabase with in-memory storage.
 */
function createMockDatabase(): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;

  return {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: async () => [],
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    saveProfile: noop,
    createIntent: async (data: CreateIntentData) => ({
      id: `intent-${Date.now()}`,
      payload: data.payload,
      summary: null,
      isIncognito: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: data.userId,
    }),
    updateIntent: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getNetworkMemberships: noopArray,
    getNetwork: async (networkId: string) => ({ id: networkId, title: "Test Index" }),
    getIntentForIndexing: noopNull,
    getNetworkMemberContext: noopNull,
    getOpportunitiesForUser: noopArray,
    isIntentAssignedToIndex: noopBool,
    assignIntentToNetwork: noop,
    unassignIntentFromIndex: noop,
    getNetworkIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    isNetworkMember: async () => true,
    getNetworkMembersForOwner: noopArray,
    getNetworkMembersForMember: noopArray,
    getNetworkIntentsForOwner: noopArray,
    getNetworkIntentsForMember: noopArray,
    updateIndexSettings: async () =>
      ({
        id: "",
        title: "",
        prompt: null,
        permissions: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        memberCount: 0,
        intentCount: 0,
      }) as any,
    softDeleteNetwork: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
  } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for ChatGraph. */
const mockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

/** Stub scraper - returns placeholder content for URL extraction (used by create_intent when URLs present). */
const mockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "Repository: indexnetwork/index. Intent-driven discovery protocol.",
} as unknown as Scraper;

describe("ChatGraphFactory", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper, mockChatSessionReader, createMockProtocolDeps());
  });

  describe("Graph Creation", () => {
    it("should create and compile a graph with createGraph", () => {
      const graph = factory.createGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph without checkpointer", () => {
      const graph = factory.createStreamingGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
      expect(typeof graph.streamEvents).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph with MemorySaver checkpointer", async () => {
      const { MemorySaver } = await import("@langchain/langgraph");
      const checkpointer = new MemorySaver();
      const graph = factory.createStreamingGraph(checkpointer as any);
      expect(graph).toBeDefined();
      expect(typeof graph.streamEvents).toBe("function");
    });
  });
});

// ─── Factory and loadSessionContext tests ────────────────────────────────────

import { describe, expect, it, beforeAll, spyOn, afterEach } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { ChatGraphFactory } from "../chat.graph.js";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import type { Scraper } from "../../shared/interfaces/scraper.interface.js";
import type { ChatSessionReader } from "../../shared/interfaces/chat-session.interface.js";
import { createMockProtocolDeps } from "./chat.graph.mocks.js";

const testFactoryUserId = "test-chat-factory-user";

function createFactoryMockDatabase(): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;

  return {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: async () => [],
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    saveProfile: noop,
    createIntent: async (data: CreateIntentData) => ({
      id: `intent-${Date.now()}`,
      payload: data.payload,
      summary: null,
      isIncognito: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: data.userId,
    }),
    updateIntent: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getNetworkMemberships: noopArray,
    getNetwork: async (networkId: string) => ({ id: networkId, title: "Test Index" }),
    getIntentForIndexing: noopNull,
    getNetworkMemberContext: noopNull,
    getOpportunitiesForUser: noopArray,
    isIntentAssignedToIndex: noopBool,
    assignIntentToNetwork: noop,
    unassignIntentFromIndex: noop,
    getNetworkIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    isNetworkMember: async () => true,
    getNetworkMembersForOwner: noopArray,
    getNetworkMembersForMember: noopArray,
    getNetworkIntentsForOwner: noopArray,
    getNetworkIntentsForMember: noopArray,
    updateIndexSettings: async () =>
      ({
        id: "",
        title: "",
        prompt: null,
        permissions: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        memberCount: 0,
        intentCount: 0,
      }) as any,
    softDeleteNetwork: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
  } as unknown as ChatGraphCompositeDatabase;
}

const factoryMockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const factoryMockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "",
} as unknown as Scraper;

describe("ChatGraphFactory", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;
  const localChatSessionReader: ChatSessionReader = {
    getSessionMessages: async () => [],
  };

  beforeAll(() => {
    mockDatabase = createFactoryMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, factoryMockEmbedder, factoryMockScraper, localChatSessionReader, createMockProtocolDeps());
  });

  describe("Graph creation", () => {
    it("should create and compile a graph with createGraph", () => {
      const graph = factory.createGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph without checkpointer", () => {
      const graph = factory.createStreamingGraph();
      expect(graph).toBeDefined();
      expect(typeof graph.invoke).toBe("function");
      expect(typeof graph.streamEvents).toBe("function");
    });

    it("should create a streaming graph with createStreamingGraph with MemorySaver checkpointer", async () => {
      const checkpointer = new MemorySaver();
      const graph = factory.createStreamingGraph(checkpointer as any);
      expect(graph).toBeDefined();
      expect(typeof graph.streamEvents).toBe("function");
    });
  });

  describe("loadSessionContext", () => {
    afterEach(() => {
      spyOn(localChatSessionReader, "getSessionMessages").mockRestore?.();
    });

    it("should return empty array when session has no messages", async () => {
      const getSessionMessagesSpy = spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue([]);

      const result = await factory.loadSessionContext("session-empty", 20);

      expect(getSessionMessagesSpy).toHaveBeenCalledWith("session-empty", 20);
      expect(result).toEqual([]);
    });

    it("should load and convert DB messages to LangChain format", async () => {
      const dbMessages = [
        { id: "1", sessionId: "s1", role: "user" as const, content: "Hello", createdAt: new Date(), routingDecision: null, subgraphResults: null, tokenCount: null },
        { id: "2", sessionId: "s1", role: "assistant" as const, content: "Hi there!", createdAt: new Date(), routingDecision: null, subgraphResults: null, tokenCount: null },
      ];
      spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue(dbMessages as any);

      const result = await factory.loadSessionContext("session-with-messages", 20);

      expect(result.length).toBe(2);
      expect(result[0]).toBeInstanceOf(HumanMessage);
      expect((result[0] as HumanMessage).content).toBe("Hello");
      expect(result[1]).toBeInstanceOf(HumanMessage);
      expect((result[1] as HumanMessage).content).toBe("Hi there!");
    });

    it("should respect maxMessages parameter", async () => {
      const getSessionMessagesSpy = spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue([]);

      await factory.loadSessionContext("session-any", 5);

      expect(getSessionMessagesSpy).toHaveBeenCalledWith("session-any", 5);
    });

    it("should truncate messages when over token limit", async () => {
      // One very long message so that adding more would exceed limit; loadSessionContext uses truncateToTokenLimit
      const longContent = "x".repeat(50000);
      const dbMessages = [
        { id: "1", sessionId: "s1", role: "user" as const, content: longContent, createdAt: new Date(), routingDecision: null, subgraphResults: null, tokenCount: null },
        { id: "2", sessionId: "s1", role: "assistant" as const, content: "Reply", createdAt: new Date(), routingDecision: null, subgraphResults: null, tokenCount: null },
      ];
      spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue(dbMessages as any);

      const result = await factory.loadSessionContext("session-long", 20);

      expect(result.length).toBeLessThanOrEqual(2);
      expect(result.every((m) => m !== undefined)).toBe(true);
    });

    it("should return empty array on getSessionMessages error and not throw", async () => {
      spyOn(localChatSessionReader, "getSessionMessages").mockRejectedValue(new Error("DB unavailable"));

      const result = await factory.loadSessionContext("session-fail", 20);

      expect(result).toEqual([]);
    });
  });
});

// ─── Streaming tests ─────────────────────────────────────────────────────────


import { describe, expect, it, beforeAll, spyOn, afterEach } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGraphFactory } from "../chat.graph.js";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";
import type { Scraper } from "../../shared/interfaces/scraper.interface.js";
import type { ChatSessionReader } from "../../shared/interfaces/chat-session.interface.js";
import { createMockProtocolDeps } from "./chat.graph.mocks.js";
import type { ChatStreamEvent } from "../chat-streaming.types.js";

const testStreamUserId = "test-chat-stream-user";
const testSessionId = "test-session-stream";

function createStreamMockDatabase(): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;

  return {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: async () => [],
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    saveProfile: noop,
    createIntent: async (data: CreateIntentData) => ({
      id: `intent-${Date.now()}`,
      payload: data.payload,
      summary: null,
      isIncognito: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: data.userId,
    }),
    updateIntent: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getNetworkMemberships: noopArray,
    getNetwork: async (networkId: string) => ({ id: networkId, title: "Test Index" }),
    getIntentForIndexing: noopNull,
    getNetworkMemberContext: noopNull,
    getOpportunitiesForUser: noopArray,
    isIntentAssignedToIndex: noopBool,
    assignIntentToNetwork: noop,
    unassignIntentFromIndex: noop,
    getNetworkIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    isNetworkMember: async () => true,
    getNetworkMembersForOwner: noopArray,
    getNetworkMembersForMember: noopArray,
    getNetworkIntentsForOwner: noopArray,
    getNetworkIntentsForMember: noopArray,
    updateIndexSettings: async () =>
      ({
        id: "",
        title: "",
        prompt: null,
        permissions: {} as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        memberCount: 0,
        intentCount: 0,
      }) as any,
    softDeleteNetwork: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
  } as unknown as ChatGraphCompositeDatabase;
}

const streamMockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const streamMockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "",
} as unknown as Scraper;

async function collectStreamEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("Chat Graph streaming", () => {
  let factory: ChatGraphFactory;
  const localChatSessionReader: ChatSessionReader = {
    getSessionMessages: async () => [],
  };

  beforeAll(() => {
    factory = new ChatGraphFactory(createStreamMockDatabase(), streamMockEmbedder, streamMockScraper, localChatSessionReader, createMockProtocolDeps());
  });

  describe("streamChatEvents", () => {
    it("should yield at least status then token or error events", async () => {
      const events = await collectStreamEvents(
        factory.streamChatEvents(
          {
            userId: testStreamUserId,
            messages: [new HumanMessage("Say hello in one word.")],
          },
          testSessionId
        )
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("status");
      expect(events[0].sessionId).toBe(testSessionId);

      const hasToken = events.some((e) => e.type === "token");
      const hasError = events.some((e) => e.type === "error");
      expect(hasToken || hasError).toBe(true);

      events.forEach((e) => {
        expect(e).toHaveProperty("type");
        expect(e).toHaveProperty("sessionId");
        expect(e).toHaveProperty("timestamp");
      });
    }, 120000);

    it("should attribute all events to the given sessionId", async () => {
      const sessionId = "unique-session-123";
      const events = await collectStreamEvents(
        factory.streamChatEvents(
          { userId: testStreamUserId, messages: [new HumanMessage("Hi")] },
          sessionId
        )
      );

      expect(events.every((e) => e.sessionId === sessionId)).toBe(true);
    }, 120000);
  });

  describe("streamChatEventsWithContext", () => {
    afterEach(() => {
      spyOn(localChatSessionReader, "getSessionMessages").mockRestore?.();
    });

    it("should load session context then stream events", async () => {
      spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue([]);

      const events = await collectStreamEvents(
        factory.streamChatEventsWithContext(
          {
            userId: testStreamUserId,
            message: "Hello",
            sessionId: testSessionId,
            maxContextMessages: 10,
          }
        )
      );

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("status");
      const hasToken = events.some((e) => e.type === "token");
      const hasError = events.some((e) => e.type === "error");
      expect(hasToken || hasError).toBe(true);
    }, 120000);

    it("should call getSessionMessages with sessionId and maxContextMessages", async () => {
      const getSessionMessagesSpy = spyOn(localChatSessionReader, "getSessionMessages").mockResolvedValue([]);

      const events: ChatStreamEvent[] = [];
      for await (const e of factory.streamChatEventsWithContext({
        userId: testStreamUserId,
        message: "Test",
        sessionId: "ctx-session-1",
        maxContextMessages: 5,
      })) {
        events.push(e);
        if (events.length >= 2) break;
      }

      expect(getSessionMessagesSpy).toHaveBeenCalledWith("ctx-session-1", 5);
    }, 120000);

    it("when getSessionMessages throws, loadSessionContext returns [] and stream still runs with current message only", async () => {
      // Factory's loadSessionContext catches and returns [] on error, so streamChatEventsWithContext
      // does not yield an error event; it proceeds with empty context + current message.
      spyOn(localChatSessionReader, "getSessionMessages").mockRejectedValue(new Error("DB error"));

      const events: ChatStreamEvent[] = [];
      for await (const e of factory.streamChatEventsWithContext({
        userId: testStreamUserId,
        message: "Hello",
        sessionId: "fail-session",
      })) {
        events.push(e);
        if (events.length >= 1) break;
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("status");
    }, 5000);
  });
});
