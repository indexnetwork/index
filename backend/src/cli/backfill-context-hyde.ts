#!/usr/bin/env node
/**
 * Backfill CLI: generate HyDE documents for existing user contexts.
 * Finds all user_contexts rows that have no corresponding hyde_documents
 * with sourceType='context' and generates HyDE embeddings for them.
 *
 * Usage: bun run maintenance:backfill-context-hyde -- --network <networkId> [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase } from '@indexnetwork/protocol';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { networkId: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network'));
  const dryRun = args.includes('--dry-run');

  let networkId = '';
  if (networkArg) {
    const eqIdx = networkArg.indexOf('=');
    if (eqIdx !== -1) {
      networkId = networkArg.slice(eqIdx + 1);
    } else {
      const nextIdx = args.indexOf(networkArg) + 1;
      if (nextIdx < args.length) networkId = args[nextIdx];
    }
  }

  if (!networkId) {
    console.error('Usage: bun run maintenance:backfill-context-hyde -- --network <networkId> [--dry-run]');
    process.exit(1);
  }

  return { networkId, dryRun };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { networkId, dryRun } = parseArgs();
  console.log(`Backfilling context HyDE for network: ${networkId}${dryRun ? ' (dry run)' : ''}`);

  // Find all contexts in this network
  const contexts = await db
    .select({
      id: schema.userContexts.id,
      userId: schema.userContexts.userId,
      text: schema.userContexts.text,
    })
    .from(schema.userContexts)
    .where(eq(schema.userContexts.networkId, networkId));

  console.log(`Found ${contexts.length} contexts in network`);

  if (contexts.length === 0) {
    console.log('No contexts to process.');
    return;
  }

  // Filter to those without HyDE docs
  const needsHyde: typeof contexts = [];
  for (const ctx of contexts) {
    const existing = await db
      .select({ id: schema.hydeDocuments.id })
      .from(schema.hydeDocuments)
      .where(and(
        eq(schema.hydeDocuments.sourceType, 'context'),
        eq(schema.hydeDocuments.sourceId, ctx.id),
      ))
      .limit(1);

    if (existing.length === 0) {
      needsHyde.push(ctx);
    }
  }

  console.log(`Contexts needing HyDE: ${needsHyde.length} / ${contexts.length}`);

  if (needsHyde.length === 0) {
    console.log('All contexts already have HyDE documents.');
    return;
  }

  if (dryRun) {
    console.log('Dry run — no HyDE docs generated');
    for (const ctx of needsHyde) {
      const textPreview = ctx.text && ctx.text.length > 60 ? ctx.text.slice(0, 57) + '...' : ctx.text;
      console.log(`  Would generate HyDE for: ${ctx.userId} — "${textPreview}"`);
    }
    return;
  }

  // Generate HyDE for each context
  const chatDb = new ChatDatabaseAdapter();
  const graphDb = chatDb as unknown as HydeGraphDatabase;
  let success = 0;
  let failed = 0;

  for (const ctx of needsHyde) {
    try {
      const embedder = new EmbedderAdapter();
      const cache = new RedisCacheAdapter();
      const inferrer = new LensInferrer();
      const generator = new HydeGenerator();
      const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();

      await hydeGraph.invoke({
        sourceType: 'context' as const,
        sourceId: ctx.id,
        sourceText: ctx.text ?? '',
        forceRegenerate: false,
        maxLenses: 3,
      });

      success++;
      const textPreview = ctx.text && ctx.text.length > 60 ? ctx.text.slice(0, 57) + '...' : ctx.text;
      console.log(`  ✓ ${ctx.userId} — "${textPreview}"`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : `${err}`;
      console.error(`  ✗ ${ctx.userId} — ${msg}`);
    }
  }

  console.log(`\nDone: ${success} generated, ${failed} failed`);
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('backfill-context-hyde error:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
