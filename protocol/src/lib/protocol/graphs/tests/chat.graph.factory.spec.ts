/**
 * Chat Graph: factory, graph creation, and loadSessionContext.
 * Covers createGraph, createStreamingGraph (with/without checkpointer), and loadSessionContext.
 *
 * Note: After the XMTP migration (Task 5), loadSessionContext always returns []
 * because conversation context is now managed by the XMTP agent, not PostgreSQL.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { ChatGraphFactory } from "../chat.graph";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";

const testUserId = "test-chat-factory-user";

function createMockDatabase(): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;

  return {
    getProfile: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: async () => [],
    getUser: noopNull,
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
    getIndexMemberships: noopArray,
    getIndex: noopNull,
    getIntentForIndexing: noopNull,
    getIndexMemberContext: noopNull,
    getOpportunitiesForUser: noopArray,
    isIntentAssignedToIndex: noopBool,
    assignIntentToIndex: noop,
    unassignIntentFromIndex: noop,
    getIndexIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    getIndexMembersForOwner: noopArray,
    getIndexMembersForMember: noopArray,
    getIndexIntentsForOwner: noopArray,
    getIndexIntentsForMember: noopArray,
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
    softDeleteIndex: noop,
    deleteProfile: noop,
    updateOpportunityStatus: noopNull,
  } as unknown as ChatGraphCompositeDatabase;
}

const mockEmbedder: Embedder = {
  generate: async () => [],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

const mockScraper: Scraper = {
  scrape: async () => "",
  extractUrlContent: async () => "",
} as unknown as Scraper;

describe("ChatGraphFactory", () => {
  let factory: ChatGraphFactory;
  let mockDatabase: ChatGraphCompositeDatabase;

  beforeAll(() => {
    mockDatabase = createMockDatabase();
    factory = new ChatGraphFactory(mockDatabase, mockEmbedder, mockScraper);
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
    it("should always return empty array (context managed by XMTP agent)", async () => {
      const result = await factory.loadSessionContext("session-empty", 20);
      expect(result).toEqual([]);
    });

    it("should return empty array regardless of session id or max messages", async () => {
      const result = await factory.loadSessionContext("session-any", 5);
      expect(result).toEqual([]);
    });
  });
});
