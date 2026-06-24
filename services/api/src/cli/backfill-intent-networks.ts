#!/usr/bin/env node
/**
 * Backfill CLI: assignment-only reconciliation of intents → networks.
 *
 * Finds active intents that have ZERO intent_networks rows (orphans) and runs
 * the SAME network-assignment policy the HyDE queue uses
 * (`buildNetworkAssignmentDecision`), writing intent_networks rows for matches.
 *
 * It deliberately does NOT regenerate HyDE documents and does NOT enqueue
 * opportunity discovery — so it heals registration without spamming users with
 * new opportunity notifications on old intents.
 *
 * Idempotent: assignIntentToNetwork upserts on (intentId, networkId); once an
 * intent gains at least one row it drops out of the orphan set.
 *
 * Usage:
 *   bun run maintenance:backfill-intent-networks -- [--user <userId>] [--network <networkId>] [--dry-run]
 *
 *   --user <id>      Restrict to one user's orphaned intents (e.g. Timour).
 *   --network <id>   Evaluate ONLY this network (scoped). Default: all the
 *                    user's assignment-eligible memberships (global scope).
 *   --dry-run        Score and report what WOULD be assigned; write nothing.
 *   --limit <n>      Max orphaned intents to process (default 500).
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, isNull, sql } from 'drizzle-orm/sql';

import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { IntentIndexer, buildNetworkAssignmentDecision, resolveAssignmentNetworkScope } from '@indexnetwork/protocol';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';

interface Args { userId?: string; networkId?: string; dryRun: boolean; limit: number }

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const valueOf = (flag: string): string | undefined => {
    const a = args.find((x) => x === flag || x.startsWith(`${flag}=`));
    if (!a) return undefined;
    const eq = a.indexOf('=');
    if (eq !== -1) return a.slice(eq + 1);
    const next = args[args.indexOf(a) + 1];
    return next && !next.startsWith('--') ? next : undefined;
  };
  return {
    userId: valueOf('--user'),
    networkId: valueOf('--network'),
    dryRun: args.includes('--dry-run'),
    limit: Number(valueOf('--limit') ?? 500),
  };
}

/** Active intents with no intent_networks row, optionally scoped to one user. */
async function findOrphanedIntents(userId: string | undefined, limit: number) {
  const rows = await db
    .select({ id: schema.intents.id, userId: schema.intents.userId, payload: schema.intents.payload })
    .from(schema.intents)
    .leftJoin(schema.intentNetworks, sql`${schema.intentNetworks.intentId} = ${schema.intents.id}`)
    .where(
      and(
        isNull(schema.intents.archivedAt),
        isNull(schema.intentNetworks.intentId),
        userId ? sql`${schema.intents.userId} = ${userId}` : sql`true`,
      ),
    )
    .limit(limit);
  return rows;
}

async function main(): Promise<void> {
  const { userId, networkId, dryRun, limit } = parseArgs();
  const adapter = new ChatDatabaseAdapter();
  const indexer = new IntentIndexer();

  console.log(
    `Backfill intent→networks` +
    `${userId ? ` user=${userId}` : ' (all users)'}` +
    `${networkId ? ` network=${networkId} (scoped)` : ' (global memberships)'}` +
    `${dryRun ? ' — DRY RUN' : ''}`,
  );

  const orphans = await findOrphanedIntents(userId, limit);
  console.log(`Found ${orphans.length} orphaned active intent(s)\n`);
  if (orphans.length === 0) return;

  let assignedRows = 0;
  let stillOrphan = 0;

  for (const intent of orphans) {
    const memberships = await adapter.getAssignmentNetworkIdsForUser(intent.userId);
    const candidateIds = resolveAssignmentNetworkScope({ memberships, networkScopeId: networkId });
    const preview = intent.payload.length > 50 ? intent.payload.slice(0, 47) + '...' : intent.payload;

    if (candidateIds.length === 0) {
      stillOrphan++;
      console.log(`• ${intent.id}  "${preview}"\n    → no eligible networks (scope=${networkId ?? 'global'})`);
      continue;
    }

    const assignedTo: string[] = [];
    for (const nid of candidateIds) {
      const ctx = await adapter.getNetworkAssignmentContext(nid, intent.userId);
      if (!ctx) continue;
      const indexPrompt = ctx.indexPrompt ?? null;
      const memberPrompt = ctx.memberPrompt ?? null;
      const hasPrompts = !!indexPrompt?.trim() || !!memberPrompt?.trim();

      let raw: { indexScore: number; memberScore: number } | undefined;
      if (hasPrompts) {
        const r = await indexer.invoke(intent.payload, indexPrompt, memberPrompt, null);
        if (r) raw = { indexScore: r.indexScore, memberScore: r.memberScore };
      }

      const decision = buildNetworkAssignmentDecision({
        resourceType: 'intent',
        mode: 'automatic',
        scope: networkId ? 'network' : 'global',
        indexPrompt,
        memberPrompt,
        rawScores: raw,
        evaluator: 'intent-indexer',
        source: 'backfill-intent-networks',
        createdAt: new Date().toISOString(),
      });

      if (!decision.assigned) continue;
      assignedTo.push(`${nid}@${decision.finalScore.toFixed(2)}`);
      if (!dryRun) {
        await adapter.assignIntentToNetwork(intent.id, nid, decision.finalScore, decision.metadata);
        assignedRows++;
      } else {
        assignedRows++;
      }
    }

    if (assignedTo.length === 0) {
      stillOrphan++;
      console.log(`• ${intent.id}  "${preview}"\n    → matched NO network (would remain orphaned)`);
    } else {
      console.log(`• ${intent.id}  "${preview}"\n    → ${dryRun ? 'would assign' : 'assigned'}: ${assignedTo.join(', ')}`);
    }
  }

  console.log(
    `\nDone: ${assignedRows} ${dryRun ? 'would-be ' : ''}row(s) across ${orphans.length} intent(s); ` +
    `${stillOrphan} intent(s) still unmatched.`,
  );
}

main()
  .then(async () => { await closeDb(); })
  .catch(async (e: unknown) => {
    console.error('backfill-intent-networks error:', e instanceof Error ? e.message : `${e}`);
    await closeDb().catch(() => {});
    process.exit(1);
  });
