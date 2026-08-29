#!/usr/bin/env bun
/**
 * Minimal three-user opportunity test.
 *
 * Prerequisites:
 * - DATABASE_URL and OPENROUTER_API_KEY in .env.development
 * - Redis running (optional; script runs HyDE and discovery synchronously)
 * - Run once: bun run db:seed --confirm (creates 3 users + indexes + memberships)
 *
 * Flow:
 * 1. Load 3 users by seed emails and one index.
 * 2. Create one intent for User A and assign to index.
 * 3. Run HyDE for that intent (lens-inferred strategies).
 * 4. Add a profile HyDE for User B with the first inferred lens embedding so discovery finds B.
 * 5. Run opportunity discovery (creates latent opportunities).
 * 6. Print opportunities per user.
 */
import dotenv from 'dotenv';
import path from 'path';
import { inArray } from 'drizzle-orm/sql';

dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', '.env.development') });

import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, OpportunityGraphDatabase, Embedder, HydeCache } from '@indexnetwork/protocol';
import { runDiscovery } from '../lib/opportunity/discovery';

import { TESTER_PERSONAS } from './test-data';

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c'; // Commons from seed

async function main() {
  console.log('=== Three-user opportunity test ===\n');

  const emails = TESTER_PERSONAS.slice(0, 3).map((a) => a.email);
  const userRows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.email, emails));
  if (userRows.length < 3) {
    console.error('Need 3 users. Run: bun run db:seed --confirm');
    process.exit(1);
  }
  const [userA, userB, userC] = userRows.slice(0, 3);
  console.log('Users:', userA.name, userA.id, '|', userB.name, userB.id, '|', userC.name, userC.id);

  const database = new ChatDatabaseAdapter();
  const graphDb = database as unknown as HydeGraphDatabase & OpportunityGraphDatabase;

  // Create intent for User A and assign to index
  const intentPayload = 'Looking for a technical co-founder with React experience';
  const [created] = await db
    .insert(schema.intents)
    .values({
      userId: userA.id,
      payload: intentPayload,
      summary: 'Co-founder',
      sourceType: 'discovery_form',
      sourceId: userA.id,
    })
    .returning({ id: schema.intents.id });
  if (!created) {
    console.error('Failed to create intent');
    process.exit(1);
  }
  await database.assignIntentToNetwork(created.id, INDEX_ID);
  console.log('Created intent for', userA.name, ':', created.id, '->', intentPayload);

  // Run HyDE for the intent (direct invoke)
  const embedder: Embedder = new EmbedderAdapter();
  const cache: HydeCache = new RedisCacheAdapter();
  const inferrer = new LensInferrer();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();
  await hydeGraph.invoke({
    sourceText: intentPayload,
    sourceType: 'intent',
    sourceId: created.id,
    forceRegenerate: true,
  });
  console.log('HyDE generated for intent');

  // Run opportunity discovery (synchronous)
  await runDiscovery({
    intentId: created.id,
    userId: userA.id,
  });
  console.log('Discovery run complete\n');

  // List opportunities per user
  const adapter = new ChatDatabaseAdapter();
  for (const u of [userA, userB, userC]) {
    const list = await adapter.getOpportunitiesForUser(u.id, { limit: 20 });
    console.log(`${u.name} (${u.id}): ${list.length} opportunity(ies)`);
    list.forEach((opp) => {
      const actorIds = opp.actors?.map((a) => a.userId).join(', ') ?? '';
      console.log(`  - ${opp.id} status=${opp.status} actors=[${actorIds}] reasoning=${(opp.interpretation?.reasoning ?? '').slice(0, 60)}...`);
    });
  }

  console.log('\n=== Done ===');
}

main()
  .then(() => closeDb())
  .catch((e) => {
    console.error(e);
    closeDb();
    process.exit(1);
  });
