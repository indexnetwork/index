import { eq, and, sql, ne, isNull, isNotNull, or, count, inArray } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { intents, intentNetworks, networks, networkMembers, users } from '../schemas/database.schema';

/** Preflight diagnostics gathered before running discovery. */
export interface DiscoveryPreflight {
  intent: {
    id: string;
    text: string;
    hasEmbedding: boolean;
    isArchived: boolean;
    status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';
    assignedToNetworks: Array<{ networkId: string; title: string | null }>;
  };
  userNetworks: Array<{ networkId: string; title: string | null }>;
  candidatePool: {
    otherMembersInNetworks: number;
    otherMembersWithProfiles: number;
    otherIntentsInNetworks: number;
  };
}

/** Result of running the opportunity discovery graph for debugging. */
export interface DiscoveryResult {
  discoverySource: string | null;
  resolvedTriggerIntentId: string | null;
  resolvedIntentInNetwork: boolean;
  targetNetworks: unknown[];
  candidatesFound: number;
  candidates: Array<{
    userId: string;
    intentId: string | null;
    networkId: string;
    similarity: number | null;
    lens: string;
    discoverySource: string | undefined;
  }>;
  evaluatedCount: number;
  evaluatedOpportunities: Array<{
    score: number;
    reasoning: string | null;
    actors: unknown;
  }>;
  opportunitiesCreated: number;
  opportunities: Array<{
    id: string;
    status: string;
    actors: unknown;
  }>;
  error: unknown;
  trace: unknown[];
}

/**
 * Aggregate question-funnel diagnostics (IND-439 visibility audit).
 * Counts and dates only — the shape is enforced at the adapter projection.
 */

/** Raised when the debug runner is asked to discover from an inactive intent. */
export class DebugIntentDiscoveryBlockedError extends Error {
  readonly status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';

  constructor(status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED') {
    super(`Debug discovery requires an active, non-archived intent (current status: ${status})`);
    this.name = 'DebugIntentDiscoveryBlockedError';
    this.status = status;
  }
}

/**
 * Apply production lifecycle admission to debug discovery.
 * @param intent - Intent ownership and lifecycle data.
 * @param userId - Authenticated user requesting discovery.
 * @returns True only for owned, non-archived ACTIVE/legacy-null intents.
 */
export function isDebugDiscoveryIntentActive(
  intent: {
    userId: string;
    status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | null;
    archivedAt: Date | null;
  } | null,
  userId: string,
): boolean {
  return Boolean(
    intent
    && intent.userId === userId
    && !intent.archivedAt
    && (intent.status == null || intent.status === 'ACTIVE'),
  );
}

/** Full discovery debug response. */
export interface DiscoveryDebugResponse {
  exportedAt: string;
  preflight: DiscoveryPreflight;
  result: DiscoveryResult | null;
  diagnosis: string | null;
}

/**
 * Debug service for pipeline diagnostics and discovery tracing.
 *
 * Encapsulates adapter instantiation and graph execution for the debug
 * controller, keeping the controller thin (HTTP only).
 */
export class DebugService {


  /**
   * Gather preflight diagnostics for an intent: network assignments, user networks,
   * and candidate pool counts.
   * @param intentId - The intent to diagnose
   * @param userId - The authenticated user
   * @returns Preflight diagnostics or null if intent not found
   */
  async getDiscoveryPreflight(intentId: string, userId: string): Promise<{
    preflight: DiscoveryPreflight;
    intentPayload: string;
    userNetworkIds: string[];
  } | null> {
    const [intent] = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        hasEmbedding: sql<boolean>`${intents.embedding} IS NOT NULL`.as('has_embedding'),
        archivedAt: intents.archivedAt,
        status: intents.status,
      })
      .from(intents)
      .where(and(eq(intents.id, intentId), eq(intents.userId, userId)))
      .limit(1);

    if (!intent) return null;

    const intentNetworkRows = await db
      .select({ networkId: intentNetworks.networkId, title: networks.title })
      .from(intentNetworks)
      .innerJoin(networks, eq(intentNetworks.networkId, networks.id))
      .where(and(eq(intentNetworks.intentId, intentId), isNull(networks.deletedAt)));

    const userNetworkRows = await db
      .select({ networkId: networkMembers.networkId, title: networks.title })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(and(eq(networkMembers.userId, userId), isNull(networks.deletedAt)));

    const userNetworkIds = userNetworkRows.map((r) => r.networkId);
    let otherMembersInNetworks = 0;
    let otherMembersWithProfiles = 0;
    let otherIntentsInNetworks = 0;

    if (userNetworkIds.length > 0) {
      const [memberCount] = await db
        .select({ count: count().as('count') })
        .from(networkMembers)
        .where(
          and(
            inArray(networkMembers.networkId, userNetworkIds),
            ne(networkMembers.userId, userId),
          ),
        );
      otherMembersInNetworks = memberCount?.count ?? 0;

      // Has a profile: name or intro on the users row.
      const [profileCount] = await db
        .select({ count: count().as('count') })
        .from(users)
        .innerJoin(networkMembers, eq(users.id, networkMembers.userId))
        .where(
          and(
            inArray(networkMembers.networkId, userNetworkIds),
            ne(users.id, userId),
            or(
              sql`trim(${users.intro}) <> ''`,
              sql`trim(${users.name}) <> ''`,
            ),
          ),
        );
      otherMembersWithProfiles = profileCount?.count ?? 0;

      const [intentCount] = await db
        .select({ count: count().as('count') })
        .from(intents)
        .innerJoin(intentNetworks, eq(intents.id, intentNetworks.intentId))
        .where(
          and(
            inArray(intentNetworks.networkId, userNetworkIds),
            ne(intents.userId, userId),
            isNull(intents.archivedAt),
            isNotNull(intents.embedding),
          ),
        );
      otherIntentsInNetworks = intentCount?.count ?? 0;
    }

    return {
      preflight: {
        intent: {
          id: intent.id,
          text: intent.payload?.slice(0, 120),
          hasEmbedding: intent.hasEmbedding,
          isArchived: !!intent.archivedAt,
          status: intent.status ?? 'ACTIVE',
          assignedToNetworks: intentNetworkRows.map((r) => ({ networkId: r.networkId, title: r.title })),
        },
        userNetworks: userNetworkRows.map((r) => ({ networkId: r.networkId, title: r.title })),
        candidatePool: {
          otherMembersInNetworks,
          otherMembersWithProfiles,
          otherIntentsInNetworks,
        },
      },
      intentPayload: intent.payload,
      userNetworkIds,
    };
  }


}

/** Singleton debug service instance. */
export const debugService = new DebugService();
