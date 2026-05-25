import { eq, and, sql, ne, isNull, isNotNull, count } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import {
  intents,
  intentNetworks,
  networks,
  networkMembers,
  userProfiles,
} from '../schemas/database.schema';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '@indexnetwork/protocol';

/** Preflight diagnostics gathered before running discovery. */
export interface DiscoveryPreflight {
  intent: {
    id: string;
    text: string;
    hasEmbedding: boolean;
    isArchived: boolean;
    assignedToIndexes: Array<{ networkId: string; title: string | null }>;
  };
  userNetworks: Array<{ networkId: string; title: string | null }>;
  candidatePool: {
    otherMembersInIndexes: number;
    otherMembersWithProfiles: number;
    otherIntentsInIndexes: number;
  };
}

/** Result of running the opportunity discovery graph for debugging. */
export interface DiscoveryResult {
  discoverySource: string | null;
  resolvedTriggerIntentId: string | null;
  resolvedIntentInIndex: boolean;
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
   * Gather preflight diagnostics for an intent: index assignments, user indexes,
   * and candidate pool counts.
   * @param intentId - The intent to diagnose
   * @param userId - The authenticated user
   * @returns Preflight diagnostics or null if intent not found
   */
  async getDiscoveryPreflight(intentId: string, userId: string): Promise<{
    preflight: DiscoveryPreflight;
    intentPayload: string;
    userIndexIds: string[];
  } | null> {
    const [intent] = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        hasEmbedding: sql<boolean>`${intents.embedding} IS NOT NULL`.as('has_embedding'),
        archivedAt: intents.archivedAt,
      })
      .from(intents)
      .where(and(eq(intents.id, intentId), eq(intents.userId, userId)))
      .limit(1);

    if (!intent) return null;

    const intentIndexRows = await db
      .select({ networkId: intentNetworks.networkId, title: networks.title })
      .from(intentNetworks)
      .innerJoin(networks, eq(intentNetworks.networkId, networks.id))
      .where(and(eq(intentNetworks.intentId, intentId), isNull(networks.deletedAt)));

    const userIndexRows = await db
      .select({ networkId: networkMembers.networkId, title: networks.title })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(and(eq(networkMembers.userId, userId), isNull(networks.deletedAt)));

    const userIndexIds = userIndexRows.map((r) => r.networkId);
    let otherMembersInIndexes = 0;
    let otherMembersWithProfiles = 0;
    let otherIntentsInIndexes = 0;

    if (userIndexIds.length > 0) {
      const [memberCount] = await db
        .select({ count: count().as('count') })
        .from(networkMembers)
        .where(
          and(
            sql`${networkMembers.networkId} IN (${sql.join(userIndexIds.map((id) => sql`${id}`), sql`, `)})`,
            ne(networkMembers.userId, userId),
          ),
        );
      otherMembersInIndexes = memberCount?.count ?? 0;

      const [profileCount] = await db
        .select({ count: count().as('count') })
        .from(userProfiles)
        .innerJoin(networkMembers, eq(userProfiles.userId, networkMembers.userId))
        .where(
          and(
            sql`${networkMembers.networkId} IN (${sql.join(userIndexIds.map((id) => sql`${id}`), sql`, `)})`,
            ne(userProfiles.userId, userId),
          ),
        );
      otherMembersWithProfiles = profileCount?.count ?? 0;

      const [intentCount] = await db
        .select({ count: count().as('count') })
        .from(intents)
        .innerJoin(intentNetworks, eq(intents.id, intentNetworks.intentId))
        .where(
          and(
            sql`${intentNetworks.networkId} IN (${sql.join(userIndexIds.map((id) => sql`${id}`), sql`, `)})`,
            ne(intents.userId, userId),
            isNull(intents.archivedAt),
            isNotNull(intents.embedding),
          ),
        );
      otherIntentsInIndexes = intentCount?.count ?? 0;
    }

    return {
      preflight: {
        intent: {
          id: intent.id,
          text: intent.payload?.slice(0, 120),
          hasEmbedding: intent.hasEmbedding,
          isArchived: !!intent.archivedAt,
          assignedToIndexes: intentIndexRows.map((r) => ({ networkId: r.networkId, title: r.title })),
        },
        userNetworks: userIndexRows.map((r) => ({ networkId: r.networkId, title: r.title })),
        candidatePool: {
          otherMembersInIndexes,
          otherMembersWithProfiles,
          otherIntentsInIndexes,
        },
      },
      intentPayload: intent.payload,
      userIndexIds,
    };
  }

  /**
   * Run the opportunity discovery graph for an intent and return the full trace.
   * WARNING: This DOES persist results (creates/reactivates opportunities).
   * @param intentId - The intent to run discovery for
   * @param userId - The authenticated user
   * @param intentPayload - The intent's text payload (from preflight)
   * @returns Discovery result with candidates, evaluations, and created opportunities
   */
  async runDiscoveryGraph(intentId: string, userId: string, intentPayload: string): Promise<DiscoveryResult> {
    const database = new ChatDatabaseAdapter();
    const graphDb = database as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
    const embedder = new EmbedderAdapter();
    const cache = new RedisCacheAdapter();
    const inferrer = new LensInferrer();
    const generator = new HydeGenerator();
    const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();
    const opportunityGraph = new OpportunityGraphFactory(graphDb, embedder, hydeGraph).createGraph();

    const result = await opportunityGraph.invoke({
      userId,
      searchQuery: intentPayload,
      operationMode: 'create' as const,
      triggerIntentId: intentId,
      options: { initialStatus: 'latent' },
    });

    const trace = Array.isArray(result.trace) ? result.trace : [];
    const candidates = Array.isArray(result.candidates) ? result.candidates : [];
    const evaluatedOpportunities = Array.isArray(result.evaluatedOpportunities) ? result.evaluatedOpportunities : [];
    const createdOpportunities = Array.isArray(result.opportunities) ? result.opportunities : [];

    return {
      discoverySource: result.discoverySource ?? null,
      resolvedTriggerIntentId: result.resolvedTriggerIntentId ?? null,
      resolvedIntentInIndex: result.resolvedIntentInIndex ?? false,
      targetNetworks: result.targetNetworks ?? [],
      candidatesFound: candidates.length,
      candidates: candidates.slice(0, 20).map((c) => ({
        userId: c.candidateUserId,
        intentId: c.candidateIntentId ?? null,
        networkId: c.networkId,
        similarity: typeof c.similarity === 'number' ? Math.round(c.similarity * 1000) / 1000 : null,
        lens: c.lens,
        discoverySource: c.discoverySource,
      })),
      evaluatedCount: evaluatedOpportunities.length,
      evaluatedOpportunities: evaluatedOpportunities.slice(0, 20).map((e) => ({
        score: e.score,
        reasoning: e.reasoning?.slice(0, 200) ?? null,
        actors: e.actors,
      })),
      opportunitiesCreated: createdOpportunities.length,
      opportunities: createdOpportunities.map((o) => ({
        id: o.id,
        status: o.status,
        actors: o.actors,
      })),
      error: result.error ?? null,
      trace,
    };
  }
}

/** Singleton debug service instance. */
export const debugService = new DebugService();
