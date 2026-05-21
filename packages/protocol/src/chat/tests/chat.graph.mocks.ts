/**
 * Configurable mock database and fixture data for chat graph workflow tests.
 * Use createChatGraphMockDb(config) to get a full ChatGraphCompositeDatabase
 * with controllable profile, intents, index membership, and opportunities.
 */

import type {
  ChatGraphCompositeDatabase,
  CreateIntentData,
  ActiveIntent,
  IndexedIntentDetails,
  NetworkMembership,
  OwnedIndex,
  UserRecord,
  Opportunity,
  OpportunityStatus,
} from "../../shared/interfaces/database.interface.js";
import type { ChatSessionReader } from "../../shared/interfaces/chat-session.interface.js";
import type { ProtocolDeps } from "../../shared/agent/tool.helpers.js";

// Minimal profile shape for getProfileByUserId (avoids importing ProfileDocument)
export interface MockProfileFixture {
  id: string;
  userId: string;
  identity: { name: string; bio: string; location: string };
  narrative: { context: string };
  attributes: { skills: string[]; interests: string[] };
  embedding: number[] | null;
}

export interface ChatGraphMockConfig {
  /** Profile for the session user (null = no profile). */
  profile?: MockProfileFixture | null;
  /** Active intents per userId (global scope). */
  activeIntents?: (userId: string) => ActiveIntent[] | Promise<ActiveIntent[]>;
  /** Intents in index for a member (userId, networkId) -> member's intents in that index. */
  intentsInIndexForMember?: (
    userId: string,
    networkId: string
  ) => ActiveIntent[] | Promise<ActiveIntent[]>;
  /** All intents in index (owner view). (networkId, requestingUserId) -> details. */
  indexIntentsForOwner?: (
    networkId: string,
    requestingUserId: string
  ) => IndexedIntentDetails[] | Promise<IndexedIntentDetails[]>;
  /** Opportunities for user. */
  opportunitiesForUser?: (userId: string) => Opportunity[] | Promise<Opportunity[]>;
  /** Network memberships for user. */
  networkMemberships?: (userId: string) => NetworkMembership[] | Promise<NetworkMembership[]>;
  /** Index by id (for scope validation). */
  getNetwork?: (networkId: string) => { id: string; title: string } | null | Promise<{ id: string; title: string } | null>;
  /** (networkId, userId) -> is member. */
  isNetworkMember?: (networkId: string, userId: string) => boolean | Promise<boolean>;
  /** (networkId, userId) -> is owner. */
  isIndexOwner?: (networkId: string, userId: string) => boolean | Promise<boolean>;
  /** User record by id. */
  getUser?: (userId: string) => UserRecord | null | Promise<UserRecord | null>;
  /** Owned indexes for user. */
  ownedIndexes?: (userId: string) => OwnedIndex[] | Promise<OwnedIndex[]>;
}

const noop = async (): Promise<undefined> => undefined;
const noopArray = async <T>(): Promise<T[]> => [];
const noopNull = async (): Promise<null> => null;
const noopBool = async (): Promise<boolean> => false;

const defaultOwnedIndex = (): OwnedIndex => ({
  id: "",
  title: "",
  prompt: null,
  imageUrl: null,
  permissions: {
    joinPolicy: "anyone",
    allowGuestVibeCheck: false,
    invitationLink: null,
  },
  isPersonal: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  memberCount: 0,
  intentCount: 0,
  user: { id: "", name: "", avatar: null },
  _count: { members: 0 },
});

/** Actor shape for opportunity mocks (role determines visibility). */
export type MockOpportunityActor = { networkId: string; userId: string; role: "introducer" | "patient" | "agent" | "peer" | "party"; intent?: string };

/** Build a minimal Opportunity for list_opportunities / discover_opportunities tests. */
export function mockOpportunity(overrides: {
  id?: string;
  status?: OpportunityStatus;
  networkId?: string;
  /** Current user (must be one of the actors so they "have" this opportunity). */
  currentUserId?: string;
  /** Other party user ids (role "party"); tool resolves names via getUser. Ignored if actors is provided. */
  otherPartyUserIds?: string[];
  /** Override actors with specific roles for role-based visibility tests. */
  actors?: MockOpportunityActor[];
}): Opportunity {
  const id = overrides.id ?? `opp-${Date.now()}`;
  const networkId = overrides.networkId ?? "idx-1";
  const otherIds = overrides.otherPartyUserIds ?? ["user-alice"];
  const currentUserId = overrides.currentUserId ?? "current-user";
  const actors = overrides.actors ?? [
    { networkId, userId: currentUserId, role: "party" as const },
    ...otherIds.map((userId) => ({ networkId, userId, role: "party" as const })),
  ];
  return {
    id,
    detection: {
      source: "opportunity_graph" as const,
      timestamp: new Date().toISOString(),
    },
    actors,
    interpretation: { category: "connection", reasoning: "Match", confidence: 0.8 },
    context: { networkId },
    confidence: "0.8",
    status: overrides.status ?? "latent",
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  } as Opportunity;
}

/** Build a minimal IndexedIntentDetails for owner view. */
export function mockIndexedIntent(overrides: {
  id?: string;
  payload?: string;
  userId?: string;
  userName?: string;
}): IndexedIntentDetails {
  return {
    id: overrides.id ?? `intent-${Date.now()}`,
    payload: overrides.payload ?? "Looking for a co-founder",
    summary: null,
    userId: overrides.userId ?? "user-1",
    userName: overrides.userName ?? "Alice",
    createdAt: new Date(),
  };
}

/** Build a minimal ActiveIntent. */
export function mockActiveIntent(overrides: { id?: string; payload?: string }): ActiveIntent {
  return {
    id: overrides.id ?? `intent-${Date.now()}`,
    payload: overrides.payload ?? "Looking for a technical co-founder",
    summary: null,
    createdAt: new Date(),
  };
}

/** Build a minimal profile fixture. */
export function mockProfile(overrides: { userId?: string; name?: string }): MockProfileFixture {
  const userId = overrides.userId ?? "user-1";
  return {
    id: `profile-${userId}`,
    userId,
    identity: {
      name: overrides.name ?? "Test User",
      bio: "Test bio",
      location: "NYC",
    },
    narrative: { context: "Test context" },
    attributes: { skills: ["TypeScript"], interests: ["AI"] },
    embedding: null,
  };
}

/**
 * Create a ChatGraphCompositeDatabase mock from config.
 * Any method not overridden by config uses a safe noop/default.
 */
export function createChatGraphMockDb(
  config: ChatGraphMockConfig = {}
): ChatGraphCompositeDatabase {
  const profile = config.profile ?? null;
  const activeIntents = config.activeIntents ?? (() => []);
  const intentsInIndexForMember = config.intentsInIndexForMember ?? (() => []);
  const indexIntentsForOwner = config.indexIntentsForOwner ?? (() => []);
  const opportunitiesForUser = config.opportunitiesForUser ?? (() => []);
  const networkMemberships = config.networkMemberships ?? (() => []);
  const getNetwork = config.getNetwork ?? (() => null);
  const isNetworkMember = config.isNetworkMember ?? (() => false);
  const isIndexOwner = config.isIndexOwner ?? (() => false);
  const getUser =
    config.getUser ??
    ((userId: string): UserRecord => ({ id: userId, name: "Test User", email: "test@example.com", socials: [] }));
  const ownedIndexes = config.ownedIndexes ?? (() => []);

  return {
    getProfile: async () => (profile ? { ...profile } : null),
    getProfileByUserId: async () => (profile ? { ...profile } : null),
    getActiveIntents: async (userId: string) =>
      Promise.resolve(activeIntents(userId)).then((f) => (Array.isArray(f) ? f : [])),
    getIntentsInIndexForMember: async (userId: string, networkId: string) =>
      Promise.resolve(intentsInIndexForMember(userId, networkId)).then((f) =>
        Array.isArray(f) ? f : []
      ),
    getUser: async (userId: string) => Promise.resolve(getUser(userId)),
    updateUser: async (userId: string, data: any) => ({
      id: userId,
      name: data?.name ?? 'Test User',
      email: 'test@example.com',
      socials: data?.socials ?? null,
      location: data?.location ?? null,
    }),
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
    getUserIndexIds: async (userId: string) => {
      const memberships = await Promise.resolve(networkMemberships(userId));
      return Array.isArray(memberships) ? memberships.map((m) => m.networkId) : [];
    },
    getNetworkMemberships: async (userId: string) =>
      Promise.resolve(networkMemberships(userId)).then((f) => (Array.isArray(f) ? f : [])),
    getNetwork: async (networkId: string) => Promise.resolve(getNetwork(networkId)),
    getNetworkMembership: async (networkId: string, userId: string) => {
      const index = await Promise.resolve(getNetwork(networkId));
      if (!index) return null;
      const member = await Promise.resolve(isNetworkMember(networkId, userId));
      return member ? { networkId, networkTitle: index.title, indexPrompt: null, permissions: [] } : null;
    },
    getNetworkWithPermissions: async () => null,
    getIntentForIndexing: noopNull,
    getNetworkMemberContext: noopNull,
    getOpportunitiesForUser: async (userId: string) =>
      Promise.resolve(opportunitiesForUser(userId)).then((f) => (Array.isArray(f) ? f : [])),
    createOpportunity: async () => mockOpportunity({ currentUserId: "system" }) as Opportunity,
    getOpportunity: noopNull,
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    updateOpportunityStatus: noopNull,
    getHydeDocument: noopNull,
    getHydeDocumentsForSource: noopArray,
    saveHydeDocument: noop,
    getIntent: noopNull,
    isIntentAssignedToIndex: noopBool,
    assignIntentToNetwork: noop,
    unassignIntentFromIndex: noop,
    getNetworkIdsForIntent: noopArray,
    getOwnedIndexes: async (userId: string) =>
      Promise.resolve(ownedIndexes(userId)).then((f) => (Array.isArray(f) ? f : [])),
    isIndexOwner: async (networkId: string, userId: string) =>
      Promise.resolve(isIndexOwner(networkId, userId)),
    isNetworkMember: async (networkId: string, userId: string) =>
      Promise.resolve(isNetworkMember(networkId, userId)),
    getNetworkMembersForOwner: noopArray,
    getNetworkMembersForMember: noopArray,
    getMembersFromUserIndexes: async () => [],
    removeMemberFromIndex: async () => ({ success: true }),
    getNetworkIntentsForOwner: async (networkId: string, requestingUserId: string, opts?: { limit?: number; offset?: number }) =>
      Promise.resolve(indexIntentsForOwner(networkId, requestingUserId)).then((f) =>
        Array.isArray(f) ? f : []
      ),
    getNetworkIntentsForMember: async () => [],
    updateIndexSettings: async () => defaultOwnedIndex(),
    softDeleteNetwork: noop,
    deleteProfile: noop,
    createNetwork: async () => defaultOwnedIndex(),
    getNetworkMemberCount: async () => 0,
    addMemberToNetwork: noop,
  } as unknown as ChatGraphCompositeDatabase;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK CHAT SESSION READER & PROTOCOL DEPS
// ═══════════════════════════════════════════════════════════════════════════════

/** Mock ChatSessionReader with stub implementations for graph tests. */
export const mockChatSessionReader: ChatSessionReader = {
  getSessionMessages: async () => [],
  listSessions: async () => [],
  getSession: async () => null,
};

/**
 * Create a mock ProtocolDeps with stub implementations for all fields.
 * Pass overrides to customise individual deps for specific tests.
 */
export function createMockProtocolDeps(overrides?: Partial<ProtocolDeps>): ProtocolDeps {
  // NOTE: database, embedder, scraper are intentionally omitted.
  // ChatGraphFactory spreads protocolDeps over {database, embedder, scraper, ...},
  // so including stubs here would overwrite the real mocks passed to the constructor.
  return {
    cache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false, mget: async () => [], deleteByPattern: async () => 0 },
    hydeCache: { get: async () => null, set: async () => {}, delete: async () => false, exists: async () => false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    integration: { createSession: async () => ({ toolkits: async () => ({ items: [] }), authorize: async () => ({ redirectUrl: "" }) }), executeToolAction: async () => ({ successful: true }), listConnections: async () => [], getAuthUrl: async () => ({ redirectUrl: "" }), disconnect: async () => ({ success: true }) } as unknown as ProtocolDeps["integration"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    intentQueue: { addGenerateHydeJob: async () => ({}), addDeleteHydeJob: async () => ({}) } as any,
    contactService: { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0, details: [] }), listContacts: async () => [], addContact: async () => ({ userId: "", isNew: false, isGhost: false }), removeContact: async () => {} } as unknown as ProtocolDeps["contactService"],
    chatSession: mockChatSessionReader,
    enricher: { enrichUserProfile: async () => null } as unknown as ProtocolDeps["enricher"],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    negotiationDatabase: {} as any,
    integrationImporter: { importContacts: async () => ({ imported: 0, skipped: 0, newContacts: 0, existingContacts: 0 }) },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createUserDatabase: (db: any, _userId: string) => {
      return new Proxy({}, {
        get: (_target, prop) => db[prop] ?? (async () => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createSystemDatabase: (db: any, _userId: string, _scope: string[]) => {
      return new Proxy({}, {
        get: (_target, prop) => db[prop] ?? (async () => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    },
    ...overrides,
  } as ProtocolDeps;
}
