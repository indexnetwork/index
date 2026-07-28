#!/usr/bin/env bun
/**
 * Seeds the one protected, fixture-only base for discovery environment matrix
 * evaluations. Matrix child runs must verify this metadata before they run.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { and, eq, inArray } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../lib/drizzle/drizzle';
import type * as DatabaseSchema from '../schemas/database.schema';

import { BASE_FIXTURE_CORPUS_VERSION, BASE_METADATA_KEY, assertBaseEnvironment, baseSeedPayload, computeFixtureFingerprint, type BaseMetadata, type BaseSeedPayload, type HistoricalMatrixFixture, verifyBaseContract } from './discovery-env-matrix.shared';

const MIGRATIONS_DIRECTORY = path.resolve(import.meta.dir, '../../drizzle');
const HISTORICAL_MATRIX_CASES_PATH = path.resolve(
  import.meta.dir,
  '../../../packages/protocol/dist/eval/discovery-env-matrix/historical-matrix.cases.js',
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

/**
 * Deletes and inserts only deterministic IDs derived from the fixture payload.
 * If another row references one of those IDs, the transaction fails closed
 * rather than broadening cleanup to data outside the fixture scope.
 */
export async function seedProtectedBase(
  db: DrizzleDB,
  schema: typeof DatabaseSchema,
  payload: BaseSeedPayload,
  metadata: BaseMetadata,
): Promise<void> {
  const intentIds = payload.intents.map((intent) => intent.id);
  const networkIds = payload.networks.map((network) => network.id);
  const userIds = payload.users.map((user) => user.id);

  await db.transaction(async (tx) => {
    await tx.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, intentIds));
    await tx.delete(schema.intents).where(inArray(schema.intents.id, intentIds));

    for (const membership of payload.memberships) {
      await tx.delete(schema.networkMembers).where(and(
        eq(schema.networkMembers.networkId, membership.networkId),
        eq(schema.networkMembers.userId, membership.userId),
      ));
    }
    await tx.delete(schema.networks).where(inArray(schema.networks.id, networkIds));
    await tx.delete(schema.users).where(inArray(schema.users.id, userIds));

    await tx.insert(schema.users).values(payload.users.map((user) => ({
      ...user,
      emailVerified: false,
    })));
    await tx.insert(schema.networks).values(payload.networks);
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
