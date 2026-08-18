/**
 * Unit tests for chat tools (createChatTools, read_intents, read_indexes, read_users, discover_opportunities, update_opportunity, etc.).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { mock, afterAll } from "bun:test";
// Route to canonical application path so the mock intercepts the import used
// by tool.factory.ts after the IND-544 signals domain-first migration.
mock.module("../../../intents/graph/intent.graph.js", () => ({
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
          indexScope?: string[];
          targetIntentIds?: string[];
        }) => {
          // For read operations, replicate the real queryNode logic using the database
          if (input.operationMode === "read") {
            // Scope-aware default: caller's intents across all reachable networks.
            // Triggered when the tool layer passed indexScope and did not pick a
            // specific networkId or queryUserId.
            if (
              !input.queryUserId &&
              !input.networkId &&
              input.indexScope &&
              input.indexScope.length > 0
            ) {
              const intents = await (db as unknown as { getActiveIntentsAcrossIndexes: (userId: string, indexIds: string[]) => Promise<{ id: string; payload: string; summary: string | null; createdAt: Date }[]> }).getActiveIntentsAcrossIndexes(
                input.userId,
                input.indexScope,
              );
              return {
                readResult: {
                  count: intents.length,
                  intents: intents.map((i) => ({
                    id: i.id,
                    description: i.payload,
                    summary: i.summary,
                    createdAt: i.createdAt,
                  })),
                  ...(intents.length === 0 && { message: "You don't have any active intents yet. Share what you're looking for." }),
                },
              };
            }

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
                    ...(intents.length === 0 && { message: "No intents in this network yet." }),
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

            // No network scope: return user's own active intents
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

          // For update/delete with network scope: enforce index scoping (intent must be in index)
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

          // For write operations (create/update/delete), return a deterministic
          // success result so provider-free tests pass without LLM credentials.
          if (input.operationMode === 'update' || input.operationMode === 'create') {
            const targetId = Array.isArray(input.targetIntentIds) && input.targetIntentIds.length > 0
              ? input.targetIntentIds[0] : 'stub-intent-id';
            return {
              executionResults: [{ success: true, intentId: targetId, description: 'stub' }],
              actions: [],
              inferredIntents: [],
            };
          }
          // For other non-read operations without network scope, return default empty results
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
const mockDiscoveryResult: {
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
mock.module("../../../opportunities/opportunity.presentation.js", () => ({
  OpportunityPresenter: class {
    async presentCard() {
      return {
        personalizedSummary: "A relevant connection is ready to review.",
        digestSummary: "A relevant connection is ready to review.",
        suggestedAction: "Review this connection.",
        headline: "A relevant connection",
        mutualIntentsLabel: "Suggested connection",
        narratorRemark: "Worth reviewing.",
      };
    }
  },
  gatherPresenterContext: async () => ({}),
}));

import { describe, test, expect, beforeAll } from "bun:test";
import { createChatTools, type ToolContext } from "../tool.factory.js";
import type { ChatGraphCompositeDatabase, SystemDatabase } from "../../interfaces/database.interface.js";
import type { ActiveIntent, IndexMemberDetails, IndexedIntentDetails } from "../../interfaces/database.interface.js";
import type { Embedder } from "../../interfaces/embedder.interface.js";
import type { Scraper } from "../../interfaces/scraper.interface.js";

const testUserId = "test-user-id-for-tools";

type MockOverrides = Partial<Pick<
  ChatGraphCompositeDatabase,
  "getUser" | "getNetwork" | "getOwnedIndexes" | "isIndexOwner" | "isNetworkMember" | "getNetworkMembersForOwner" | "getNetworkMembersForMember" | "getNetworkIntentsForOwner" | "getNetworkMemberships" | "getNetworkMembership" | "getNetworkIntentsForMember" | "getNetworkWithPermissions" | "getIntent" | "getOpportunity" | "getOpportunitiesForUser" | "updateOpportunityStatus" | "stampOpportunityActorAction" | "getActiveIntents" | "getIntentsInIndexForMember" | "getNetworkIdsForIntent" | "opportunityExistsBetweenActors" | "findOpportunitiesByActors" | "createOpportunity"
>> & {
  /** Optional stub for getActiveIntentsAcrossIndexes (used by indexScope read path). */
  getActiveIntentsAcrossIndexes?: (userId: string, indexIds: string[]) => Promise<ActiveIntent[]>;
};

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
    // Non-null profile is required by IntentGraph write-mode gate
    // (gate: state.operationMode !== 'read' → checks getProfile).
    getProfile: async () => ({ id: "profile-stub", identity: { name: "Test User", bio: "Test bio" } } as any),
    getProfileByUserId: noopNull,
    getActiveIntents: noopArray,
    getIntentsInIndexForMember: getIntentsInIndexForMemberImpl,
    getUser: async (uid: string) => ({ id: uid, name: "Test User", email: "test@example.com" }),
    // Required by EnrichmentGraph hasBeenEnriched check (post-IND-551 merge).
    getPremisesForUser: noopArray,
    getNetwork: async (networkId: string) => ({ id: networkId, title: "Test Index" }),
    saveProfile: noop,
    createIntent: async () => ({ id: "", payload: "", summary: null, isIncognito: false, createdAt: new Date(), updatedAt: new Date(), userId: "" }),
    updateIntent: noopNull,
    updateUser: noopNull,
    archiveIntent: async () => ({ success: true }),
    getUserIndexIds: noopArray,
    getNetworkMemberships: async () => [{ networkId: "idx-1" }],
    getActiveNetworkMembershipPairs: async (pairs: Array<{ userId: string; networkId: string }>) => pairs,
    getPublicIndexesNotJoined: async () => ({ networks: [] }),
    getNetworkMembership: noopNull,
    getNetworkWithPermissions: async () => null,
    getIntent: noopNull,
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
      permissions: { joinPolicy: "invite_only" as const, invitationLink: null },
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      memberCount: 0,
      intentCount: 0,
    }),
    softDeleteNetwork: noop,
    deleteProfile: noop,
    getNetworkMemberCount: async () => 0,
    createNetwork: async () => ({ id: "", title: "", prompt: null, permissions: { joinPolicy: "invite_only" as const, invitationLink: null } }),
    addMemberToNetwork: async () => ({ success: true }),
    getMembersFromUserIndexes: async () => [],
    getOpportunity: noopNull,
    getOpportunitiesForUser: noopArray,
    createOpportunityIfNetworkEligible: async (data: unknown) =>
      overrides?.createOpportunity
        ? overrides.createOpportunity(data as Parameters<typeof overrides.createOpportunity>[0])
        : null,
    getNegotiationTaskForOpportunity: noopNull,
    updateOpportunityStatus: noopNull,
    stampOpportunityActorAction: noopNull,
    getActiveIntentsAcrossIndexes: noopArray,
  };
  return { ...base, ...overrides } as unknown as ChatGraphCompositeDatabase;
}

/** Stub embedder for tool creation (not invoked by read_intents). */
const mockEmbedder = {
  generate: async () => [] as number[],
  generateForDocuments: async () => [],
  addVectors: async () => [],
  similaritySearch: async () => [],
  // Required by OpportunityGraph discovery node (post-IND-551 merge widened contract).
  searchWithHydeEmbeddings: async () => [],
} as unknown as Embedder;

/** Stub scraper for tool creation (not invoked by read_intents). */
const mockScraper = {
  scrape: async () => "",
  extractUrlContent: async (_url: string, _options?: { objective?: string }) => "",
} as unknown as Scraper;

/** Stub protocol-level deps for ToolContext (not invoked in most unit tests). */
const mockProtocolDeps: Omit<ToolContext, 'userId' | 'database' | 'embedder' | 'scraper' | 'indexId' | 'sessionId' | 'userDb' | 'systemDb'> = {
  // IND-593: chat contexts in this spec are direct authenticated-owner
  // interactions; the owner-approval authority attests them through the same
  // boundary (authoritative host derivation, not a bypass).
  opportunityOwnerApproval: {
    consumeAgentProof: async () => ({ kind: 'denied' as const, reason: 'missing' as const }),
    attestOwnerInteraction: async () => ({ kind: 'admitted' as const }),
  },
  cache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false, mget: async () => [], deleteByPattern: async () => 0 },
  hydeCache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false },
  intentQueue: { addGenerateHydeJob: async () => ({}), addDeleteHydeJob: async () => ({}) },
  contactService: { listContacts: async () => [], searchContacts: async () => [], removeContact: async () => {} },
  chatSession: { getSessionMessages: async () => [], listSessions: async () => [], getSession: async () => null },
  enricher: { enrichUserProfile: async () => null },
  negotiationDatabase: {
    getNegotiationTaskForOpportunity: async () => null,
  } as unknown as import("../../interfaces/database.interface.js").NegotiationGraphDatabase,
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
    acceptSiblingOpportunities: db.acceptSiblingOpportunities ?? (async () => {}),
    getHydeDocument: db.getHydeDocument ?? (async () => null),
    getHydeDocumentsForSource: db.getHydeDocumentsForSource ?? (async () => []),
    saveHydeDocument: db.saveHydeDocument ?? (async () => {}),
    deleteHydeDocumentsForSource: db.deleteHydeDocumentsForSource ?? (async () => {}),
  }) as unknown as import("../../interfaces/database.interface.js").UserDatabase,
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
    findOpportunitiesByActors: db.findOpportunitiesByActors ?? (async () => []),
    expireOpportunitiesByIntent: async () => {},
    expireOpportunitiesForRemovedMember: async () => {},
    expireStaleOpportunities: async () => {},
    getActiveIntentsAcrossIndexes: db.getActiveIntentsAcrossIndexes ?? (async () => []),
    getHydeDocument: db.getHydeDocument ?? (async () => null),
    getHydeDocumentsForSource: db.getHydeDocumentsForSource ?? (async () => []),
    saveHydeDocument: db.saveHydeDocument ?? (async () => {}),
    deleteExpiredHydeDocuments: async () => {},
    getStaleHydeDocuments: async () => [],
  }) as unknown as import("../../interfaces/database.interface.js").SystemDatabase,
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

  test("includes retained opportunity read and action tools", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const names = tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain("list_opportunities");
    expect(names).toContain("update_opportunity");
    expect(names).not.toContain("discover_opportunities");
  });

  test("intent-scoped chat exposes update_intent but not create_intent", async () => {
    const mockDb = createMockDatabase(async () => []);
    const context: ToolContext = {
      userId: testUserId,
      database: mockDb,
      embedder: mockEmbedder,
      scraper: mockScraper,
      scopeType: "intent",
      scopeId: "11111111-1111-4111-8111-111111111111",
      ...mockProtocolDeps,
    };

    const tools = await createChatTools(context);
    const names = tools.map((candidate: { name: string }) => candidate.name);

    expect(names).not.toContain("create_intent");
    expect(names).toContain("update_intent");
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
      getNetworkIntentsForMember: async (_indexId, _requestingUserId) =>
        _indexId === testIndexId ? indexIntentsForMember : [],
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

  test("when scope envelope is set, omit networkId to get caller-own intents via indexScope", async () => {
    const personalIndexId = "personal-test-scope-idx";
    let getActiveIntentsAcrossIndexesCalled = false;
    const callerIntents = [
      { id: "i1", payload: "In index", summary: "X", createdAt: new Date() },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkMemberships: async () => [
        { networkId: testIndexId, networkTitle: "Scoped", indexPrompt: null, permissions: ["member"], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
        { networkId: personalIndexId, networkTitle: "Personal", indexPrompt: null, permissions: ["owner"], memberPrompt: null, autoAssign: true, isPersonal: true, joinedAt: new Date() },
      ],
      getActiveIntentsAcrossIndexes: async (_uid: string, ids: string[]) => {
        getActiveIntentsAcrossIndexesCalled = true;
        expect(ids.sort()).toEqual([testIndexId, personalIndexId].sort());
        return callerIntents;
      },
    });
    const context: ToolContext = {
      userId: testUserId,
      database: mockDb,
      embedder: mockEmbedder,
      scraper: mockScraper,
      scopeType: 'network',
      scopeId: testIndexId,
      ...mockProtocolDeps,
    };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({});
    expect(getActiveIntentsAcrossIndexesCalled).toBe(true);
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

describe("read_intents tool (network-scoped: owner vs member)", () => {
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
        uid === otherUserId
          ? { id: uid, name: "Bob", email: "bob@example.com", socials: [] }
          : { id: testUserId, name: "Test User", email: "test@example.com", socials: [] },
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

  test("with scope envelope and no args, returns caller-only intents across derived scope (does not call getNetworkIntentsForMember)", async () => {
    const networkId = testIndexId;
    const personalIndexId = "personal-test-idx";
    let getActiveIntentsAcrossIndexesCalled = false;
    let getNetworkIntentsForMemberCalled = false;

    const callerIntents = [
      { id: "self-a", payload: "Caller intent A", summary: "A", createdAt: new Date("2026-01-01") },
      { id: "self-b", payload: "Caller intent B", summary: "B", createdAt: new Date("2026-01-02") },
    ];

    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkMemberships: async () => [
        { networkId, networkTitle: "Scoped", indexPrompt: null, permissions: ["member"], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
        { networkId: personalIndexId, networkTitle: "Personal", indexPrompt: null, permissions: ["owner"], memberPrompt: null, autoAssign: true, isPersonal: true, joinedAt: new Date() },
      ],
      getActiveIntentsAcrossIndexes: async (uid: string, ids: string[]) => {
        getActiveIntentsAcrossIndexesCalled = true;
        expect(uid).toBe(testUserId);
        expect(ids.sort()).toEqual([networkId, personalIndexId].sort());
        return callerIntents;
      },
      getNetworkIntentsForMember: async () => {
        getNetworkIntentsForMemberCalled = true;
        return [];
      },
    });

    const context: ToolContext = {
      userId: testUserId,
      database: mockDb,
      embedder: mockEmbedder,
      scraper: mockScraper,
      scopeType: 'network',
      scopeId: networkId,
      ...mockProtocolDeps,
    };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: Record<string, unknown>) => Promise<string> };
    const result = await tool.invoke({});

    expect(getActiveIntentsAcrossIndexesCalled).toBe(true);
    expect(getNetworkIntentsForMemberCalled).toBe(false);

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
    expect(parsed.data.intents.map((i: { id: string }) => i.id).sort()).toEqual(["self-a", "self-b"]);
  });

  test("with scope envelope and explicit networkId arg, still browses all members in that network (existing behavior)", async () => {
    const networkId = testIndexId;
    let getNetworkIntentsForMemberCalled = false;
    const allMembersIntents: IndexedIntentDetails[] = [
      { id: "me-1", payload: "My intent", summary: "m", createdAt: new Date(), userId: testUserId, userName: "Me" },
      { id: "other-1", payload: "Their intent", summary: "t", createdAt: new Date(), userId: "other-user", userName: "Them" },
    ];
    const mockDb = createMockDatabase(async () => [], {
      isNetworkMember: async () => true,
      getNetworkIntentsForMember: async (idxId: string, uid: string) => {
        getNetworkIntentsForMemberCalled = true;
        expect(idxId).toBe(networkId);
        expect(uid).toBe(testUserId);
        return allMembersIntents;
      },
    });
    const context: ToolContext = {
      userId: testUserId,
      database: mockDb,
      embedder: mockEmbedder,
      scraper: mockScraper,
      networkId,
      indexScope: [networkId, "personal-test-idx"],
      ...mockProtocolDeps,
    };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { networkId?: string }) => Promise<string> };
    const result = await tool.invoke({ networkId });

    expect(getNetworkIntentsForMemberCalled).toBe(true);
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(2);
  });

  test("with scope envelope and explicit userId of co-member, reads that member's intents in the bound network (not caller's globals)", async () => {
    const networkId = testIndexId;
    const otherUserId = "00000000-0000-0000-0000-000000000099";
    let getIntentsInIndexForMemberCall: { userId: string; networkId: string } | null = null;

    const mockDb = createMockDatabase(
      async (uid: string, idx: string) => {
        getIntentsInIndexForMemberCall = { userId: uid, networkId: idx };
        return [{ id: "other-1", payload: "Their intent in bound", summary: "T", createdAt: new Date(), userId: uid, userName: "Other" }];
      },
      { isNetworkMember: async () => true }
    );

    const context: ToolContext = {
      userId: testUserId,
      database: mockDb,
      embedder: mockEmbedder,
      scraper: mockScraper,
      networkId,
      indexScope: [networkId, "personal-test-idx"],
      ...mockProtocolDeps,
    };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_intents") as { invoke: (args: { userId?: string }) => Promise<string> };
    const result = await tool.invoke({ userId: otherUserId });

    // The new branch routes scoped+userId reads through getIntentsInIndexForMember
    // with the bound network. Before the fix this branch sent the read down the
    // global getActiveIntents path with the caller's userId — leaking caller's
    // intents instead of returning the queried member's intents in the network.
    expect(getIntentsInIndexForMemberCall).toMatchObject({ userId: otherUserId, networkId });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.count).toBe(1);
    expect(parsed.data.intents[0]).toMatchObject({ id: "other-1", userId: otherUserId });
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
        throw new Error("Access denied: Not a member of this network");
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
    expect(parsed.error).toMatch(/Invalid network ID/i);
  });
});

describe("create_intent tool (Phase 2 network scope)", () => {
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
    let capturedOptions: { objective?: string; signal?: AbortSignal } | undefined = undefined;
    const scraperWithSpy = {
      scrape: async () => "",
      extractUrlContent: async (url: string, options?: { objective?: string; signal?: AbortSignal }) => {
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
    const observedOptions = capturedOptions as { objective?: string; signal?: AbortSignal } | undefined;
    expect(observedOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(observedOptions?.signal?.aborted).toBe(false);
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

  test("when scope envelope is set and showAll not true, returns only current network membership with scopeNote", async () => {
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
    expect(parsed.data.stats.scopeNote).toContain("Showing current network");
  });

  test("when scope envelope is set, showAll parameter is ignored (strict scope enforcement)", async () => {
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
    // Only returns scoped network, not all 2 memberships - strict scope enforcement
    expect(parsed.data.memberOf).toHaveLength(1);
    expect(parsed.data.memberOf[0].networkId).toBe(scopedIndexId);
    expect(parsed.data.stats.scopeNote).toContain("Showing current network");
  });

});

describe("update_intent and delete_intent (Phase 3 index-scoping)", () => {
  const networkId = "a1b2c3d4-0000-4000-8000-000000000020";
  const intentInIndex = { id: "c2505011-2e45-426e-81dd-b9abb9b72001", payload: "In scope", summary: "X", createdAt: new Date() };
  const intentNotInIndex = "c2505011-2e45-426e-81dd-b9abb9b72099"; // Valid UUID but not in index

  test("update_intent when scope envelope set and intent not in index returns success false and error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getIntent: async () => ({ id: intentNotInIndex, userId: testUserId, payload: "Out of scope", summary: null, archivedAt: null } as never),
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_intent") as { invoke: (args: { intentId: string; description: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex, description: "Updated" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/fail|update/i);
  });

  test("delete_intent when scope envelope set and intent not in index returns success false and error", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getIntent: async () => ({ id: intentNotInIndex, userId: testUserId, payload: "Out of scope", summary: null, archivedAt: null } as never),
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentNotInIndex });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toBeDefined();
    expect(parsed.error).toMatch(/fail|delete|archived/i);
  });

  test("update_intent when scope envelope set and intent in index returns success and data shape", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getIntent: async (intentId: string) => ({ id: intentId, userId: testUserId, payload: intentInIndex.payload, summary: intentInIndex.summary, archivedAt: null } as never),
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

  test("delete_intent when scope envelope set and intent in index returns success and data shape", async () => {
    const mockDb = createMockDatabase(async (uid, idx) => {
      if (uid === testUserId && idx === networkId) return [intentInIndex];
      return [];
    }, {
      isNetworkMember: async () => true,
      getIntent: async (intentId: string) => ({ id: intentId, userId: testUserId, payload: intentInIndex.payload, summary: intentInIndex.summary, archivedAt: null } as never),
      getNetworkIdsForIntent: async (intentId: string) => (intentId === intentInIndex.id ? [networkId] : []),
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, networkId, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "delete_intent") as { invoke: (args: { intentId: string }) => Promise<string> };
    const result = await tool.invoke({ intentId: intentInIndex.id });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
    expect(parsed.data.message).toBe("Intent archived successfully.");
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
    const stampSpy = mock(async () => ({ ...latentOpportunity, status: "pending" as const }));
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => latentOpportunity,
      stampOpportunityActorAction: stampSpy,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.opportunityId).toBe(opportunityId);
    expect(parsed.data.status).toBe("pending");
    expect(stampSpy).toHaveBeenCalledWith(opportunityId, testUserId, "pending");
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
    const stampSpy = mock(async () => ({ ...draftOpportunity, status: "pending" as const }));
    const mockDb = createMockDatabase(async () => [], {
      getOpportunity: async () => draftOpportunity,
      stampOpportunityActorAction: stampSpy,
    });
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "update_opportunity") as { invoke: (args: { opportunityId: string; status: string }) => Promise<string> };
    const result = await tool.invoke({ opportunityId, status: "pending" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.opportunityId).toBe(opportunityId);
    expect(parsed.data.status).toBe("pending");
    expect(stampSpy).toHaveBeenCalledWith(opportunityId, testUserId, "pending");
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
    expect(parsed.error).toMatch(/not part of this opportunity|not part|not found|Valid opportunityId/i);
  });
});

describe("read_user_contexts tool (query parameter — name search)", () => {
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

  test("query finds a member by name across all networks", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string }) => Promise<string> };
    const result = await tool.invoke({ query: "Priya" });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.matchCount).toBe(1);
    expect(parsed.data.profiles).toHaveLength(1);
    expect(parsed.data.profiles[0].userId).toBe("user-priya");
    expect(parsed.data.profiles[0].name).toBe("Priya Nair");
    expect(parsed.data.profiles[0].hasProfile).toBe(true);
    expect(parsed.data.profiles[0].bio).toBe("Full-stack engineer and open-source contributor");
  });

  test("query is case-insensitive", async () => {
    const mockDb = createMockDatabase(async () => []);
    const mockSystemDb = createMockSystemDb();
    const context: ToolContext = { userId: testUserId, database: mockDb, embedder: mockEmbedder, scraper: mockScraper, systemDb: mockSystemDb, ...mockProtocolDeps };
    const tools = await createChatTools(context);
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string }) => Promise<string> };
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
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string; networkId?: string }) => Promise<string> };
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
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string }) => Promise<string> };
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
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string }) => Promise<string> };
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
    const tool = tools.find((t: { name: string }) => t.name === "read_user_contexts") as { invoke: (args: { query?: string }) => Promise<string> };
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

  test("returns at most 6 opportunity code blocks when database has 8 opportunities", async () => {
    const fakeOpps = buildFakeOpportunities(8);
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
    const { createOpportunityTools } = await import("../../../opportunities/opportunity.tools.js");
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
      negotiationDatabase: { getNegotiationTaskForOpportunity: async () => null },
      opportunityPresentation: {
        createPresenter: () => ({
          presentCard: async () => ({
            headline: "A relevant connection",
            personalizedSummary: "Their current goals may be relevant to yours.",
            digestSummary: "This connection may be relevant to your current goals.",
            suggestedAction: "Review this connection.",
            narratorRemark: "Worth a look.",
            mutualIntentsLabel: "Shared interests",
            greeting: "",
          }),
        }),
        gatherPresenterContext: async () => ({}),
      },
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

    // Verify the wider fetch budget was passed so selectByComposition can balance buckets.
    expect(capturedLimit).toBe(30);

    // Count actual ```opportunity code blocks (start-of-line or after newline, not mid-sentence mentions)
    const codeBlockCount = (parsed.data.message.match(/(?:^|\n)```opportunity\n/g) || []).length;
    expect(codeBlockCount).toBe(6);
    // Total count reported should also be capped
    expect(parsed.data.count).toBe(6);
  });
});
