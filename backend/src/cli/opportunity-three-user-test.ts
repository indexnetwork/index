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
 * 2. Ensure minimal user_profiles for each (so evaluator has profile data).
 * 3. Create one intent for User A and assign to index.
 * 4. Run HyDE for that intent (lens-inferred strategies).
 * 5. Add a profile HyDE for User B with the first inferred lens embedding so discovery finds B.
 * 6. Run opportunity discovery (creates latent opportunities).
 * 7. Print opportunities per user.
 */
import dotenv from 'dotenv';
import path from 'path';
import { eq, inArray } from 'drizzle-orm';

dotenv.config({ path: path.resolve(process.cwd(), '.env.development') });

import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase, OpportunityGraphDatabase, Embedder, HydeCache } from '@indexnetwork/protocol';
import { fromIntentQueue } from '../queues/opportunity/from-intent.queue';

import { TESTER_PERSONAS } from './test-data';

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c'; // Commons from seed
const DIMENSIONS = 2000;

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

  // Ensure minimal profiles (evaluator needs profile for entity bundle)
  for (const u of userRows.slice(0, 3)) {
    const [existing] = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, u.id)).limit(1);
    if (!existing) {
      await db.insert(schema.userProfiles).values({
        userId: u.id,
        identity: { name: u.name ?? 'Test', bio: '', location: '' },
        narrative: { context: '' },
        attributes: { interests: [], skills: [] },
      });
      console.log('  Created minimal profile for', u.name);
    }
  }

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

  // Run HyDE for the intent (no queue; direct invoke)
  const embedder: Embedder = new EmbedderAdapter();
  const cache: HydeCache = new RedisCacheAdapter();
  const inferrer = new LensInferrer();
  const generator = new HydeGenerator();
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();
  const hydeResult = await hydeGraph.invoke({
    sourceText: intentPayload,
    sourceType: 'intent',
    sourceId: created.id,
    forceRegenerate: true,
  });
  console.log('HyDE generated for intent');

  // So discovery can find User B: add profile HyDE for B using the first inferred lens embedding
  const hydeEmbeddings = hydeResult.hydeEmbeddings ?? {};
  const firstLensLabel = Object.keys(hydeEmbeddings)[0];
  const firstEmbedding = firstLensLabel ? hydeEmbeddings[firstLensLabel] : undefined;
  if (firstEmbedding?.length === DIMENSIONS) {
    await database.saveHydeDocument({
      sourceType: 'profile',
      sourceId: userB.id,
      strategy: firstLensLabel,
      targetCorpus: 'profiles',
      hydeText: `${userB.name} – developer, React, startup.`,
      hydeEmbedding: firstEmbedding,
    });
    console.log('Profile HyDE for', userB.name, '(lens:', firstLensLabel, ') so discovery can match');
  }

  // Run opportunity discovery (synchronous)
  await fromIntentQueue.processJob('discover_opportunities', {
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
