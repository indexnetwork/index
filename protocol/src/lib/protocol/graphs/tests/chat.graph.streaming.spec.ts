/**
 * Chat Graph: streaming scenarios.
 * Tests streamChatEvents and streamChatEventsWithContext:
 * - Event sequence (status first, then token or error)
 * - Context loading (streamChatEventsWithContext -- context is now empty after XMTP migration)
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, expect, it, beforeAll } from "bun:test";
import { HumanMessage } from "@langchain/core/messages";
import { ChatGraphFactory } from "../chat.graph";
import type { ChatGraphCompositeDatabase, CreateIntentData } from "../../interfaces/database.interface";
import type { Embedder } from "../../interfaces/embedder.interface";
import type { Scraper } from "../../interfaces/scraper.interface";
import type { ChatStreamEvent } from "../../../../types/chat-streaming.types";

const testUserId = "test-chat-stream-user";
const testSessionId = "test-session-stream";

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

async function collectStreamEvents(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

describe("Chat Graph streaming", () => {
  let factory: ChatGraphFactory;

  beforeAll(() => {
    factory = new ChatGraphFactory(createMockDatabase(), mockEmbedder, mockScraper);
  });

  describe("streamChatEvents", () => {
    it("should yield at least status then token or error events", async () => {
      const events = await collectStreamEvents(
        factory.streamChatEvents(
          {
            userId: testUserId,
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
          { userId: testUserId, messages: [new HumanMessage("Hi")] },
          sessionId
        )
      );

      expect(events.every((e) => e.sessionId === sessionId)).toBe(true);
    }, 120000);
  });

  describe("streamChatEventsWithContext", () => {
    it("should stream events (context is empty in XMTP architecture)", async () => {
      const events = await collectStreamEvents(
        factory.streamChatEventsWithContext(
          {
            userId: testUserId,
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
  });
});
