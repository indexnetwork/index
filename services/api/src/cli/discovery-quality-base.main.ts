#!/usr/bin/env bun
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../schemas/database.schema';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { assertReadOnlySession, productionHistoricalQualityBaseDependencies, readVerifiedHistoricalQualityPublishedState, refreshHistoricalQualityBase, verifyHistoricalQualityPublishedState, type HistoricalQualityBaseDependencies, type HistoricalQualityEmbedder, type HistoricalSharedPoolSeedProjection } from './discovery-quality-base';
import { bindHistoricalQualityTls } from './discovery-quality-tls';

export interface HistoricalQualityBaseCommandDependencies {
  createVerifier(): Promise<{
    db: DrizzleDB;
    query(statement: string): Promise<unknown>;
    close(): Promise<void>;
  }>;
  createRefresh(): Promise<{
    db: DrizzleDB;
    embedder: HistoricalQualityEmbedder;
    close(): Promise<void>;
  }>;
  dependencies(): HistoricalQualityBaseDependencies;
  projection: HistoricalSharedPoolSeedProjection;
  log(line: string): void;
  verified?(metadata: {
    version: 1;
    embedding: { provider: string; model: string; dimensions: number; configurationFingerprint: string };
    corpusVersion: string;
  }): void;
}

function parseArgs(args: readonly string[]): { verifyOnly: boolean } {
  const unsupported = args.find((arg) => arg !== '--verify');
  if (unsupported) throw new Error(`Usage: discovery-quality-base [--verify]; unsupported argument ${unsupported}`);
  return { verifyOnly: args.includes('--verify') };
}

/** Runs verify provider-free, or verifies current state before lazily composing refresh. */
export async function runHistoricalQualityBaseCommand(
  args: readonly string[],
  dependencies: HistoricalQualityBaseCommandDependencies,
): Promise<'verified' | 'already-current' | 'refreshed'> {
  const options = parseArgs(args);
  const operations = dependencies.dependencies();
  const verifier = await dependencies.createVerifier();
  if (options.verifyOnly) {
    try {
      await assertReadOnlySession(verifier.query);
      dependencies.log('Historical quality base verifier session read-only: on');
      const attestation = await readVerifiedHistoricalQualityPublishedState(verifier.db, dependencies.projection, operations);
      dependencies.verified?.({
        version: 1,
        embedding: {
          provider: attestation.embedding.provider,
          model: attestation.embedding.model,
          dimensions: attestation.embedding.dimensions,
          configurationFingerprint: attestation.embedding.configurationFingerprint,
        },
        corpusVersion: attestation.corpusVersion,
      });
      return 'verified';
    } finally {
      await verifier.close();
    }
  }

  try {
    await verifyHistoricalQualityPublishedState(verifier.db, dependencies.projection, operations);
    dependencies.log('Historical quality base is already current.');
    return 'already-current';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith('Historical quality base integrity failed:')) throw error;
    // Only classified stale/unpublished integrity failures enter the writable path.
  } finally {
    await verifier.close();
  }

  const refresh = await dependencies.createRefresh();
  try {
    await refreshHistoricalQualityBase(refresh.db, dependencies.projection, refresh.embedder, operations);
    dependencies.log('Historical quality base refreshed and verified.');
    return 'refreshed';
  } finally {
    await refresh.close();
  }
}

async function createDatabaseConnection(): Promise<{
  db: DrizzleDB;
  query(statement: string): Promise<unknown>;
  close(): Promise<void>;
}> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required for historical quality base runtime');
  const { postgresOptions } = bindHistoricalQualityTls(databaseUrl);
  const client = postgres(databaseUrl, { prepare: false, ...postgresOptions });
  const db = drizzle(client, { schema }) as DrizzleDB;
  return {
    db,
    query: async (statement) => client.unsafe(statement),
    close: async () => client.end({ timeout: 5 }),
  };
}

async function createRefreshDependencies() {
  const connection = await createDatabaseConnection();
  try {
    const { EmbedderAdapter } = await import('../adapters/embedder.adapter');
    const adapter = new EmbedderAdapter();
    if (adapter.identity.dimensions !== 2000) throw new Error('Historical quality embedder must resolve exactly 2000 dimensions');
    const embedder: HistoricalQualityEmbedder = {
      identity: { ...adapter.identity, dimensions: 2000 },
      generate: async (texts) => {
        const vectors = await adapter.generate(texts);
        if (!Array.isArray(vectors) || vectors.some((row) => !Array.isArray(row))) {
          throw new Error('Historical quality embedder returned an invalid batch');
        }
        return vectors as number[][];
      },
    };
    return { db: connection.db, embedder, close: connection.close };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

async function loadHistoricalQualityProjection(): Promise<HistoricalSharedPoolSeedProjection> {
  const fixturePath = new URL('../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js', import.meta.url).pathname;
  const fixture = await import(fixturePath) as { HISTORICAL_SHARED_POOL_SEED_PROJECTION: HistoricalSharedPoolSeedProjection };
  return fixture.HISTORICAL_SHARED_POOL_SEED_PROJECTION;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const projection = await loadHistoricalQualityProjection();
  await runHistoricalQualityBaseCommand(args, {
    createVerifier: createDatabaseConnection,
    createRefresh: createRefreshDependencies,
    dependencies: () => productionHistoricalQualityBaseDependencies,
    projection,
    log: console.log,
    verified: (metadata) => { console.log(JSON.stringify(metadata)); },
  });
}
