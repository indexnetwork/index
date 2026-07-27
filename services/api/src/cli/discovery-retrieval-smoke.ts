#!/usr/bin/env bun
/**
 * Disposable-Neon production-wiring smoke for discovery retrieval.
 *
 * This command is intentionally manual-only. It refuses every target except an
 * explicitly attested disposable Neon branch and removes only marker-scoped
 * records in a finally block.
 */

import type { Embedder, HydeCandidate, HydeSearchOptions, LensEmbedding, OpportunityGraphDatabase, VectorSearchResult, VectorStoreOption } from '@indexnetwork/protocol';

export function assertSmokeEnvironment(env: NodeJS.ProcessEnv): {
  databaseUrl: URL;
  declaredBranch: string;
} {
  if (env.DISCOVERY_RETRIEVAL_EVAL_CONFIRM !== '1') {
    throw new Error('Refusing to mutate: set DISCOVERY_RETRIEVAL_EVAL_CONFIRM=1');
  }
  if (env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('Refusing to mutate: set TEST_DATABASE_SAFE=1 only for a disposable database');
  }

  const databaseUrl = new URL(env.DATABASE_URL ?? '');
  if (!databaseUrl.hostname.endsWith('.neon.tech')) {
    throw new Error(`Refusing non-Neon DATABASE_URL host: ${databaseUrl.hostname}`);
  }

  const declaredBranch = env.DISCOVERY_RETRIEVAL_EVAL_BRANCH ?? '';
  if (!declaredBranch.startsWith('eval-discovery-retrieval-')) {
    throw new Error('Refusing to mutate: DISCOVERY_RETRIEVAL_EVAL_BRANCH must start eval-discovery-retrieval-');
  }

  return { databaseUrl, declaredBranch };
}

export interface SmokeDeps {
  seed(marker: string): Promise<{ sourceUserId: string; candidateUserId: string; networkId: string }>;
  runDiscovery(input: {
    mode: 'premise' | 'user_context';
    sourceUserId: string;
    networkId: string;
  }): Promise<{ candidateUserIds: string[]; contextSearchCalls: number }>;
  cleanup(marker: string): Promise<void>;
  log(line: string): void;
}

export async function runSmoke(env: NodeJS.ProcessEnv, deps: SmokeDeps): Promise<void> {
  const { databaseUrl, declaredBranch } = assertSmokeEnvironment(env);
  const marker = `eval-discovery-retrieval-${crypto.randomUUID()}`;
  deps.log(`Smoke target: host=${databaseUrl.hostname} declaredBranch=${declaredBranch} marker=${marker}`);

  try {
    const seeded = await deps.seed(marker);
    const lightweight = await deps.runDiscovery({
      mode: 'user_context',
      sourceUserId: seeded.sourceUserId,
      networkId: seeded.networkId,
    });
    if (!lightweight.candidateUserIds.includes(seeded.candidateUserId)) {
      throw new Error('Lightweight discovery did not return expected context candidate');
    }
    if (lightweight.contextSearchCalls < 1) {
      throw new Error('Lightweight discovery did not invoke context candidate search');
    }
    deps.log(`Lightweight discovery: expectedCandidate=true contextSearchCalls=${lightweight.contextSearchCalls}`);

    const premise = await deps.runDiscovery({
      mode: 'premise',
      sourceUserId: seeded.sourceUserId,
      networkId: seeded.networkId,
    });
    if (premise.contextSearchCalls !== 0) {
      throw new Error('Premise mode unexpectedly invoked context-to-context search');
    }
    deps.log(`Premise discovery: contextSearchCalls=${premise.contextSearchCalls}`);
  } finally {
    await deps.cleanup(marker);
    deps.log(`Smoke cleanup complete: marker=${marker}`);
  }
}

function smokeIds(marker: string) {
  return {
    networkId: `${marker}-network`,
    sourceUserId: `${marker}-source-user`,
    candidateUserId: `${marker}-candidate-user`,
    distractorUserId: `${marker}-distractor-user`,
    sourceIntentId: `${marker}-source-intent`,
    sourcePremiseId: `${marker}-source-premise`,
    candidatePremiseId: `${marker}-candidate-premise`,
    distractorPremiseId: `${marker}-distractor-premise`,
    sourceContextId: `${marker}-source-context`,
    candidateContextId: `${marker}-candidate-context`,
    distractorContextId: `${marker}-distractor-context`,
  };
}

export const SMOKE_CLEANUP_ORDER = [
  'opportunities',
  'intent_networks',
  'premise_networks',
  'user_contexts',
  'premises',
  'intents',
  'network_members',
  'networks',
  'users',
] as const;

function unitVector(index: 0 | 1): number[] {
  const vector = new Array<number>(2000).fill(0);
  vector[index] = 1;
  return vector;
}

/**
 * Provider-free Embedder port implementation for the disposable smoke graph.
 *
 * The smoke seeds vectors directly and verifies the real database-backed
 * context-to-context search, so graph-local embedding and HyDE searches must
 * not introduce provider calls or candidate sources.
 */
export class DeterministicSmokeEmbedder implements Embedder {
  async generate(
    text: string | string[],
    _dimensions?: number,
    _options?: { signal?: AbortSignal },
  ): Promise<number[] | number[][]> {
    const vector = unitVector(0);
    return Array.isArray(text) ? text.map(() => vector) : vector;
  }

  async search<T>(
    _queryVector: number[],
    _collection: string,
    _options?: VectorStoreOption<T>,
  ): Promise<VectorSearchResult<T>[]> {
    return [];
  }

  async searchWithHydeEmbeddings(
    _lensEmbeddings: LensEmbedding[],
    _options: HydeSearchOptions,
  ): Promise<HydeCandidate[]> {
    return [];
  }
}

/** Pure deterministic seed plan used by the provider-free smoke tests. */
export function buildSmokeSeedPlan(marker: string) {
  return {
    ids: smokeIds(marker),
    sourceVector: unitVector(0),
    distractorVector: unitVector(1),
  };
}

/** Runs a graph with its discovery source override restored on every exit path. */
export async function withDiscoveryProfileSource<T>(
  source: 'premise' | 'user_context',
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env.DISCOVERY_PROFILE_SOURCE;
  process.env.DISCOVERY_PROFILE_SOURCE = source;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.DISCOVERY_PROFILE_SOURCE;
    else process.env.DISCOVERY_PROFILE_SOURCE = previous;
  }
}

/**
 * Loads production dependencies only after the mandatory guard has accepted the
 * target. This keeps imported provider-free tests independent of DB setup.
 */
async function createProductionDeps(): Promise<SmokeDeps> {
  const [
    drizzleModule,
    schema,
    adapterModule,
    protocol,
  ] = await Promise.all([
    import('../lib/drizzle/drizzle'),
    import('../schemas/database.schema'),
    import('../adapters/database.adapter'),
    import('@indexnetwork/protocol'),
  ]);
  const { eq, inArray, sql } = await import('drizzle-orm/sql');
  const db = drizzleModule.default;
  const { ChatDatabaseAdapter } = adapterModule;
  const { OpportunityGraphFactory } = protocol;

  return {
    async seed(marker) {
      const { ids, sourceVector, distractorVector } = buildSmokeSeedPlan(marker);
      const now = new Date().toISOString();

      await db.insert(schema.networks).values({
        id: ids.networkId,
        title: `${marker} discovery retrieval smoke`,
        prompt: 'Disposable smoke network for deterministic discovery retrieval verification.',
      });
      await db.insert(schema.users).values([
        {
          id: ids.sourceUserId,
          email: `${marker}-source@smoke.invalid`,
          name: `${marker} source`,
          intro: 'Seeking a collaborator for deterministic retrieval smoke coverage.',
        },
        {
          id: ids.candidateUserId,
          email: `${marker}-candidate@smoke.invalid`,
          name: `${marker} candidate`,
          intro: 'Provides the complementary capability for deterministic retrieval smoke coverage.',
        },
        {
          id: ids.distractorUserId,
          email: `${marker}-distractor@smoke.invalid`,
          name: `${marker} distractor`,
          intro: 'A deliberately unrelated deterministic retrieval smoke distractor.',
        },
      ]);
      await db.insert(schema.networkMembers).values([
        { networkId: ids.networkId, userId: ids.sourceUserId, permissions: ['member'] },
        { networkId: ids.networkId, userId: ids.candidateUserId, permissions: ['member'] },
        { networkId: ids.networkId, userId: ids.distractorUserId, permissions: ['member'] },
      ]);
      await db.insert(schema.intents).values({
        id: ids.sourceIntentId,
        userId: ids.sourceUserId,
        payload: 'Find the complementary collaborator represented by the matching retrieval vector.',
        summary: 'Deterministic discovery retrieval source intent',
        sourceType: 'discovery_form',
        sourceId: ids.sourceUserId,
        embedding: sourceVector,
        status: 'ACTIVE',
      });
      await db.insert(schema.intentNetworks).values({
        intentId: ids.sourceIntentId,
        networkId: ids.networkId,
        relevancyScore: '1',
      });

      await db.insert(schema.premises).values([
        {
          id: ids.sourcePremiseId,
          userId: ids.sourceUserId,
          assertion: { text: 'Source premise for the deterministic matching capability.', tier: 'assertive' },
          provenance: { source: 'explicit', confidence: 1, timestamp: now },
          validity: { volatile: false },
          embedding: sourceVector,
          status: 'ACTIVE',
        },
        {
          id: ids.candidatePremiseId,
          userId: ids.candidateUserId,
          assertion: { text: 'Candidate premise for the deterministic complementary capability.', tier: 'assertive' },
          provenance: { source: 'explicit', confidence: 1, timestamp: now },
          validity: { volatile: false },
          embedding: sourceVector,
          status: 'ACTIVE',
        },
        {
          id: ids.distractorPremiseId,
          userId: ids.distractorUserId,
          assertion: { text: 'Distractor premise with an unrelated retrieval vector.', tier: 'assertive' },
          provenance: { source: 'explicit', confidence: 1, timestamp: now },
          validity: { volatile: false },
          embedding: distractorVector,
          status: 'ACTIVE',
        },
      ]);
      await db.insert(schema.premiseNetworks).values([
        { premiseId: ids.sourcePremiseId, networkId: ids.networkId, relevancyScore: '1' },
        { premiseId: ids.candidatePremiseId, networkId: ids.networkId, relevancyScore: '1' },
        { premiseId: ids.distractorPremiseId, networkId: ids.networkId, relevancyScore: '1' },
      ]);
      await db.insert(schema.userContexts).values([
        {
          id: ids.sourceContextId,
          userId: ids.sourceUserId,
          networkId: ids.networkId,
          text: 'Source context for the deterministic matching capability.',
          embedding: sourceVector,
          premiseHash: marker,
        },
        {
          id: ids.candidateContextId,
          userId: ids.candidateUserId,
          networkId: ids.networkId,
          text: 'Candidate context for the deterministic complementary capability.',
          embedding: sourceVector,
          premiseHash: marker,
        },
        {
          id: ids.distractorContextId,
          userId: ids.distractorUserId,
          networkId: ids.networkId,
          text: 'Distractor context with an unrelated retrieval vector.',
          embedding: distractorVector,
          premiseHash: marker,
        },
      ]);

      return {
        sourceUserId: ids.sourceUserId,
        candidateUserId: ids.candidateUserId,
        networkId: ids.networkId,
      };
    },

    async runDiscovery({ mode, sourceUserId, networkId }) {
      const database = new ChatDatabaseAdapter();
      let contextSearchCalls = 0;
      const searchUserContextsBySimilarity = database.searchUserContextsBySimilarity.bind(database);
      database.searchUserContextsBySimilarity = async (params) => {
        contextSearchCalls += 1;
        return searchUserContextsBySimilarity(params);
      };

      // The real adapter is used for every graph read/search, including the
      // counting context-to-context search. Graph-local embedding, HyDE, and
      // evaluation are deterministic seams so this smoke never calls providers.
      const deterministicHyde = {
        async invoke() {
          return {
            hydeEmbeddings: { 'smoke-source-vector': unitVector(0) },
            lenses: [{ label: 'smoke-source-vector', corpus: 'profiles' as const }],
          };
        },
      };
      const deterministicEvaluator = {
        async invokeEntityBundle(input: {
          discovererId: string;
          entities: Array<{ userId: string; evidenceKey?: string }>;
        }) {
          const candidate = input.entities.find((entity) => entity.userId !== input.discovererId);
          if (!candidate) return [];
          return [{
            score: 100,
            reasoning: 'The candidate has the deterministic complementary capability.',
            actors: [
              { userId: input.discovererId, role: 'patient' as const },
              { userId: candidate.userId, role: 'agent' as const, evidenceKey: candidate.evidenceKey },
            ],
          }];
        },
      };
      const graph = new OpportunityGraphFactory(
        database as unknown as OpportunityGraphDatabase,
        new DeterministicSmokeEmbedder(),
        deterministicHyde,
        deterministicEvaluator,
      ).createGraph();

      const result = await withDiscoveryProfileSource(mode, async () => graph.invoke({
        userId: sourceUserId,
        networkId,
        options: { minScore: 50 },
      } as never)) as {
        error?: string;
        candidates?: Array<{ candidateUserId: string }>;
      };
      if (result.error) throw new Error(`Discovery graph failed: ${result.error}`);
      return {
        candidateUserIds: (result.candidates ?? []).map((candidate) => candidate.candidateUserId),
        contextSearchCalls,
      };
    },

    async cleanup(marker) {
      const { ids } = buildSmokeSeedPlan(marker);
      const userIds = [ids.sourceUserId, ids.candidateUserId, ids.distractorUserId];
      const premiseIds = [ids.sourcePremiseId, ids.candidatePremiseId, ids.distractorPremiseId];

      // Each predicate includes the generated marker or an ID derived from it;
      // this is deliberately not a broad development-database cleanup.
      await db.delete(schema.opportunities)
        .where(sql`${schema.opportunities.actors}::text LIKE ${`%${marker}%`}`);
      await db.delete(schema.intentNetworks).where(eq(schema.intentNetworks.intentId, ids.sourceIntentId));
      await db.delete(schema.premiseNetworks).where(inArray(schema.premiseNetworks.premiseId, premiseIds));
      await db.delete(schema.userContexts).where(inArray(schema.userContexts.id, [
        ids.sourceContextId,
        ids.candidateContextId,
        ids.distractorContextId,
      ]));
      await db.delete(schema.premises).where(inArray(schema.premises.id, premiseIds));
      await db.delete(schema.intents).where(eq(schema.intents.id, ids.sourceIntentId));
      await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.userId, userIds));
      await db.delete(schema.networks).where(eq(schema.networks.id, ids.networkId));
      await db.delete(schema.users).where(inArray(schema.users.id, userIds));
    },

    log(line) {
      console.log(line);
    },
  };
}

async function main(): Promise<void> {
  // Validate before loading the DB module. The same guard is intentionally run
  // again by runSmoke, which prints the attested target before it seeds anything.
  assertSmokeEnvironment(process.env);
  const deps = await createProductionDeps();
  try {
    await runSmoke(process.env, deps);
  } finally {
    // createProductionDeps loads this only after the guard has accepted the target.
    const { closeDb } = await import('../lib/drizzle/drizzle');
    await closeDb();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
