#!/usr/bin/env bun
/**
 * Seeds the one protected, fixture-only base for discovery environment matrix
 * evaluations. Matrix child runs must verify this metadata before they run.
 *
 * Refresh: bun run eval:discovery-env-matrix-base
 * Verify:  bun run eval:discovery-env-matrix-base:verify
 * --verify performs metadata and fixture-structure reads only; it never creates
 * the embedding/HyDE indexer, refreshes the protected base, or builds protocol.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../lib/drizzle/drizzle';
import type * as DatabaseSchema from '../schemas/database.schema';

import { BASE_FIXTURE_CORPUS_VERSION, BASE_METADATA_KEY, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, type BaseMetadata, type BaseSeedPayload, type HistoricalMatrixFixture, verifyBaseContract } from './discovery-env-matrix.shared';

const MIGRATIONS_DIRECTORY = path.resolve(import.meta.dir, '../../drizzle');
export const HISTORICAL_MATRIX_CASES_PATH = path.resolve(
  import.meta.dir,
  '../../../../packages/protocol/eval/discovery-env-matrix/historical-matrix.cases.ts',
);

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hashes the ordered SQL migration corpus that defines the protected base schema. */
export async function computeSchemaMigrationFingerprint(): Promise<string> {
  const migrationFiles = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const migrationContents = await Promise.all(
    migrationFiles.map(async (file) => `${file}\n${await readFile(path.join(MIGRATIONS_DIRECTORY, file), 'utf8')}`),
  );
  return sha256(migrationContents.join('\n'));
}

async function loadHistoricalMatrixCases(): Promise<readonly HistoricalMatrixFixture[]> {
  const fixtureModule = await import(HISTORICAL_MATRIX_CASES_PATH) as {
    HISTORICAL_MATRIX_CASES: readonly HistoricalMatrixFixture[];
  };
  return fixtureModule.HISTORICAL_MATRIX_CASES;
}

export async function expectedBaseMetadata(
  cases: readonly HistoricalMatrixFixture[],
): Promise<BaseMetadata> {
  return {
    schemaMigrationFingerprint: await computeSchemaMigrationFingerprint(),
    fixtureFingerprint: computeFixtureFingerprint(cases),
    fixtureCorpusVersion: BASE_FIXTURE_CORPUS_VERSION,
  };
}

/** Rejects base-owned rows that would make a refresh non-fixture-scoped. */
async function assertNoUnexpectedBaseDependents(
  tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  schema: typeof DatabaseSchema,
  payload: BaseSeedPayload,
): Promise<void> {
  const userIds = payload.users.map((user) => user.id);
  const networkIds = payload.networks.map((network) => network.id);
  const intentIds = payload.intents.map((intent) => intent.id);
  const checks: Array<{ label: string; query: Promise<Array<{ id: string }>> }> = [
    {
      label: 'user social',
      query: tx.select({ id: schema.userSocials.id }).from(schema.userSocials)
        .where(inArray(schema.userSocials.userId, userIds)).limit(1),
    },
    {
      label: 'premise',
      query: tx.select({ id: schema.premises.id }).from(schema.premises)
        .where(inArray(schema.premises.userId, userIds)).limit(1),
    },
    {
      label: 'user context',
      query: tx.select({ id: schema.userContexts.id }).from(schema.userContexts)
        .where(or(
          inArray(schema.userContexts.userId, userIds),
          inArray(schema.userContexts.networkId, networkIds),
        )).limit(1),
    },
    {
      label: 'premise network',
      query: tx.select({ id: schema.premiseNetworks.premiseId }).from(schema.premiseNetworks)
        .where(inArray(schema.premiseNetworks.networkId, networkIds)).limit(1),
    },
    {
      label: 'unexpected fixture intent',
      query: tx.select({ id: schema.intents.id }).from(schema.intents)
        .where(and(
          inArray(schema.intents.userId, userIds),
          notInArray(schema.intents.id, intentIds),
        )).limit(1),
    },
    {
      label: 'unexpected intent network',
      query: tx.select({ id: schema.intentNetworks.intentId }).from(schema.intentNetworks)
        .where(and(
          inArray(schema.intentNetworks.intentId, intentIds),
          notInArray(schema.intentNetworks.networkId, networkIds),
        )).limit(1),
    },
    {
      label: 'intent proposal',
      query: tx.select({ id: schema.intentProposals.id }).from(schema.intentProposals)
        .where(inArray(schema.intentProposals.consumedIntentId, intentIds)).limit(1),
    },
    {
      label: 'fixture-actor opportunity',
      query: tx.select({ id: schema.opportunities.id }).from(schema.opportunities)
        .where(sql`exists (select 1 from jsonb_array_elements(${schema.opportunities.actors}) actor where actor->>'userId' = any(${sql`array[${sql.join(userIds.map((id) => sql`${id}`), sql`, `)}]::text[]`}))`).limit(1),
    },
    {
      label: 'unexpected fixture membership',
      query: tx.select({ id: schema.networkMembers.userId }).from(schema.networkMembers)
        .where(or(
          and(inArray(schema.networkMembers.networkId, networkIds), notInArray(schema.networkMembers.userId, userIds)),
          and(inArray(schema.networkMembers.userId, userIds), notInArray(schema.networkMembers.networkId, networkIds)),
        )).limit(1),
    },
  ];

  for (const { label, query } of checks) {
    const [dependent] = await query;
    if (dependent) throw new Error(`Refusing protected base refresh: unexpected ${label} ${dependent.id}`);
  }
}

/**
 * Deletes only fixture-owned intent assignments, intents, and membership pairs.
 * Fixture users and networks are upserted so the refresh never invokes their
 * database cascades; unexpected dependents reject before any deletion.
 */
export type FixtureIntentIndexer = (intent: BaseSeedPayload['intents'][number]) => Promise<void>;

/**
 * Seeds deterministic fixture rows, then indexes each intent through the supplied
 * supported service path before durable base metadata is allowed to exist.
 */
export async function seedProtectedBase(
  db: DrizzleDB,
  schema: typeof DatabaseSchema,
  payload: BaseSeedPayload,
  metadata: BaseMetadata,
  indexFixtureIntent: FixtureIntentIndexer,
): Promise<void> {
  const intentIds = payload.intents.map((intent) => intent.id);
  await db.transaction(async (tx) => {
    await assertNoUnexpectedBaseDependents(tx, schema, payload);

    await tx.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, intentIds));
    await tx.delete(schema.intents).where(inArray(schema.intents.id, intentIds));

    for (const membership of payload.memberships) {
      await tx.delete(schema.networkMembers).where(and(
        eq(schema.networkMembers.networkId, membership.networkId),
        eq(schema.networkMembers.userId, membership.userId),
      ));
    }
    await tx.insert(schema.users).values(payload.users.map((user) => ({
      ...user,
      emailVerified: false,
    }))).onConflictDoUpdate({
      target: schema.users.id,
      set: {
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        intro: sql`excluded.intro`,
        location: sql`excluded.location`,
        emailVerified: sql`excluded.email_verified`,
      },
    });
    await tx.insert(schema.networks).values(payload.networks).onConflictDoUpdate({
      target: schema.networks.id,
      set: {
        title: sql`excluded.title`,
        prompt: sql`excluded.prompt`,
      },
    });
    await tx.insert(schema.networkMembers).values(payload.memberships.map((membership) => ({
      ...membership,
      permissions: ['member'],
      autoAssign: false,
    })));
    await tx.insert(schema.intents).values(payload.intents.map((intent) => ({
      id: intent.id,
      userId: intent.userId,
      payload: intent.payload,
      summary: intent.summary,
      sourceType: 'discovery_form' as const,
      sourceId: intent.userId,
      status: 'ACTIVE' as const,
    })));
    await tx.insert(schema.intentNetworks).values(payload.intents.map((intent) => ({
      intentId: intent.id,
      networkId: intent.networkId,
      relevancyScore: '1',
    })));
    // A failed indexing run must leave no verified base metadata for children.
    await tx.delete(schema.evalMatrixMetadata).where(eq(schema.evalMatrixMetadata.key, BASE_METADATA_KEY));
  });

  for (const intent of payload.intents) await indexFixtureIntent(intent);

  const [unembedded] = await db.select({ id: schema.intents.id }).from(schema.intents)
    .where(and(inArray(schema.intents.id, intentIds), isNull(schema.intents.embedding))).limit(1);
  if (unembedded) throw new Error(`Refusing protected base refresh: fixture intent ${unembedded.id} remains unembedded`);

  await db.insert(schema.evalMatrixMetadata).values({
    key: BASE_METADATA_KEY,
    ...metadata,
    seededAt: new Date(),
  }).onConflictDoUpdate({
    target: schema.evalMatrixMetadata.key,
    set: {
      ...metadata,
      seededAt: new Date(),
    },
  });
}

/** Reads and validates the durable base contract before a matrix child run. */
export async function verifyProtectedBase(
  db: DrizzleDB,
  schema: typeof DatabaseSchema,
  expected: BaseMetadata,
): Promise<void> {
  const [metadata] = await db.select({
    schemaMigrationFingerprint: schema.evalMatrixMetadata.schemaMigrationFingerprint,
    fixtureFingerprint: schema.evalMatrixMetadata.fixtureFingerprint,
    fixtureCorpusVersion: schema.evalMatrixMetadata.fixtureCorpusVersion,
  }).from(schema.evalMatrixMetadata).where(inArray(schema.evalMatrixMetadata.key, [BASE_METADATA_KEY])).limit(1);
  verifyBaseContract(metadata ?? null, expected);
}

function assertExactFixtureIds(label: string, expected: readonly string[], actual: readonly string[]): void {
  const actualIds = new Set(actual);
  const missing = expected.find((id) => !actualIds.has(id));
  if (missing) throw new Error(`Discovery environment matrix base integrity failed: missing ${label} ${missing}`);
  if (actualIds.size !== expected.length) {
    throw new Error(`Discovery environment matrix base integrity failed: duplicate ${label} IDs`);
  }
}

function isValidFixtureVector(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.length === 2000
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

/**
 * Provider-free structural check for the exact durable fixture shape. It only
 * reads fixture-scoped IDs and never creates the embedder or Hyde graph.
 */
export async function verifyBaseFixtureIntegrity(
  db: DrizzleDB,
  schema: typeof DatabaseSchema,
  payload: BaseSeedPayload,
): Promise<void> {
  const userIds = payload.users.map((user) => user.id);
  const networkIds = payload.networks.map((network) => network.id);
  const intentIds = payload.intents.map((intent) => intent.id);
  const [users, networks, intents, intentNetworks, memberships, premises, premiseAssignments, contexts, hydeDocuments, opportunities] = await Promise.all([
    db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, intro: schema.users.intro, location: schema.users.location, emailVerified: schema.users.emailVerified, deletedAt: schema.users.deletedAt }).from(schema.users).where(inArray(schema.users.id, userIds)),
    db.select({ id: schema.networks.id, title: schema.networks.title, prompt: schema.networks.prompt, deletedAt: schema.networks.deletedAt }).from(schema.networks).where(inArray(schema.networks.id, networkIds)),
    db.select({ id: schema.intents.id, userId: schema.intents.userId, payload: schema.intents.payload, summary: schema.intents.summary, status: schema.intents.status, sourceType: schema.intents.sourceType, sourceId: schema.intents.sourceId, archivedAt: schema.intents.archivedAt, embedding: schema.intents.embedding }).from(schema.intents)
      .where(inArray(schema.intents.id, intentIds)),
    db.select({ intentId: schema.intentNetworks.intentId, networkId: schema.intentNetworks.networkId, relevancyScore: schema.intentNetworks.relevancyScore })
      .from(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, intentIds)),
    db.select({ userId: schema.networkMembers.userId, networkId: schema.networkMembers.networkId, permissions: schema.networkMembers.permissions, autoAssign: schema.networkMembers.autoAssign })
      .from(schema.networkMembers).where(and(
        inArray(schema.networkMembers.userId, userIds),
        inArray(schema.networkMembers.networkId, networkIds),
      )),
    db.select({ id: schema.premises.id }).from(schema.premises).where(inArray(schema.premises.userId, userIds)),
    db.select({ premiseId: schema.premiseNetworks.premiseId }).from(schema.premiseNetworks).where(inArray(schema.premiseNetworks.networkId, networkIds)),
    db.select({ id: schema.userContexts.id }).from(schema.userContexts).where(or(inArray(schema.userContexts.userId, userIds), inArray(schema.userContexts.networkId, networkIds))),
    db.select({ sourceId: schema.hydeDocuments.sourceId, sourceText: schema.hydeDocuments.sourceText, embedding: schema.hydeDocuments.hydeEmbedding, sourceType: schema.hydeDocuments.sourceType }).from(schema.hydeDocuments).where(inArray(schema.hydeDocuments.sourceId, intentIds)),
    db.select({ id: schema.opportunities.id, actors: schema.opportunities.actors }).from(schema.opportunities),
  ]);

  assertExactFixtureIds('user', userIds, users.map((row) => row.id));
  assertExactFixtureIds('network', networkIds, networks.map((row) => row.id));
  assertExactFixtureIds('intent', intentIds, intents.map((row) => row.id));
  const expectedUsers = new Map(payload.users.map((user) => [user.id, user]));
  for (const user of users) { const expectedUser = expectedUsers.get(user.id); if (!expectedUser || user.email !== expectedUser.email || user.name !== expectedUser.name || user.intro !== expectedUser.intro || user.location !== expectedUser.location || user.emailVerified !== false || user.deletedAt !== null) throw new Error(`Discovery environment matrix base integrity failed: user scalar/lifecycle ${user.id}`); }
  const expectedNetworks = new Map(payload.networks.map((network) => [network.id, network]));
  for (const network of networks) { const expectedNetwork = expectedNetworks.get(network.id); if (!expectedNetwork || network.title !== expectedNetwork.title || network.prompt !== expectedNetwork.prompt || network.deletedAt !== null) throw new Error(`Discovery environment matrix base integrity failed: network scalar/lifecycle ${network.id}`); }
  const expectedIntents = new Map(payload.intents.map((intent) => [intent.id, intent]));
  for (const intent of intents) { const expectedIntent = expectedIntents.get(intent.id); if (!expectedIntent || intent.userId !== expectedIntent.userId || intent.payload !== expectedIntent.payload || intent.summary !== expectedIntent.summary || intent.status !== 'ACTIVE' || intent.sourceType !== 'discovery_form' || intent.sourceId !== expectedIntent.userId || intent.archivedAt !== null) throw new Error(`Discovery environment matrix base integrity failed: intent scalar/lifecycle ${intent.id}`); }
  const malformedIntentVector = intents.find((intent) => !isValidFixtureVector(intent.embedding));
  if (malformedIntentVector) throw new Error(`Discovery environment matrix base integrity failed: intent ${malformedIntentVector.id} has an invalid embedding`);

  if (premises.length || premiseAssignments.length || contexts.length) throw new Error('Discovery environment matrix base integrity failed: unexpected fixture premise or context state');
  if (hydeDocuments.length !== intentIds.length) {
    throw new Error('Discovery environment matrix base integrity failed: unexpected fixture intent HyDE cardinality');
  }
  const expectedIntentPayloads = new Map(payload.intents.map((intent) => [intent.id, intent.payload]));
  const seenHydeIntentIds = new Set<string>();
  for (const document of hydeDocuments) {
    const sourceId = document.sourceId;
    if (typeof sourceId !== 'string') {
      throw new Error('Discovery environment matrix base integrity failed: malformed fixture intent HyDE source ID');
    }
    const expectedPayload = expectedIntentPayloads.get(sourceId);
    if (expectedPayload === undefined || seenHydeIntentIds.has(sourceId)) {
      throw new Error(`Discovery environment matrix base integrity failed: unexpected fixture intent HyDE ${sourceId}`);
    }
    if (document.sourceType !== 'intent' || document.sourceText !== expectedPayload || !isValidFixtureVector(document.embedding)) {
      throw new Error(`Discovery environment matrix base integrity failed: malformed fixture intent HyDE ${sourceId}`);
    }
    seenHydeIntentIds.add(sourceId);
  }
  const missingHydeIntentId = intentIds.find((intentId) => !seenHydeIntentIds.has(intentId));
  if (missingHydeIntentId) throw new Error(`Discovery environment matrix base integrity failed: missing fixture intent HyDE ${missingHydeIntentId}`);
  const fixtureOpportunity = opportunities.find((opportunity) => Array.isArray(opportunity.actors) && opportunity.actors.some((actor) => userIds.includes(String(actor.userId))));
  if (fixtureOpportunity) throw new Error(`Discovery environment matrix base integrity failed: fixture opportunity ${fixtureOpportunity.id}`);

  for (const membership of memberships) if (!Array.isArray(membership.permissions) || membership.permissions.length !== 1 || membership.permissions[0] !== 'member' || membership.autoAssign !== false) throw new Error(`Discovery environment matrix base integrity failed: membership scalar/lifecycle ${membership.userId}:${membership.networkId}`);
  for (const assignment of intentNetworks) if (assignment.relevancyScore !== '1') throw new Error(`Discovery environment matrix base integrity failed: intent-network scalar/lifecycle ${assignment.intentId}:${assignment.networkId}`);
  const expectedIntentNetworks = new Set(payload.intents.map((intent) => `${intent.id}:${intent.networkId}`));
  const actualIntentNetworks = new Set(intentNetworks.map((row) => `${row.intentId}:${row.networkId}`));
  const missingIntentNetwork = [...expectedIntentNetworks].find((key) => !actualIntentNetworks.has(key));
  if (missingIntentNetwork || actualIntentNetworks.size !== expectedIntentNetworks.size) {
    throw new Error(`Discovery environment matrix base integrity failed: intent-network assignment ${missingIntentNetwork ?? 'mismatch'}`);
  }

  const expectedMemberships = new Set(payload.memberships.map((membership) => `${membership.userId}:${membership.networkId}`));
  const actualMemberships = new Set(memberships.map((row) => `${row.userId}:${row.networkId}`));
  const missingMembership = [...expectedMemberships].find((key) => !actualMemberships.has(key));
  if (missingMembership || actualMemberships.size !== expectedMemberships.size) {
    throw new Error(`Discovery environment matrix base integrity failed: membership ${missingMembership ?? 'mismatch'}`);
  }
}

export interface BaseLifecycleDeps {
  verifyCurrent(): Promise<void>;
  createIndexer(): Promise<FixtureIntentIndexer>;
  refresh(indexer: FixtureIntentIndexer): Promise<void>;
  log(line: string): void;
}

/** Runs read-only verification first and lazily constructs providers only for a required refresh. */
export async function runBaseLifecycle(
  options: { verifyOnly: boolean },
  deps: BaseLifecycleDeps,
): Promise<'already-current' | 'refreshed'> {
  try {
    await deps.verifyCurrent();
    deps.log('Protected discovery environment matrix base is already current.');
    return 'already-current';
  } catch (error) {
    if (options.verifyOnly) {
      throw new Error(
        `Protected discovery environment matrix base verification failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  const indexer = await deps.createIndexer();
  await deps.refresh(indexer);
  deps.log('Protected discovery environment matrix base refreshed and verified.');
  return 'refreshed';
}

/**
 * Composes the real embed/persist/HyDE indexer without importing IntentService,
 * whose application-level Questioner dependency is intentionally excluded from
 * protected base setup.
 */
export async function createBaseFixtureIntentIndexer(): Promise<FixtureIntentIndexer> {
  const { createSeedIntentIndexer } = await import('../lib/intent/seed-indexer');
  const indexIntent = createSeedIntentIndexer();
  return async (intent) => indexIntent({
    intentId: intent.id,
    userId: intent.userId,
    description: intent.payload,
  });
}

async function createReadOnlyProductionDependencies() {
  const [drizzleModule, schema] = await Promise.all([
    import('../lib/drizzle/drizzle'),
    import('../schemas/database.schema'),
  ]);
  return { db: drizzleModule.default, closeDb: drizzleModule.closeDb, schema };
}

export function parseBaseArgs(args: readonly string[]): { verifyOnly: boolean } {
  const unsupported = args.filter((arg) => arg !== '--verify');
  if (unsupported.length > 0) {
    throw new Error(`Usage: discovery-env-matrix-base [--verify]; unsupported argument ${unsupported[0]}`);
  }
  return { verifyOnly: args.includes('--verify') };
}

export interface BaseCommandDeps {
  createReadOnly(): Promise<{ db: DrizzleDB; closeDb(): Promise<void>; schema: typeof DatabaseSchema }>;
  loadCases(): Promise<readonly HistoricalMatrixFixture[]>;
  expectedMetadata(cases: readonly HistoricalMatrixFixture[]): Promise<BaseMetadata>;
  createIndexer(): Promise<FixtureIntentIndexer>;
  log(line: string): void;
}

/**
 * Complete command composition used by production and provider-free tests. The
 * initial dependency is DB/schema only; provider composition remains lazy.
 */
export async function runBaseCommand(
  args: readonly string[],
  deps: BaseCommandDeps,
): Promise<'already-current' | 'refreshed'> {
  const options = parseBaseArgs(args);
  const { db, closeDb, schema } = await deps.createReadOnly();
  try {
    const cases = await deps.loadCases();
    const payload = baseSeedPayload(cases);
    const metadata = await deps.expectedMetadata(cases);
    const result = await runBaseLifecycle(options, {
      verifyCurrent: async () => {
        await verifyProtectedBase(db, schema, metadata);
        await verifyBaseFixtureIntegrity(db, schema, payload);
      },
      createIndexer: deps.createIndexer,
      refresh: async (indexFixtureIntent) => {
        await seedProtectedBase(db, schema, payload, metadata, indexFixtureIntent);
        await verifyProtectedBase(db, schema, metadata);
        await verifyBaseFixtureIntegrity(db, schema, payload);
      },
      log: deps.log,
    });
    if (result === 'refreshed') {
      deps.log(
        `Protected base fingerprints: schema=${metadata.schemaMigrationFingerprint} `
          + `fixture=${metadata.fixtureFingerprint} corpus=${metadata.fixtureCorpusVersion}`,
      );
    }
    return result;
  } finally {
    await closeDb();
  }
}

export async function main(): Promise<void> {
  const environment = assertBaseEnvironment(process.env);
  console.log(
    `Protected base target: confirmation=${process.env.DISCOVERY_ENV_MATRIX_BASE_CONFIRM} `
      + `testDatabaseSafe=${process.env.TEST_DATABASE_SAFE} host=${environment.databaseUrl.hostname} `
      + `path=${environment.databaseUrl.pathname} declaredBranch=${environment.declaredBranch}`,
  );

  await runBaseCommand(process.argv.slice(2), {
    createReadOnly: createReadOnlyProductionDependencies,
    loadCases: loadHistoricalMatrixCases,
    expectedMetadata: expectedBaseMetadata,
    createIndexer: createBaseFixtureIntentIndexer,
    log: console.log,
  });
}

