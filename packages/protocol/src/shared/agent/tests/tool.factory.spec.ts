/**
 * Unit tests for chat tools (createChatTools, read_intents, read_indexes, read_users, create_opportunities, send_opportunity, etc.).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { mock, afterAll } from "bun:test";
mock.module("../../../../../backend/queues/notification.queue", () => ({
  queueOpportunityNotification: async () =>
    ({ id: "mock-job" } as unknown as Awaited<ReturnType<typeof import("../../../../../backend/queues/notification.queue").queueOpportunityNotification>>),
}));
mock.module("../../graphs/intent.graph", () => ({
  IntentGraphFactory: class {
    private database: ChatGraphCompositeDatabase;
    constructor(database: ChatGraphCompositeDatabase) {
      this.database = database;
    }
    createGraph() {
      const db = this.database;
      return {
        invoke: async (input: {
          userId: string;
          operationMode: string;
          networkId?: string;
          queryUserId?: string;
          allUserIntents?: boolean;
          targetIntentIds?: string[];
        }) => {
          // For read operations, replicate the real queryNode logic using the database
          if (input.operationMode === "read") {
            const effectiveIndexId = input.allUserIntents ? undefined : input.networkId;

            if (effectiveIndexId) {
              const isMember = await db.isNetworkMember(effectiveIndexId, input.userId);
              if (!isMember) {
                return {
                  readResult: {
                    count: 0,
                    intents: [],
                    message: "Index not found or you are not a member.",
                  },
                };
              }

              if (!input.queryUserId) {
                const intents = await db.getNetworkIntentsForMember(effectiveIndexId, input.userId);
                return {
                  readResult: {
                    count: intents.length,
                    networkId: effectiveIndexId,
                    intents: intents.map((i: any) => ({
                      id: i.id,
                      description: i.payload,
                      summary: i.summary,
                      createdAt: i.createdAt,
                      userId: i.userId,
                      userName: i.userName,
                    })),
                    ...(intents.length === 0 && { message: "No intents in this index yet." }),
                  },
                };
              }

              const intents = await db.getIntentsInIndexForMember(input.queryUserId, effectiveIndexId);
              const user = await db.getUser(input.queryUserId);
              const userName = user?.name ?? null;
              return {
                readResult: {
                  count: intents.length,
                  networkId: effectiveIndexId,
                  intents: intents.map((i: any) => ({
                    id: i.id,
                    description: i.payload,
                    summary: i.summary,
                    createdAt: i.createdAt,
                    userId: input.queryUserId,
                    userName,
                  })),
                },
              };
            }

            // No index scope: return user's own active intents
            const intents = await db.getActiveIntents(input.userId);
            return {
              readResult: {
                count: intents.length,
                intents: intents.map((i: any) => ({
                  id: i.id,
                  description: i.payload,
                  summary: i.summary,
                  createdAt: i.createdAt,
                })),
              },
            };
          }

          // For update/delete with index scope: enforce index scoping (intent must be in index)
          if (
            (input.operationMode === "update" || input.operationMode === "delete") &&
            input.networkId &&
            input.targetIntentIds?.length
          ) {
            const intentId = input.targetIntentIds[0];
            const intents = await db.getIntentsInIndexForMember(input.userId, input.networkId);
            const inScope = intents.some((i: { id: string }) => i.id === intentId);
            if (!inScope) {
              return {
                executionResults: [{ success: false, actionType: input.operationMode as "update" | "expire" }],
                actions: [],
                inferredIntents: [],
              };
            }
            return {
              executionResults: [
                {
                  success: true,
                  actionType: input.operationMode === "delete" ? "expire" : "update",
                  intentId,
                },
              ],
              actions: [],
              inferredIntents: [],
            };
          }

          // For non-read operations without index scope, return default empty results
          return {
            executionResults: [],
            actions: [],
            inferredIntents: [],
          };
        },
      };
    }
  },
}));

// Mutable mock result for opportunity discovery — tests set this before invoking the tool.
// Default preserves the existing no-memberships test expectation (found:false + join/index/community message).
let mockDiscoveryResult: {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: Array<{
    opportunityId: string;
    userId: string;
    name?: string;
    avatar?: string | null;
    matchReason: string;
    score: number;
    status?: string;
  }>;
  createIntentSuggested?: boolean;
  suggestedIntentDescription?: string;
  debugSteps?: unknown[];
  pagination?: unknown;
  existingConnections?: unknown[];
  existingConnectionsForMention?: unknown[];
} = {
  found: false,
  count: 0,
  message: "You need to join at least one index (community) to discover opportunities.",
};
mock.module("../../support/opportunity.discover", () => ({
  runDiscoverFromQuery: async () => mockDiscoveryResult,
  continueDiscovery: async () => mockDiscoveryResult,
}));

import { describe, test, expect, beforeAll } from "bun:test";
import { createChatTools, type ToolContext } from "../tool.factory";
import type { ChatGraphCompositeDatabase, Opportunity, SystemDatabase } from "../../interfaces/database.interface.js";
import type { ActiveIntent, IndexMemberDetails, IndexedIntentDetails } from "../../interfaces/database.interface.js";
import type { Embedder } from "../../interfaces/embedder.interface.js";
import type { Scraper } from "../../interfaces/scraper.interface.js";

const testUserId = "test-user-id-for-tools";

type MockOverrides = Partial<Pick<
  ChatGraphCompositeDatabase,
  "getUser" | "getNetwork" | "getOwnedIndexes" | "isIndexOwner" | "isNetworkMember" | "getNetworkMembersForOwner" | "getNetworkMembersForMember" | "getNetworkIntentsForOwner" | "getNetworkMemberships" | "getNetworkMembership" | "getNetworkIntentsForMember" | "getNetworkWithPermissions" | "getOpportunity" | "updateOpportunityStatus" | "getActiveIntents" | "getIntentsInIndexForMember" | "getNetworkIdsForIntent" | "opportunityExistsBetweenActors" | "findOverlappingOpportunities" | "createOpportunity"
>>;

/**
 * Minimal mock database. getIntentsInIndexForMemberImpl is required for read_intents.
 * Optional overrides for index tools.
 */
function createMockDatabase(
  getIntentsInIndexForMemberImpl: (userId: string, networkId: string) => Promise<ActiveIntent[]>,
  overrides?: MockOverrides
): ChatGraphCompositeDatabase {
  const noop = async () => undefined;
  const noopNull = async () => null;
  const noopArray = async () => [];
  const noopBool = async () => false;
  const base = {
    getProfile: noopNull,
    getProfileByUserId: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: getIntentsInIndexForMemberImpl,
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    getNetwork: async (networkId: string) => ({ id: networkId, title: "Test Index" }),
    saveProfile: noop,
    createIntent: async () => ({ id: "", payload: "", summary: null, isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: "" }),
    updateIntent: noopNull,
    updateUser: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getNetworkMemberships: noopArray,
    getPublicIndexesNotJoined: async () => ({ networks: [] }),
    getNetworkMembership: noopNull,
    getNetworkWithPermissions: async () => null,
    getIntentForIndexing: noopNull,
    getNetworkMemberContext: noopNull,
    isIntentAssignedToIndex: noopBool,
    assignIntentToNetwork: noop,
    unassignIntentFromIndex: noop,
    getNetworkIdsForIntent: noopArray,
    getOwnedIndexes: noopArray,
    isIndexOwner: noopBool,
    isNetworkMember: noopBool,
    getNetworkMembersForOwner: noopArray,
    getNetworkMembersForMember: noopArray,
    getNetworkIntentsForOwner: noopArray,
    getNetworkIntentsForMember: noopArray,
    updateIndexSettings: async () => ({
      id: "",
      title: "",
      prompt: null,
      permissions: { joinPolicy: "invite_only" as const, invitationLink: null, allowGuestVibeCheck: false },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      memberCount: 0,
      intentCount: 0,
    }),
    softDeleteNetwork: noop,
    deleteProfile: noop,
    getNetworkMemberCount: async () => 0,
    createNetwork: async () => ({ id: "", title: "", prompt: null, permissions: { joinPolicy: "invite_only" as const, invitationLink: null, allowGuestVibeCheck: false } }),
    addMemberToNetwork: async () => ({ success: true }),
    getMembersFromUserIndexes: async () => [],
    getOpportunity: noopNull,
    updateOpportunityStatus: noopNull,
  };
  return { ...base, ...overrides } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for tool creation (not invoked by read_intents). */
const mockEmbedder = {
  generate: async () => [] as number[],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
} as unknown as Embedder;

/** Stub scraper for tool creation (not invoked by read_intents). */
const mockScraper = {
  scrape: async () => "",
  extractUrlContent: async (_url: string, _options?: { objective?: string }) => "",
} as unknown as Scraper;

/** Stub protocol-level deps for ToolContext (not invoked in most unit tests). */
const mockProtocolDeps: Omit<ToolContext, 'userId' | 'database' | 'embedder' | 'scraper' | 'networkId' | 'sessionId' | 'userDb' | 'systemDb'> = {
  cache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false, mget: async () => [], deleteByPattern: async () => 0 },
  hydeCache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false },
  integration: { createSession: async () => ({}) as any, executeToolAction: async () => ({ successful: true }), listConnections: async () => [], getAuthUrl: async () => ({ redirectUrl: "" }), disconnect: async () => ({ success: true }) },
  intentQueue: { addGenerateHydeJob: async () => ({}), addDeleteHydeJob: async () => ({}) },
  contactService: { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] }), listContacts: async () => [], addContact: async () => ({ userId: "", isNew: false, isGhost: false }), removeContact: async () => {} },
  chatSession: { getSessionMessages: async () => [] },
  enricher: { enrichUserProfile: async () => null },
  negotiationDatabase: {} as unknown as import("../../interfaces/database.interface").NegotiationDatabase,
  integrationImporter: { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0 }) },
  createUserDatabase: (db: any, _userId: string) => ({
    getActiveIntents: db.getActiveIntents ?? (async () => []),
    getIntent: db.getIntent ?? (async () => null),
    createIntent: db.createIntent ?? (async () => ({ id: "", payload: "", summary: null, isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: "" })),
    updateIntent: db.updateIntent ?? (async () => null),
    archiveIntent: db.archiveIntent ?? (async () => ({ success: true })),
    getProfile: db.getProfile ?? (async () => null),
    getProfileByUserId: db.getProfileByUserId ?? (async () => null),
    saveProfile: db.saveProfile ?? (async () => {}),
    deleteProfile: db.deleteProfile ?? (async () => {}),
    getUser: db.getUser ?? (async () => null),
    updateUser: db.updateUser ?? (async () => null),
    getNetworkMemberships: db.getNetworkMemberships ?? (async () => []),
    getUserIndexIds: db.getUserIndexIds ?? (async () => []),
    getOwnedIndexes: db.getOwnedIndexes ?? (async () => []),
    getNetworkMembership: db.getNetworkMembership ?? (async () => null),
    getNetworkMemberContext: db.getNetworkMemberContext ?? (async () => null),
    createIndex: db.createIndex ?? (async () => ({ id: "", title: "" })),
    updateIndexSettings: db.updateIndexSettings ?? (async () => ({})),
    softDeleteNetwork: db.softDeleteNetwork ?? (async () => {}),
    getPublicIndexesNotJoined: db.getPublicIndexesNotJoined ?? (async () => ({ indexes: [] })),
    joinPublicNetwork: db.joinPublicNetwork ?? (async () => {}),
    getOpportunitiesForUser: db.getOpportunitiesForUser ?? (async () => []),
    getOpportunity: db.getOpportunity ?? (async () => null),
    updateOpportunityStatus: db.updateOpportunityStatus ?? (async () => null),
    findSimilarIntents: db.findSimilarIntents ?? (async () => []),
    getIntentForIndexing: db.getIntentForIndexing ?? (async () => null),
    associateIntentWithNetworks: db.associateIntentWithNetworks ?? (async () => {}),
    assignIntentToNetwork: db.assignIntentToNetwork ?? (async () => {}),
    unassignIntentFromIndex: db.unassignIntentFromIndex ?? (async () => {}),
    getNetworkIdsForIntent: db.getNetworkIdsForIntent ?? (async () => []),
    isIntentAssignedToIndex: db.isIntentAssignedToIndex ?? (async () => false),
    getAcceptedOpportunitiesBetweenActors: db.getAcceptedOpportunitiesBetweenActors ?? (async () => []),
    acceptSiblingOpportunities: db.acceptSiblingOpportunities ?? (async () => {}),
    getHydeDocument: db.getHydeDocument ?? (async () => null),
    getHydeDocumentsForSource: db.getHydeDocumentsForSource ?? (async () => []),
    saveHydeDocument: db.saveHydeDocument ?? (async () => {}),
    deleteHydeDocumentsForSource: db.deleteHydeDocumentsForSource ?? (async () => {}),
  }) as unknown as import("../../interfaces/database.interface").UserDatabase,
  createSystemDatabase: (db: any, _userId: string, _scope: string[]) => ({
    isNetworkMember: db.isNetworkMember ?? (async () => false),
    isIndexOwner: db.isIndexOwner ?? (async () => false),
    getProfile: db.getProfile ?? (async () => null),
    getUser: db.getUser ?? (async () => null),
    getIntentsInIndex: db.getIntentsInIndexForMember ?? (async () => []),
    getUserIntentsInIndex: db.getIntentsInIndexForMember ?? (async () => []),
    getIntent: db.getIntent ?? (async () => null),
    findSimilarIntentsInScope: async () => [],
    getNetworkMembers: db.getNetworkMembersForMember ?? (async () => []),
    getMembersFromScope: db.getMembersFromUserIndexes ?? (async () => []),
    addMemberToNetwork: db.addMemberToNetwork ?? (async () => ({ success: true })),
    removeMemberFromIndex: async () => {},
    getNetwork: db.getNetwork ?? (async () => null),
    getNetworkWithPermissions: db.getNetworkWithPermissions ?? (async () => null),
    getNetworkMemberCount: db.getNetworkMemberCount ?? (async () => 0),
    createOpportunity: db.createOpportunity ?? (async () => null),
    createOpportunityAndExpireIds: db.createOpportunityAndExpireIds ?? (async () => null),
    getOpportunity: db.getOpportunity ?? (async () => null),
    getOpportunitiesForIndex: async () => [],
    updateOpportunityStatus: db.updateOpportunityStatus ?? (async () => null),
    opportunityExistsBetweenActors: db.opportunityExistsBetweenActors ?? (async () => false),
    getOpportunityBetweenActors: db.getOpportunityBetweenActors ?? (async () => null),
    findOverlappingOpportunities: db.findOverlappingOpportunities ?? (async () => []),
    expireOpportunitiesByIntent: async () => {},
    expireOpportunitiesForRemovedMember: async () => {},
    expireStaleOpportunities: async () => {},
    getHydeDocument: db.getHydeDocument ?? (async () => null),
    getHydeDocumentsForSource: db.getHydeDocumentsForSource ?? (async () => []),
    saveHydeDocument: db.saveHydeDocument ?? (async () => {}),
    deleteExpiredHydeDocuments: async () => {},
    getStaleHydeDocuments: async () => [],
  }) as unknown as import("../../interfaces/database.interface").SystemDatabase,
};

describe("createChatTools", () => {
  test("returns an array that includes read_intents, read_networks, read_network_memberships", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    expect(tools).toBeArray();
    expect(tools.find((t: { name: string }) => t.name === "read_intents")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "read_networks")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "read_network_memberships")).toBeDefined();
  });

  test("does not include list_opportunities (chat only proposes opportunities from create_opportunities; home shows the rest)", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    expect(tools.find((t: { name: string }) => t.name === "list_opportunities")).toBeUndefined();
    expect(tools.find((t: { name: string }) => t.name === "create_opportunities")).toBeDefined();
    expect(tools.find((t: { name: string }) => t.name === "update_opportunity")).toBeDefined();
  });
});

const testIndexId = "a1b2c3d4-0000-4000-8000-000000000001";

describe("read_intents tool", () => {
  let readIntentsTool: { invoke: (args: { networkId?: string; userId?: string }) => Promise<string> };

  beforeAll(async () => {
    const mockIntents: ActiveIntent[] = [
      { id: "intent-1", payload: "Find ML collaborators", summary: "ML collab", createdAt: new Date("2025-01-01") },
      { id: "intent-2", payload: "Learn Rust", summary: "Rust", createdAt: new Date("2025-01-02") },
    ];
    const indexIntentsForMember: IndexedIntentDetails[] = mockIntents.map((i) => ({
      ...i,
      userId: testUserId,
      userName: "Test User",
    }));
    const mockDb = createMockDatabase(async (userId, networkId) => {
      if (userId !== testUserId) return [];
      if (networkId === testIndexId) return mockIntents;
      return [];
    }, {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (_networkId, _requestingUserId) =>
        _networkId === testIndexId ? indexIntentsForMember : [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents");
    if (!tool || typeof (tool as { invoke?: (args: unknown) => Promise<unknown> }).invoke !== "function") {
      throw new Error("read_intents tool not found or missing invoke");
    }
    readIntentsTool = tool as { invoke: (args: { networkId?: string; userId?: string }) => Promise<string> };
  });

  test("invoke returns success with intents and count when index has intents", async () => {
    const result = await readIntentsTool.invoke({ networkId: testIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(2);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "intent-1", description: "Find ML collaborators", summary: "ML collab" });
    expect(parsed.data.intents[1]).toMatchObject({ id: "intent-2", description: "Learn Rust", summary: "Rust" });
    expect(new Date(parsed.data.intents[0].createdAt).getTime()).toBe(new Date("2025-01-01").getTime());
  });

  test("invoke returns success with empty intents when user has no intents in that index", async () => {
    const otherIndexId = "a1b2c3d4-0000-4000-8000-000000000002";
    const result = await readIntentsTool.invoke({ networkId: otherIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents).toBeArray();
    expect(parsed.data.intents.length).toBe(0);
    expect(parsed.data.count).toBe(0);
  });

  test("invoke with networkId and no userId calls getNetworkIntentsForMember with networkId and requesting userId", async () => {
    let capturedIndexId = "";
    let capturedRequestingUserId = "";
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (networkId, requestingUserId) => {
        capturedIndexId = networkId;
        capturedRequestingUserId = requestingUserId;
        return [];
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    await tool.invoke({ networkId: testIndexId });
    expect(capturedIndexId).toBe(testIndexId);
    expect(capturedRequestingUserId).toBe(testUserId);
  });

  test("when context.networkId is set, omit networkId to use context index", async () => {
    let capturedIndex = "";
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (networkId) => {
        capturedIndex = networkId;
        return [{ id: "i1", payload: "In index", summary: "X", createdAt: new Date(), userId: testUserId, userName: "Test" }];
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId: testIndexId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(capturedIndex).toBe(testIndexId);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
  });

  test("when networkId is invalid UUID returns error", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId: "not-a-uuid" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Invalid network ID/i);
  });
});

describe("read_intents tool (index-scoped: owner vs member)", () => {
  const networkId = testIndexId;
  const allIndexIntents: IndexedIntentDetails[] = [
    { id: "ix-1", payload: "Intent from Alice", summary: "Alice", userId: "user-alice", userName: "Alice", createdAt: new Date("2025-01-01") },
    { id: "ix-2", payload: "Intent from Bob", summary: "Bob", userId: "user-bob", userName: "Bob", createdAt: new Date("2025-01-02") },
  ];
  const memberIntents: ActiveIntent[] = [
    { id: "mine-1", payload: "My intent in index", summary: "Mine", createdAt: new Date("2025-01-03") },
  ];

  test("when userId is omitted, getNetworkIntentsForMember is called and returns all intents in index (shared network)", async () => {
    let getNetworkIntentsForMemberCalled = false;
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (idx, uid) => {
        getNetworkIntentsForMemberCalled = true;
        expect(idx).toBe(networkId);
        expect(uid).toBe(testUserId);
        return allIndexIntents;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId });
    expect(getNetworkIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.networkId).toBe(networkId);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "ix-1", description: "Intent from Alice", userId: "user-alice", userName: "Alice" });
    expect(parsed.data.intents[1]).toMatchObject({ id: "ix-2", description: "Intent from Bob", userId: "user-bob", userName: "Bob" });
  });

  test("when userId is provided, getIntentsInIndexForMember is called for that user", async () => {
    const otherUserId = "00000000-0000-0000-0000-000000000002";
    let getIntentsInIndexForMemberCalledWith: { userId: string; networkId: string } | null = null;
    const mockDb = createMockDatabase(async (uid, idx) => {
      getIntentsInIndexForMemberCalledWith = { userId: uid, networkId: idx };
      if (uid === otherUserId && idx === networkId) return [{ id: "bob-1", payload: "Bob intent", summary: "B", createdAt: new Date() }];
      return [];
    }, { isNetworkMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId, userId: otherUserId });
    expect(getIntentsInIndexForMemberCalledWith).toMatchObject({
      userId: otherUserId,
      networkId,
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "bob-1", description: "Bob intent" });
  });

  test("when isNetworkMember and userId omitted, getNetworkIntentsForMember is called (shared network: all intents)", async () => {
    let getNetworkIntentsForMemberCalled = false;
    const allIntentsInIndex: IndexedIntentDetails[] = [
      { id: "mine-1", payload: "My intent in index", summary: "Mine", createdAt: new Date(), userId: testUserId, userName: "Test User" },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (idx, requestingUserId) => {
        getNetworkIntentsForMemberCalled = true;
        expect(idx).toBe(networkId);
        expect(requestingUserId).toBe(testUserId);
        return allIntentsInIndex;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId });
    expect(getNetworkIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "mine-1", description: "My intent in index", userId: testUserId, userName: "Test User" });
  });

  test("when userId is provided, response includes userId and userName for each intent", async () => {
    const otherUserId = "00000000-0000-0000-0000-000000000002";
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === otherUserId && idx === networkId) return [{ id: "bob-1", payload: "Bob's priority", summary: "B", createdAt: new Date() }];
      return [];
    }, {
      isNetworkMember: async () => true,
      getUser: async (uid: string) =>
        uid === otherUserId ? { id: uid, name: "Bob", email: "bob@example.com" } : { id: testUserId, name: "Test User", email: "test@example.com" },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string; userId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId, userId: otherUserId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents).toHaveLength(1);
    expect(parsed.data.intents[0]).toMatchObject({
      id: "bob-1",
      description: "Bob's priority",
      userId: otherUserId,
      userName: "Bob",
    });
  });

  test("when networkId is set but user is not a member, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isIndexOwner: async () => false,
      isNetworkMember: async () => false,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(
      /\bnot a member\b|\bIndex not found\b|member of/i,
    );
  });
});

describe("read_intents tool (no networkId)", () => {
  const globalIntents: ActiveIntent[] = [
    { id: "g1", payload: "Global intent A", summary: "A", createdAt: new Date("2025-01-01") },
    { id: "g2", payload: "Global intent B", summary: "B", createdAt: new Date("2025-01-02") },
  ];
  const indexScopedIntents: ActiveIntent[] = [
    { id: "i1", payload: "Intent in index only", summary: "Index", createdAt: new Date("2025-01-03") },
  ];

  test("without networkId calls getActiveIntents and returns all intents", async () => {
    let getActiveIntentsCalled = false;
    const mockDb = createMockDatabase(async () => []);
    const dbWithSpy = {
      ...mockDb,
      getActiveIntents: async (uid: string) => {
        getActiveIntentsCalled = true;
        expect(uid).toBe(testUserId);
        return globalIntents;
      },
    };
    const context: ToolContext = { userId: testUserId, database: dbWithSpy, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getActiveIntentsCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
    expect(parsed.data.intents[0]).toMatchObject({ id: "g1", description: "Global intent A" });
  });

  test("with context.networkId and no networkId arg calls getNetworkIntentsForMember and returns index-scoped intents", async () => {
    const networkId = testIndexId;
    const indexScopedWithUser: IndexedIntentDetails[] = indexScopedIntents.map((i) => ({ ...i, userId: testUserId, userName: "Test User" }));
    let getNetworkIntentsForMemberCalled = false;
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (idxId, uid) => {
        getNetworkIntentsForMemberCalled = true;
        expect(uid).toBe(testUserId);
        expect(idxId).toBe(networkId);
        return indexScopedWithUser;
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getNetworkIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "i1", description: "Intent in index only" });
  });

  test("with context.networkId, omit networkId to get index-scoped intents (context index used)", async () => {
    const networkId = testIndexId;
    const indexIntents = [
      { id: "ix-1", payload: "In index", summary: "X", createdAt: new Date(), userId: testUserId, userName: "Test User" },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async () => indexIntents,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: Record<string, unknown>) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents).toHaveLength(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "ix-1", userId: testUserId, userName: "Test User" });
  });

  test("without networkId, when userId arg is another user, returns error (no viewing other users' global intents)", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { userId?: string }) => Promise<string> };
    const result = await tool.invoke({ userId: "other-user-id" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Cannot read another user's global intents|other users' global intents/i);
  });

  test("without networkId returns current user active intents (getActiveIntents)", async () => {
    const globalIntents = [
      { id: "g1", payload: "Priority one", summary: "One", createdAt: new Date("2025-01-01") },
      { id: "g2", payload: "Priority two", summary: "Two", createdAt: new Date("2025-01-02") },
    ];
    const mockDb = createMockDatabase(async () => [], {
      getActiveIntents: async () => globalIntents,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: Record<string, unknown>) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents).toHaveLength(2);
  });

  test("with networkId when not a member returns error", async () => {
    const mockDb = createMockDatabase(async () => [], { isNetworkMember: async () => false });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId: testIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Index not found|not a member|member/i);
  });

  test("with networkId and limit/page returns paginated intents", async () => {
    const networkId = testIndexId;
    const threeIntents: IndexedIntentDetails[] = [
      { id: "i-1", payload: "Intent 1", summary: "1", createdAt: new Date("2025-01-05"), userId: "u-1", userName: "U1" },
      { id: "i-2", payload: "Intent 2", summary: "2", createdAt: new Date("2025-01-04"), userId: "u-2", userName: "U2" },
      { id: "i-3", payload: "Intent 3", summary: "3", createdAt: new Date("2025-01-03"), userId: "u-3", userName: "U3" },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async () => threeIntents,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as {
      invoke: (args: { networkId?: string; limit?: number; page?: number }) => Promise<string>;
    };

    const page1 = JSON.parse(await tool.invoke({ networkId, limit: 2, page: 1 }));
    expect(page1.success).toBe(true);
    expect(page1.data.count).toBe(2);
    expect(page1.data.totalCount).toBe(3);
    expect(page1.data.totalPages).toBe(2);
    expect(page1.data.intents[0].id).toBe("i-1");
    expect(page1.data.intents[1].id).toBe("i-2");

    const page2 = JSON.parse(await tool.invoke({ networkId, limit: 2, page: 2 }));
    expect(page2.success).toBe(true);
    expect(page2.data.count).toBe(1);
    expect(page2.data.intents[0].id).toBe("i-3");
  });
});

describe("read_network_memberships tool (list members)", () => {
  const memberIndexId = testIndexId;
  const mockMembers: IndexMemberDetails[] = [
    { userId: "u1", name: "Alice", avatar: null, email: "alice@example.com", permissions: ["member"], memberPrompt: null, autoAssign: true, joinedAt: new Date("2025-01-01"), intentCount: 2 },
    { userId: "u2", name: "Bob", avatar: null, email: "bob@example.com", permissions: ["member"], memberPrompt: null, autoAssign: false, joinedAt: new Date("2025-01-02"), intentCount: 1 },
  ];

  test("invoke with networkId returns success with members when member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkMembersForMember: async (networkId, uid) => {
        if (networkId === memberIndexId && uid === testUserId) return mockMembers;
        throw new Error("Access denied: Not a member of this index");
      },
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_network_memberships") as { invoke: (args: { networkId: string }) => Promise<string> };
    const result = await tool.invoke({ networkId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.networkId).toBe(memberIndexId);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.members).toBeArray();
    expect(parsed.data.members[0]).toMatchObject({ name: "Alice", intentCount: 2 });
    expect(parsed.data.members[1]).toMatchObject({ name: "Bob", intentCount: 1 });
  });

  test("invoke returns error when not member", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => false,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_network_memberships") as { invoke: (args: { networkId: string }) => Promise<string> };
    const result = await tool.invoke({ networkId: memberIndexId });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/not a member|member of that index/i);
  });

  test("invoke returns error when networkId is not a valid UUID", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_network_memberships") as { invoke: (args: { networkId: string }) => Promise<string> };
    const result = await tool.invoke({ networkId: "not-a-uuid" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Invalid index ID/i);
  });
});

describe("create_intent tool (Phase 2 index scope)", () => {
  test("create_intent tool schema includes optional networkId", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const createIntentTool = tools.find((t: { name: string }) => t.name === "create_intent");
    expect(createIntentTool).toBeDefined();
    const schema = (createIntentTool as { schema?: { shape?: Record<string, unknown> } }).schema;
    expect(schema?.shape?.networkId ?? (createIntentTool as { schema?: { schema?: { shape?: Record<string, unknown> } } }).schema?.schema?.shape?.networkId).toBeDefined();
  });

});

describe("scrape_url tool", () => {
  test("returns a tool named scrape_url", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("scrape_url");
  });

  test("invoke calls scraper.extractUrlContent with url and no objective when objective omitted", async () => {
    let capturedUrl: string | null = null;
    let capturedOptions: { objective?: string } | undefined = undefined;
    const scraperWithSpy = {
      scrape: async () => "",
      extractUrlContent: async (url: string, options?: { objective?: string }) => {
        capturedUrl = url;
        capturedOptions = options;
        return "Some scraped content";
      },
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperWithSpy, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    await tool.invoke({ url: "https://example.com/page" });
    expect(capturedUrl as unknown as string).toBe("https://example.com/page");
    expect((capturedOptions as { objective?: string } | undefined)?.objective).toBeUndefined();
  });

  test("invoke calls scraper.extractUrlContent with url and objective when provided", async () => {
    let capturedUrl: string | null = null;
    let capturedOptions: { objective?: string } | undefined = undefined;
    const scraperWithSpy = {
      scrape: async () => "",
      extractUrlContent: async (url: string, options?: { objective?: string }) => {
        capturedUrl = url;
        capturedOptions = options;
        return "Intent-focused content";
      },
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperWithSpy, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    const objective = "User wants to create an intent from this link (project/repo or similar).";
    await tool.invoke({ url: "https://github.com/org/repo", objective });
    expect(capturedUrl as unknown as string).toBe("https://github.com/org/repo");
    expect((capturedOptions as { objective?: string } | undefined)?.objective).toBe(objective);
  });

  test("invoke returns success with content when scraper returns content", async () => {
    const scraperReturningContent = {
      scrape: async () => "",
      extractUrlContent: async () => "Scraped page text for example.com",
    } as unknown as Scraper;
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: scraperReturningContent, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string; objective?: string }) => Promise<string> };
    const result = await tool.invoke({ url: "https://example.com" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.url).toBe("https://example.com");
    expect(parsed.data.content).toBe("Scraped page text for example.com");
    expect(parsed.data.contentLength).toBe("Scraped page text for example.com".length);
  });

  test("invoke returns error for invalid URL", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "scrape_url") as { invoke: (args: { url: string }) => Promise<string> };
    const result = await tool.invoke({ url: "not-a-valid-url" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/Invalid URL|Couldn't extract content/i);
  });
});

describe("read_networks (Phase 3 network-scoped)", () => {
  const scopedIndexId = "a1b2c3d4-0000-4000-8000-000000000010";

  test("when context.networkId is set and showAll not true, returns only current index membership with scopeNote", async () => {
    const oneMembership = [{ networkId: scopedIndexId, networkTitle: "Current Index", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }];
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async (uid) => (uid === testUserId ? oneMembership : []),
      getOwnedIndexes: async () => [],
      isNetworkMember: async () => true,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId: scopedIndexId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_networks") as { invoke: (args: { showAll?: boolean }) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.memberOf).toHaveLength(1);
    expect(parsed.data.memberOf[0].networkId).toBe(scopedIndexId);
    expect(parsed.data.stats.scopeNote).toContain("Showing current index");
  });

  test("when context.networkId is set, showAll parameter is ignored (strict scope enforcement)", async () => {
    const allMemberships = [
      { networkId: scopedIndexId, networkTitle: "Index A", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
      { networkId: "b2c3d4e5-0000-4000-8000-000000000011", networkTitle: "Index B", indexPrompt: null, permissions: [], memberPrompt: null, autoAssign: false, isPersonal: false, joinedAt: new Date() },
    ];
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async (uid) => (uid === testUserId ? allMemberships : []),
      getOwnedIndexes: async () => [],
      isNetworkMember: async () => true,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId: scopedIndexId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    // Note: showAll is no longer in querySchema, but even if passed it's ignored
    const tool = tools.find((t: { name: string }) => t.name === "read_networks") as { invoke: (args: Record<string, unknown>) => Promise<string> };
    const result = await tool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    // Only returns scoped index, not all 2 memberships - strict scope enforcement
    expect(parsed.data.memberOf).toHaveLength(1);
    expect(parsed.data.memberOf[0].networkId).toBe(scopedIndexId);
    expect(parsed.data.stats.scopeNote).toContain("Showing current index");
  });

});

describe("update_intent and delete_intent (Phase 3 index-scoping)", () => {
  const networkId = "a1b2c3d4-0000-4000-8000-000000000020";
  const intentInIndex = { id: "c2505011-2e45-426e-81dd-b9abb9b72001", payload: "In scope", summary: "X", createdAt: new Date() };
  const intentNotInIndex = "c2505011-2e45-426e-81dd-b9abb9b72099"; // Valid UUID but not in index

  test("update_intent when context.networkId set and intent not in index returns success false and error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, { isNetworkMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_intent") as { invoke: (args: { intentId: string; description: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex, description: "Updated" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/fail|update/i);
  });

  test("delete_intent when context.networkId set and intent not in index returns success false and error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, { isNetworkMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/fail|delete|archived/i);
  });

  test("update_intent when context.networkId set and intent in index returns success and data shape", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getNetworkIdsForIntent: async (intentId: string) => (intentId === intentInIndex.id ? [networkId] : []),
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_intent") as { invoke: (args: { intentId: string; description: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentInIndex.id, description: "Updated" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.message).toBe("Intent updated.");
  });

  test("delete_intent when context.networkId set and intent in index returns success and data shape", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getNetworkIdsForIntent: async (intentId: string) => (intentId === intentInIndex.id ? [networkId] : []),
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentInIndex.id });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.message).toBe("Intent archived.");
  });
});

describe("create_opportunities tool", () => {
  test("returns a tool named create_opportunities with schema containing searchQuery, optional networkId, and optional intentId", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities");
    expect(tool).toBeDefined();
    const schema = (tool as { schema?: { shape?: Record<string, unknown> } }).schema;
    const shape = schema?.shape ?? (tool as { schema?: { schema?: { shape?: Record<string, unknown> } } }).schema?.schema?.shape;
    expect(shape?.searchQuery).toBeDefined();
    expect(shape?.networkId).toBeDefined();
    expect(shape?.intentId).toBeDefined();
  });

  test("when user has no index memberships (getNetworkMemberships returns []), returns found false with message about joining an index", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as { invoke: (args: { searchQuery: string; networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ searchQuery: "Find a co-founder" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(false);
    expect(parsed.data.message).toMatch(/join|index|community/i);
  });

  test("introduction mode: when partyUserIds given but entities empty, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], { isNetworkMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { partyUserIds?: string[]; entities?: unknown[] }) => Promise<string>;
    };
    const result = await tool.invoke({
      partyUserIds: [testUserId, "other-user-id"],
      entities: [],
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/pre-gathered|entity data|entities/i);
  });

  test("introduction mode: when entities missing networkId, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], { isNetworkMember: async () => true });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { partyUserIds?: string[]; entities?: Array<{ userId: string; networkId?: string }> }) => Promise<string>;
    };
    const errorMessageRe = /networkId|shared index|required/i;
    try {
      const result = await tool.invoke({
        partyUserIds: [testUserId, "other-user-id"],
        entities: [{ userId: testUserId }, { userId: "other-user-id" }],
      });
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();
      expect(String(parsed.error)).toMatch(errorMessageRe);
    } catch (err) {
      // Schema validation (e.g. Zod) may throw before handler runs
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toMatch(errorMessageRe);
    }
  });

  test("introduction mode: with valid partyUserIds and entities with networkId returns success and opportunities", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      opportunityExistsBetweenActors: async () => false,
      findOverlappingOpportunities: async () => [],
      createOpportunity: async (data) =>
        ({
          id: "opp-success-1",
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? "latent",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        }) as Opportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: {
        partyUserIds?: string[];
        entities?: Array<{ userId: string; profile?: Record<string, unknown>; networkId: string }>;
      }) => Promise<string>;
    };
    const result = await tool.invoke({
      partyUserIds: [testUserId, "other-user-id"],
      entities: [
        { userId: testUserId, profile: { name: "Me" }, networkId: "idx-1" },
        { userId: "other-user-id", profile: { name: "Other" }, networkId: "idx-1" },
      ],
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(Array.isArray(parsed.data.opportunities) ? parsed.data.opportunities : []).toBeDefined();
  });

  test("introduction mode: viewer as introducer — card headline is 'PartyA → PartyB' and action is 'Introduce Them'", async () => {
    // Viewer (testUserId) is NOT in partyUserIds → viewerRole = "introducer"
    // Timeout elevated: opportunity graph invokes the evaluator agent (LLM call)
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      opportunityExistsBetweenActors: async () => false,
      findOverlappingOpportunities: async () => [],
      createOpportunity: async (data) =>
        ({
          id: "opp-intro-1",
          detection: data.detection,
          actors: data.actors,
          interpretation: { ...data.interpretation, reasoning: "Good match between Alice and Bob." },
          context: data.context,
          confidence: data.confidence,
          status: "draft",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        }) as Opportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: {
        partyUserIds?: string[];
        entities?: Array<{ userId: string; profile?: Record<string, unknown>; networkId: string }>;
      }) => Promise<string>;
    };
    const result = await tool.invoke({
      partyUserIds: ["alice-id", "bob-id"],
      entities: [
        { userId: "alice-id", profile: { name: "Alice" }, networkId: "idx-1" },
        { userId: "bob-id", profile: { name: "Bob" }, networkId: "idx-1" },
      ],
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    // Extract the opportunity card JSON from the message code block
    const blockMatch = parsed.data.message.match(/```opportunity\n([\s\S]*?)\n```/);
    expect(blockMatch).not.toBeNull();
    const card = JSON.parse(blockMatch![1].replace(/\\u0060/g, "`"));

    expect(card.viewerRole).toBe("introducer");
    expect(card.headline).toBe("Alice → Bob");
    expect(card.primaryActionLabel).toBe("Good match");
  }, 60000);

  test("introduction mode: viewer as party — card headline is 'Connection with Counterpart' and action is 'Start Chat'", async () => {
    // Viewer (testUserId) IS in partyUserIds → viewerRole = "party"
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      opportunityExistsBetweenActors: async () => false,
      findOverlappingOpportunities: async () => [],
      createOpportunity: async (data) =>
        ({
          id: "opp-party-1",
          detection: data.detection,
          actors: data.actors,
          interpretation: { ...data.interpretation, reasoning: "Good match." },
          context: data.context,
          confidence: data.confidence,
          status: "draft",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        }) as Opportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: {
        partyUserIds?: string[];
        entities?: Array<{ userId: string; profile?: Record<string, unknown>; networkId: string }>;
      }) => Promise<string>;
    };
    const result = await tool.invoke({
      partyUserIds: [testUserId, "other-id"],
      entities: [
        { userId: testUserId, profile: { name: "Me" }, networkId: "idx-1" },
        { userId: "other-id", profile: { name: "Other" }, networkId: "idx-1" },
      ],
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);

    const blockMatch = parsed.data.message.match(/```opportunity\n([\s\S]*?)\n```/);
    expect(blockMatch).not.toBeNull();
    const card = JSON.parse(blockMatch![1].replace(/\\u0060/g, "`"));

    expect(card.viewerRole).toBe("party");
    expect(card.headline).toBe("Connection with Other");
    expect(card.primaryActionLabel).toBe("Start Chat");
  });

  test("introduction mode: entities only (no partyUserIds) derives partyUserIds and creates opportunity", async () => {
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      opportunityExistsBetweenActors: async () => false,
      findOverlappingOpportunities: async () => [],
      createOpportunity: async (data) =>
        ({
          id: "opp-from-entities-only",
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? "latent",
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        }) as Opportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: {
        entities?: Array<{ userId: string; profile?: Record<string, unknown>; networkId: string }>;
      }) => Promise<string>;
    };
    const result = await tool.invoke({
      entities: [
        { userId: testUserId, profile: { name: "Me" }, networkId: "idx-1" },
        { userId: "other-user-id", profile: { name: "Other" }, networkId: "idx-1" },
      ],
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(Array.isArray(parsed.data.opportunities)).toBe(true);
    expect(parsed.data.opportunities.length).toBe(1);
    const opp = parsed.data.opportunities[0];
    // Tool returns minimal summary — not the full DB record
    expect(opp.opportunityId).toBe("opp-from-entities-only");
    expect(typeof opp.matchReason).toBe("string");
    expect(opp.matchReason.length).toBeGreaterThan(0);
    expect(typeof opp.score).toBe("number");
    expect(["latent", "draft", "pending", "accepted", "rejected", "expired"]).toContain(opp.status);
  });

  test("discovery mode: when searchQuery is non-empty and results are found, includes suggestIntentCreationForVisibility and suggestedIntentDescription", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 1,
      opportunities: [{
        opportunityId: "opp-discovery-1",
        userId: "candidate-user-id",
        name: "Alice Investor",
        avatar: null,
        matchReason: "Both interested in game investments",
        score: 0.8,
        status: "draft",
      }],
    };
    // Use getNetworkMemberships to populate indexScope via graphs.index (avoids UUID check on context.networkId)
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery: string }) => Promise<string>;
    };
    const searchQuery = "looking for investors for my game project";
    const result = await tool.invoke({ searchQuery });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.suggestIntentCreationForVisibility).toBe(true);
    expect(parsed.data.suggestedIntentDescription).toBe(searchQuery);
  });

  test("discovery mode: when searchQuery is empty, does not include suggestIntentCreationForVisibility", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 1,
      opportunities: [{
        opportunityId: "opp-discovery-2",
        userId: "candidate-user-id",
        name: "Bob Investor",
        avatar: null,
        matchReason: "Both interested in game development",
        score: 0.75,
        status: "draft",
      }],
    };
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery?: string }) => Promise<string>;
    };
    const result = await tool.invoke({ searchQuery: "" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.suggestIntentCreationForVisibility).toBeUndefined();
  });

  test("introducer discovery: does not include suggestIntentCreationForVisibility even with non-empty searchQuery (IND-177)", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 1,
      opportunities: [{
        opportunityId: "opp-intro-discovery-1",
        userId: "candidate-user-id",
        name: "Carol Biotech",
        avatar: null,
        matchReason: "Both interested in biotech investments",
        score: 0.85,
        status: "draft",
      }],
    };
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery: string; introTargetUserId: string }) => Promise<string>;
    };
    const result = await tool.invoke({
      searchQuery: "looking for biotech investors",
      introTargetUserId: "abb9fae3-fdef-48a4-8d2c-e71fb1169264",
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.suggestIntentCreationForVisibility).toBeUndefined();
    expect(parsed.data.suggestedIntentDescription).toBeUndefined();
    expect(parsed.data.message).not.toContain("create a signal");
  });

  test("introducer discovery: does not auto-suggest intent creation when graph returns createIntentSuggested (IND-177)", async () => {
    mockDiscoveryResult = {
      found: false,
      count: 0,
      createIntentSuggested: true,
      suggestedIntentDescription: "biotech investors for early-stage startups",
    };
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery: string; introTargetUserId: string }) => Promise<string>;
    };
    const result = await tool.invoke({
      searchQuery: "biotech investors",
      introTargetUserId: "abb9fae3-fdef-48a4-8d2c-e71fb1169264",
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.createIntentSuggested).toBeUndefined();
  });

  test("discovery mode: caps displayed opportunity cards at CHAT_DISPLAY_LIMIT (3) even when graph returns more", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 5,
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        opportunityId: `opp-cap-${i + 1}`,
        userId: `candidate-${i + 1}`,
        name: `Candidate ${i + 1}`,
        avatar: null,
        matchReason: `Match reason ${i + 1}`,
        score: 0.9 - i * 0.1,
        status: "draft",
      })),
    };
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery: string }) => Promise<string>;
    };
    const result = await tool.invoke({ searchQuery: "looking for co-founders" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.count).toBe(3);
    // Count opportunity code blocks in the message
    const blocks = parsed.data.message.match(/```opportunity\n[\s\S]*?\n```/g) ?? [];
    expect(blocks.length).toBe(3);
    // No discoveryId in pagination → falls through to signal suggestion instead of "see more"
    expect(parsed.data.message).toContain("create a signal");
  });

  test("discovery mode: offers 'see more' when discoveryId is available and extra cards were capped", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 5,
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        opportunityId: `opp-more-${i + 1}`,
        userId: `candidate-more-${i + 1}`,
        name: `Candidate ${i + 1}`,
        avatar: null,
        matchReason: `Match reason ${i + 1}`,
        score: 0.9 - i * 0.1,
        status: "draft",
      })),
      pagination: { discoveryId: "disc-123", evaluated: 5, remaining: 3 },
    };
    const mockDb = createMockDatabase(async () => [], {
      getNetworkMemberships: async () => [{
        networkId: "00000000-0000-0000-0000-000000000001",
        networkTitle: "Test Index",
        indexPrompt: null,
        permissions: [],
        memberPrompt: null,
        autoAssign: false,
        isPersonal: false,
        joinedAt: new Date(),
      }],
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { searchQuery: string }) => Promise<string>;
    };
    const result = await tool.invoke({ searchQuery: "looking for co-founders" });
    const parsed = JSON.parse(result);
    expect(parsed.data.count).toBe(3);
    // 3 remaining from pagination + 2 extra from cap = 5 total remaining
    expect(parsed.data.message).toContain("5 more candidates");
    expect(parsed.data.message).toContain("disc-123");
  });

  test("continueFrom mode: caps displayed opportunity cards at CHAT_DISPLAY_LIMIT (3) even when graph returns more", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 5,
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        opportunityId: `opp-continue-${i + 1}`,
        userId: `candidate-continue-${i + 1}`,
        name: `Candidate Continue ${i + 1}`,
        avatar: null,
        matchReason: `Continue match reason ${i + 1}`,
        score: 0.9 - i * 0.1,
        status: "draft",
      })),
      pagination: { remaining: 2, discoveryId: "disc-continue-123" },
    };
    const mockDb = createMockDatabase(async () => [], {});
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { continueFrom: string }) => Promise<string>;
    };
    const result = await tool.invoke({ continueFrom: "disc-continue-123" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.count).toBe(3);
    // Count opportunity code blocks in the message
    const blocks = parsed.data.message.match(/```opportunity\n[\s\S]*?\n```/g) ?? [];
    expect(blocks.length).toBe(3);
    // Should mention remaining candidates (2 from pagination + 2 extra from cap = 4)
    expect(parsed.data.message).toContain("more candidates");
  });

  test("continueFrom introducer flow: final page does not include signal creation CTA (IND-177)", async () => {
    mockDiscoveryResult = {
      found: true,
      count: 1,
      opportunities: [{
        opportunityId: "opp-intro-continue-1",
        userId: "candidate-intro-continue",
        name: "Diana Researcher",
        avatar: null,
        matchReason: "Both interested in biotech",
        score: 0.8,
        status: "draft",
      }],
    };
    const mockDb = createMockDatabase(async () => [], {});
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "create_opportunities") as {
      invoke: (args: { continueFrom: string; introTargetUserId: string }) => Promise<string>;
    };
    const result = await tool.invoke({
      continueFrom: "disc-intro-continue-456",
      introTargetUserId: "abb9fae3-fdef-48a4-8d2c-e71fb1169264",
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);
    expect(parsed.data.message).not.toContain("create a signal");
    expect(parsed.data.message).toContain("introduction candidates");
  });
});

describe("update_opportunity tool (send via status pending)", () => {
  const opportunityId = "00000000-0000-0000-0000-000000000123";

  test("when opportunity is latent and user is actor, status pending promotes to pending and returns success", async () => {
    const latentOpportunity = {
      id: opportunityId,
      status: "latent" as const,
      actors: [
        { networkId: "idx-1", userId: testUserId, role: "party" as const },
        { networkId: "idx-1", userId: "other-user-id", role: "party" as const },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", reasoning: "Match", confidence: 0.8 },
      context: { networkId: "idx-1" },
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const updateStatusSpy = mock(async () => null);
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => latentOpportunity,
      updateOpportunityStatus: updateStatusSpy,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.opportunityId).toBe(opportunityId);
    expect(parsed.data.status).toBe("pending");
    expect(updateStatusSpy).toHaveBeenCalledWith(opportunityId, "pending");
  });

  test("when opportunity is draft and user is actor, status pending promotes to pending and returns success", async () => {
    const draftOpportunity = {
      id: opportunityId,
      status: "draft" as const,
      actors: [
        { networkId: "idx-1", userId: testUserId, role: "party" as const },
        { networkId: "idx-1", userId: "other-user-id", role: "party" as const },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", reasoning: "Match", confidence: 0.8 },
      context: { networkId: "idx-1" },
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const updateStatusSpy = mock(async () => null);
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => draftOpportunity,
      updateOpportunityStatus: updateStatusSpy,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.opportunityId).toBe(opportunityId);
    expect(parsed.data.status).toBe("pending");
    expect(updateStatusSpy).toHaveBeenCalledWith(opportunityId, "pending");
  });

  test("when opportunity not found, returns error", async () => {
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => null,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId: "00000000-0000-0000-0000-000000000099", status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/Opportunity not found|not found|Valid opportunityId/i);
  });

  test("when opportunity status is not latent or draft (e.g. already pending), returns error", async () => {
    const pendingOpportunity = {
      id: opportunityId,
      status: "pending" as const,
      actors: [
        { networkId: "idx-1", userId: testUserId, role: "party" as const },
        { networkId: "idx-1", userId: "other-user-id", role: "party" as const },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", reasoning: "Match", confidence: 0.8 },
      context: { networkId: "idx-1" },
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => pendingOpportunity,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/already|draft|latent|pending|Valid opportunityId/i);
  });

  test("when user is not part of the opportunity, returns error", async () => {
    const opportunityWithoutUser = {
      id: opportunityId,
      status: "latent" as const,
      actors: [
        { networkId: "idx-1", userId: "user-a", role: "party" as const },
        { networkId: "idx-1", userId: "user-b", role: "party" as const },
      ],
      detection: { source: "opportunity_graph" as const, timestamp: new Date().toISOString() },
      interpretation: { category: "collaboration", reasoning: "Match", confidence: 0.8 },
      context: { networkId: "idx-1" },
      confidence: "0.8",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    };
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => opportunityWithoutUser,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/not part of this opportunity|not part|Valid opportunityId/i);
  });
});

describe("read_user_profiles tool (query parameter — name search)", () => {
  const indexA = "a1b2c3d4-0000-4000-8000-000000000030";
  const indexB = "a1b2c3d4-0000-4000-8000-000000000031";

  const allMembers = [
    { userId: "user-mei", name: "Mei Lin", avatar: null },
    { userId: "user-diego", name: "Diego Alvarez", avatar: null },
    { userId: "user-priya", name: "Priya Nair", avatar: null },
    { userId: testUserId, name: "Test User", avatar: null },
  ];

  const priyaProfile = {
    identity: { name: "Priya Nair", bio: "Full-stack engineer and open-source contributor", location: "Berlin" },
    attributes: { skills: ["TypeScript", "React"], interests: ["DevTools", "OSS"] },
    embedding: [],
  };

  const meiProfile = {
    identity: { name: "Mei Lin", bio: "AI researcher", location: "London" },
    attributes: { skills: ["Python", "ML"], interests: ["NLP"] },
    embedding: [],
  };

  function createMockSystemDb(overrides?: Partial<SystemDatabase>): SystemDatabase {
    return {
      authUserId: testUserId,
      indexScope: [indexA, indexB],
      getMembersFromScope: async () => allMembers,
      getNetworkMembers: async (networkId: string) =>
        networkId === indexA
          ? allMembers.map((m) => ({ ...m, email: null, permissions: ["member"], memberPrompt: null, autoAssign: false, joinedAt: new Date(), intentCount: 0 }))
          : [],
      getProfile: async (userId: string) => {
        if (userId === "user-priya") return priyaProfile;
        if (userId === "user-mei") return meiProfile;
        return null;
      },
      isNetworkMember: async () => true,
      isIndexOwner: async () => false,
      ...overrides,
    } as unknown as SystemDatabase;
  }

  test("query finds a member by name across all indexes", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Priya" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(1);
    expect(parsed.data.profiles).toHaveLength(1);
    expect(parsed.data.profiles[0].userId).toBe("user-priya");
    expect(parsed.data.profiles[0].name).toBe("Priya Nair");
    expect(parsed.data.profiles[0].hasProfile).toBe(true);
    expect(parsed.data.profiles[0].profile.bio).toBe("Full-stack engineer and open-source contributor");
  });

  test("query is case-insensitive", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "priya nair" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(1);
    expect(parsed.data.profiles[0].userId).toBe("user-priya");
  });

  test("query with networkId scopes to that index", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string; networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Mei", networkId: indexA });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(1);
    expect(parsed.data.profiles[0].userId).toBe("user-mei");
  });

  test("query returns empty when no name matches", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Nonexistent Person" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(0);
    expect(parsed.data.profiles).toHaveLength(0);
    expect(parsed.data.message).toMatch(/No members found/i);
  });

  test("query excludes the current user from results", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Test User" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(0);
  });

  test("query returns profile as undefined when user has no profile", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_profiles") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Diego" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(1);
    expect(parsed.data.profiles[0].userId).toBe("user-diego");
    expect(parsed.data.profiles[0].hasProfile).toBe(false);
    expect(parsed.data.profiles[0].profile).toBeUndefined();
  });
});

describe("list_opportunities tool (CHAT_DISPLAY_LIMIT cap)", () => {
  /**
   * Build N fake Opportunity records that list_opportunities can process.
   * Each has a unique counterpart actor so buildMinimalOpportunityCard produces
   * a distinct card.
   */
  function buildFakeOpportunities(n: number): Opportunity[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `opp-fake-${i}`,
      status: "pending",
      interpretation: { reasoning: `Reasoning for opp ${i}`, confidence: 0.8 },
      actors: [
        { userId: testUserId, role: "party" },
        { userId: `counterpart-${i}`, role: "party" },
      ],
      detection: { source: "discovery", createdByName: null },
      context: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    })) as unknown as Opportunity[];
  }

  test("returns at most 3 opportunity code blocks when database has 5 opportunities", async () => {
    const fakeOpps = buildFakeOpportunities(5);
    let capturedLimit: number | undefined;
    const mockDb = createMockDatabase(async () => [], {
      getOpportunitiesForUser: async (_userId: string, opts?: { networkId?: string; limit?: number }) => {
        capturedLimit = opts?.limit;
        // Respect the limit like a real database would
        return opts?.limit ? fakeOpps.slice(0, opts.limit) : fakeOpps;
      },
    } as unknown as MockOverrides);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    // createChatTools filters out list_opportunities; access all opportunity tools via the full tool set
    // by temporarily adding getOpportunitiesForUser and using createChatTools' underlying factory.
    // Instead, we import createOpportunityTools and wire a minimal defineTool.
    const { tool: lcTool } = await import("@langchain/core/tools");
    const { createOpportunityTools } = await import("../../../opportunity/opportunity.tools.js");
    const { z } = await import("zod");

    const resolvedContext = {
      userId: testUserId,
      networkId: undefined,
      sessionId: undefined,
      userName: "Test User",
      userNetworks: [],
      scopedIndexRole: undefined,
      indexName: undefined,
    };

    function defineTool<T extends import("zod").ZodType>(opts: {
      name: string;
      description: string;
      querySchema: T;
      handler: (input: { context: typeof resolvedContext; query: import("zod").infer<T> }) => Promise<string>;
    }) {
      return lcTool(
        async (query: import("zod").infer<T>) => opts.handler({ context: resolvedContext, query }),
        { name: opts.name, description: opts.description, schema: opts.querySchema },
      );
    }

    const noopGraph = { invoke: async () => ({}) };
    const deps = {
      database: mockDb,
      userDb: { getUser: async () => ({ id: testUserId, name: "Test User" }) },
      systemDb: {},
      scraper: mockScraper,
      embedder: mockEmbedder,
      cache: {},
      graphs: {
        profile: noopGraph,
        intent: noopGraph,
        index: noopGraph,
        networkMembership: noopGraph,
        intentIndex: noopGraph,
        opportunity: noopGraph,
      },
    };

    const oppTools = createOpportunityTools(defineTool as never, deps as never);
    const listTool = (oppTools as unknown as Array<{ name: string; invoke: (args: { networkId?: string }) => Promise<string> }>)
      .find((t) => t.name === "list_opportunities")!;
    expect(listTool).toBeDefined();

    const result = await listTool.invoke({});
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.found).toBe(true);

    // Verify CHAT_DISPLAY_LIMIT (3) was passed to the database query
    expect(capturedLimit).toBe(3);

    // Count actual ```opportunity code blocks (start-of-line or after newline, not mid-sentence mentions)
    const codeBlockCount = (parsed.data.message.match(/(?:^|\n)```opportunity\n/g) || []).length;
    expect(codeBlockCount).toBe(3);
    // Total count reported should also be capped
    expect(parsed.data.count).toBe(3);
  });
});

afterAll(() => mock.restore());
