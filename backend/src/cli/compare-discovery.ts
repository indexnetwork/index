#!/usr/bin/env node
/**
 * Compare Discovery: profile-embedding vs context-embedding intent search.
 *
 * For each member in a network who has both a profile HyDE embedding and
 * at least one user context embedding, runs the same cosine-similarity
 * intent search using each vector and compares the results side-by-side.
 *
 * Usage:
 *   bun run maintenance:compare-discovery -- --network <networkId> [--limit 20] [--min-score 0.30]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, eq, isNull, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntentHit {
  intentId: string;
  userId: string;
  networkId: string;
  payload: string;
  summary: string | null;
  similarity: number;
}

interface UserComparison {
  userId: string;
  userName: string;
  profileHits: IntentHit[];
  contextHits: IntentHit[];
  overlap: IntentHit[];
  profileOnly: IntentHit[];
  contextOnly: IntentHit[];
  avgProfileSim: number;
  avgContextSim: number;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(): { networkId: string; limit: number; minScore: number } {
  const args = process.argv.slice(2);

  function getArg(name: string): string | undefined {
    const arg = args.find((a) => a.startsWith(`--${name}`));
    if (!arg) return undefined;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) return arg.slice(eqIdx + 1);
    const nextIdx = args.indexOf(arg) + 1;
    return nextIdx < args.length ? args[nextIdx] : undefined;
  }

  const networkId = getArg('network');
  if (!networkId) {
    console.error('Usage: bun run maintenance:compare-discovery -- --network <networkId> [--limit 20] [--min-score 0.30]');
    process.exit(1);
  }

  const limit = parseInt(getArg('limit') ?? '20', 10);
  const minScore = parseFloat(getArg('min-score') ?? '0.30');

  return { networkId, limit, minScore };
}

// ---------------------------------------------------------------------------
// Intent search (shared query, different input embedding)
// ---------------------------------------------------------------------------

async function searchIntentsByEmbedding(
  embedding: number[],
  networkId: string,
  excludeUserId: string,
  limit: number,
  minScore: number,
): Promise<IntentHit[]> {
  const vectorStr = `[${embedding.join(',')}]`;

  const rows = await db.execute(sql`
    SELECT
      i.id AS "intentId",
      i.user_id AS "userId",
      ine.network_id AS "networkId",
      i.payload,
      i.summary,
      1 - (i.embedding <=> ${vectorStr}::vector) AS similarity
    FROM ${schema.intents} i
    JOIN ${schema.intentNetworks} ine ON i.id = ine.intent_id
    JOIN ${schema.users} u ON i.user_id = u.id
    WHERE ine.network_id = ${networkId}
      AND i.user_id != ${excludeUserId}
      AND i.status = 'ACTIVE'
      AND i.embedding IS NOT NULL
      AND u.deleted_at IS NULL
      AND 1 - (i.embedding <=> ${vectorStr}::vector) >= ${minScore}
    ORDER BY i.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return rows as unknown as IntentHit[];
}

// ---------------------------------------------------------------------------
// Data fetchers
// ---------------------------------------------------------------------------

/** Get the first profile HyDE embedding for a user (any strategy). */
async function getProfileEmbedding(userId: string): Promise<number[] | null> {
  const rows = await db
    .select({ hydeEmbedding: schema.hydeDocuments.hydeEmbedding })
    .from(schema.hydeDocuments)
    .where(and(
      eq(schema.hydeDocuments.sourceType, 'profile'),
      eq(schema.hydeDocuments.sourceId, userId),
    ))
    .limit(1);

  if (rows.length === 0 || !rows[0].hydeEmbedding) return null;
  const emb = rows[0].hydeEmbedding;
  return Array.isArray(emb) ? emb as number[] : null;
}

/** Get context embedding for a user in a specific network. */
async function getContextEmbedding(userId: string, networkId: string): Promise<number[] | null> {
  const rows = await db
    .select({ embedding: schema.userContexts.embedding })
    .from(schema.userContexts)
    .where(and(
      eq(schema.userContexts.userId, userId),
      eq(schema.userContexts.networkId, networkId),
    ))
    .limit(1);

  if (rows.length === 0 || !rows[0].embedding) return null;
  const emb = rows[0].embedding;
  return Array.isArray(emb) ? emb as number[] : null;
}

// ---------------------------------------------------------------------------
// Comparison logic
// ---------------------------------------------------------------------------

function compareResults(profileHits: IntentHit[], contextHits: IntentHit[]): {
  overlap: IntentHit[];
  profileOnly: IntentHit[];
  contextOnly: IntentHit[];
} {
  const profileSet = new Set(profileHits.map(h => h.intentId));
  const contextSet = new Set(contextHits.map(h => h.intentId));

  const overlap = contextHits.filter(h => profileSet.has(h.intentId));
  const profileOnly = profileHits.filter(h => !contextSet.has(h.intentId));
  const contextOnly = contextHits.filter(h => !profileSet.has(h.intentId));

  return { overlap, profileOnly, contextOnly };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printHeader(networkId: string, networkTitle: string, memberCount: number, eligibleCount: number) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  Discovery Comparison: ${networkTitle}`);
  console.log(`║  Network: ${networkId}`);
  console.log(`║  Members with both embeddings: ${eligibleCount} / ${memberCount}`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('');
}

function printUserComparison(comp: UserComparison) {
  const delta = comp.avgContextSim - comp.avgProfileSim;
  const deltaStr = delta >= 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3);

  console.log(`── ${comp.userName} ──────────────────────────────────────────────────`);
  console.log(`  Profile hits: ${comp.profileHits.length}    Context hits: ${comp.contextHits.length}    Overlap: ${comp.overlap.length}`);
  console.log(`  Context-only: ${comp.contextOnly.length}     Profile-only: ${comp.profileOnly.length}`);
  console.log(`  Avg similarity — Profile: ${comp.avgProfileSim.toFixed(3)}   Context: ${comp.avgContextSim.toFixed(3)} (${deltaStr})`);

  // Show top overlapping intents with similarity comparison
  if (comp.overlap.length > 0) {
    const profileMap = new Map(comp.profileHits.map(h => [h.intentId, h]));
    const sorted = [...comp.overlap]
      .map(ctx => {
        const prof = profileMap.get(ctx.intentId);
        return { ctx, profSim: prof?.similarity ?? 0, delta: ctx.similarity - (prof?.similarity ?? 0) };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    console.log('  Top overlap (by delta):');
    for (const item of sorted.slice(0, 3)) {
      const payload = item.ctx.payload.length > 60 ? item.ctx.payload.slice(0, 57) + '...' : item.ctx.payload;
      const d = item.delta >= 0 ? `+${item.delta.toFixed(3)}` : item.delta.toFixed(3);
      console.log(`    "${payload}" — profile: ${item.profSim.toFixed(3)}, context: ${item.ctx.similarity.toFixed(3)} (${d})`);
    }
  }

  // Show top context-only finds
  if (comp.contextOnly.length > 0) {
    console.log('  Top context-only finds:');
    for (const hit of comp.contextOnly.slice(0, 3)) {
      const payload = hit.payload.length > 60 ? hit.payload.slice(0, 57) + '...' : hit.payload;
      console.log(`    "${payload}" — similarity: ${hit.similarity.toFixed(3)}`);
    }
  }

  console.log('');
}

function printSummary(comparisons: UserComparison[]) {
  const total = comparisons.length;
  const contextBetter = comparisons.filter(c => c.contextHits.length > c.profileHits.length).length;
  const profileBetter = comparisons.filter(c => c.profileHits.length > c.contextHits.length).length;
  const tied = comparisons.filter(c => c.contextHits.length === c.profileHits.length).length;

  const allOverlapCounts = comparisons.map(c => c.overlap.length);
  const allProfileCounts = comparisons.map(c => c.profileHits.length);
  const allContextCounts = comparisons.map(c => c.contextHits.length);

  const jaccards = comparisons.map(c => {
    const union = new Set([
      ...c.profileHits.map(h => h.intentId),
      ...c.contextHits.map(h => h.intentId),
    ]);
    return union.size === 0 ? 1 : c.overlap.length / union.size;
  });

  const simDeltas = comparisons.map(c => c.avgContextSim - c.avgProfileSim);
  const sortedDeltas = [...simDeltas].sort((a, b) => a - b);
  const median = sortedDeltas.length % 2 === 0
    ? (sortedDeltas[sortedDeltas.length / 2 - 1] + sortedDeltas[sortedDeltas.length / 2]) / 2
    : sortedDeltas[Math.floor(sortedDeltas.length / 2)];

  console.log('════════════════════════════════ SUMMARY ═══════════════════════════');
  console.log(`  Users compared:          ${total}`);
  console.log(`  Avg profile hits:        ${avg(allProfileCounts).toFixed(1)}`);
  console.log(`  Avg context hits:        ${avg(allContextCounts).toFixed(1)}`);
  console.log(`  Avg overlap:             ${avg(allOverlapCounts).toFixed(1)}`);
  console.log(`  Avg Jaccard overlap:     ${avg(jaccards).toFixed(3)}`);
  console.log(`  Context found more:      ${contextBetter} users (${((contextBetter / total) * 100).toFixed(0)}%)`);
  console.log(`  Profile found more:      ${profileBetter} users (${((profileBetter / total) * 100).toFixed(0)}%)`);
  console.log(`  Tied:                    ${tied} users (${((tied / total) * 100).toFixed(0)}%)`);
  console.log(`  Mean similarity delta:   ${avg(simDeltas) >= 0 ? '+' : ''}${avg(simDeltas).toFixed(4)} (context − profile)`);
  console.log(`  Median similarity delta: ${median >= 0 ? '+' : ''}${median.toFixed(4)}`);
  console.log('═══════════════════════════════════════════════════════════════════');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { networkId, limit, minScore } = parseArgs();
  console.log(`Comparing discovery strategies for network: ${networkId}`);
  console.log(`  limit=${limit}, minScore=${minScore}`);

  // Get network title
  const networkRow = await db
    .select({ title: schema.networks.title })
    .from(schema.networks)
    .where(eq(schema.networks.id, networkId))
    .limit(1);

  if (networkRow.length === 0) {
    console.error(`Network not found: ${networkId}`);
    process.exit(1);
  }
  const networkTitle = networkRow[0].title;

  // Get all active members of the network
  const members = await db
    .select({
      userId: schema.networkMembers.userId,
      userName: schema.users.name,
    })
    .from(schema.networkMembers)
    .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
    .where(and(
      eq(schema.networkMembers.networkId, networkId),
      isNull(schema.networkMembers.deletedAt),
      isNull(schema.users.deletedAt),
    ));

  console.log(`Found ${members.length} members in network`);

  // Process each member
  const comparisons: UserComparison[] = [];
  let skippedNoProfile = 0;
  let skippedNoContext = 0;

  for (const member of members) {
    const [profileEmb, contextEmb] = await Promise.all([
      getProfileEmbedding(member.userId),
      getContextEmbedding(member.userId, networkId),
    ]);

    if (!profileEmb) { skippedNoProfile++; continue; }
    if (!contextEmb) { skippedNoContext++; continue; }

    const [profileHits, contextHits] = await Promise.all([
      searchIntentsByEmbedding(profileEmb, networkId, member.userId, limit, minScore),
      searchIntentsByEmbedding(contextEmb, networkId, member.userId, limit, minScore),
    ]);

    const { overlap, profileOnly, contextOnly } = compareResults(profileHits, contextHits);

    comparisons.push({
      userId: member.userId,
      userName: member.userName ?? member.userId.slice(0, 8),
      profileHits,
      contextHits,
      overlap,
      profileOnly,
      contextOnly,
      avgProfileSim: avg(profileHits.map(h => h.similarity)),
      avgContextSim: avg(contextHits.map(h => h.similarity)),
    });
  }

  // Output
  printHeader(networkId, networkTitle, members.length, comparisons.length);

  if (skippedNoProfile > 0) console.log(`  Skipped (no profile embedding): ${skippedNoProfile}`);
  if (skippedNoContext > 0) console.log(`  Skipped (no context embedding): ${skippedNoContext}`);
  if (skippedNoProfile > 0 || skippedNoContext > 0) console.log('');

  if (comparisons.length === 0) {
    console.log('No users had both profile and context embeddings. Nothing to compare.');
    return;
  }

  // Sort by largest context advantage
  comparisons.sort((a, b) => {
    const deltaA = a.contextHits.length - a.profileHits.length;
    const deltaB = b.contextHits.length - b.profileHits.length;
    return deltaB - deltaA;
  });

  for (const comp of comparisons) {
    printUserComparison(comp);
  }

  printSummary(comparisons);
}

main()
  .then(async () => {
    await closeDb();
  })
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('compare-discovery error:', msg);
    await closeDb().catch(() => {});
    process.exit(1);
  });
