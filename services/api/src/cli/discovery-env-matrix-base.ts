#!/usr/bin/env bun
/**
 * Seeds the one protected, fixture-only base for discovery environment matrix
 * evaluations. Matrix child runs must verify this metadata before they run.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../lib/drizzle/drizzle';
import type * as DatabaseSchema from '../schemas/database.schema';

import { BASE_FIXTURE_CORPUS_VERSION, BASE_METADATA_KEY, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, type BaseMetadata, type BaseSeedPayload, type HistoricalMatrixFixture, verifyBaseContract } from './discovery-env-matrix.shared';

const MIGRATIONS_DIRECTORY = path.resolve(import.meta.dir, '../../drizzle');
export const HISTORICAL_MATRIX_CASES_PATH = path.resolve(
  import.meta.dir,
  '../../../../packages/protocol/dist/eval/discovery-env-matrix/historical-matrix.cases.js',
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
export async function seedProtectedBase(
  db: DrizzleDB,
  schema: typeof DatabaseSchema,
  payload: BaseSeedPayload,
  metadata: BaseMetadata,
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
    await tx.insert(schema.evalMatrixMetadata).values({
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

async function createProductionDependencies() {
  const [drizzleModule, schema] = await Promise.all([
    import('../lib/drizzle/drizzle'),
    import('../schemas/database.schema'),
  ]);
  return { db: drizzleModule.default, closeDb: drizzleModule.closeDb, schema };
}

async function main(): Promise<void> {
  const environment = assertBaseEnvironment(process.env);
  console.log(
    `Protected base target: confirmation=${process.env.DISCOVERY_ENV_MATRIX_BASE_CONFIRM} `
      + `testDatabaseSafe=${process.env.TEST_DATABASE_SAFE} host=${environment.databaseUrl.hostname} `
      + `path=${environment.databaseUrl.pathname} declaredBranch=${environment.declaredBranch}`,
  );

  const cases = await loadHistoricalMatrixCases();
  const payload = baseSeedPayload(cases);
  const metadata = await expectedBaseMetadata(cases);
  const { db, closeDb, schema } = await createProductionDependencies();
  try {
    await seedProtectedBase(db, schema, payload, metadata);
    await verifyProtectedBase(db, schema, metadata);
    console.log(
      `Protected base seeded and verified: schema=${metadata.schemaMigrationFingerprint} `
        + `fixture=${metadata.fixtureFingerprint} corpus=${metadata.fixtureCorpusVersion}`,
    );
  } finally {
    await closeDb();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
