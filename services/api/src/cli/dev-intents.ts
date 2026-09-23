#!/usr/bin/env bun
import { setTimeout as sleep } from 'node:timers/promises';
import postgres from 'postgres';

import type { IntentTransitionOutcome } from '../services/intent.service';

// Separate locks serialize resets and prevent reset/replay overlap.
export const RESET_LOCK = 741_901;
export const REPLAY_LOCK = 741_902;

/** Validate a configured Postgres connection without changing its target or options. */
export function databaseUrl(value: string | undefined): string {
  if (!value) throw new Error('DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('DATABASE_URL is not a valid URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL is not a Postgres URL.');
  }
  return value;
}

/** A dedicated connection holds transaction-scoped coordination locks. */
export function openControl(value: string | undefined, onclose: () => void) {
  return postgres(databaseUrl(value), {
    max: 1, prepare: false, idle_timeout: 0, max_lifetime: 0, connect_timeout: 10, onclose,
  });
}

/** Fail rather than overlap another operation holding this transaction lock. */
export async function acquireLock(sql: postgres.Sql | postgres.TransactionSql, key: number): Promise<void> {
  const [row] = await sql`SELECT pg_try_advisory_xact_lock(${key}) AS acquired`;
  if (!row.acquired) throw new Error(key === RESET_LOCK ? 'A dev reset is already running.' : 'A dev replay is already running.');
}

type Counts = Record<string, number>;

/** Counts checked inside the reset transaction. */
export async function readResetCounts(sql: postgres.Sql | postgres.TransactionSql): Promise<Counts> {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM intents) AS intents,
      (SELECT count(*)::int FROM networks) AS networks,
      (SELECT count(*)::int FROM network_members) AS memberships,
      (SELECT count(*)::int FROM intent_networks) AS assignments,
      (SELECT count(*)::int FROM apikey) AS api_keys,
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM conversations c WHERE NOT EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )) AS human_conversations,
      (SELECT count(*)::int FROM messages m WHERE NOT EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = m.conversation_id AND p.participant_type = 'agent'
      )) AS human_messages,
      (SELECT count(*)::int FROM opportunities) AS opportunities,
      (SELECT count(*)::int FROM negotiations) AS negotiations,
      (SELECT count(*)::int FROM negotiation_turns) AS turns,

      (SELECT count(*)::int FROM agent_sessions) AS agent_sessions,
      (SELECT count(*)::int FROM conversations c WHERE EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )) AS agent_conversations,
      (SELECT count(*)::int FROM conversation_metadata WHERE metadata ? 'matchProvenance') AS match_provenance,
      (SELECT count(*)::int FROM intents WHERE archived_at IS NULL
        AND (status IS NULL OR status IN ('ACTIVE', 'PAUSED'))
        AND (status IS DISTINCT FROM 'PAUSED' OR first_discovery_succeeded_at IS NOT NULL)
      ) AS intents_to_reset
  `;
  return row as Counts;
}

/** Clear replay results atomically while excluding another reset or replay. */
export async function resetReplay(sql: postgres.Sql): Promise<void> {
  await sql.begin(async tx => {
    await acquireLock(tx, RESET_LOCK);
    await acquireLock(tx, REPLAY_LOCK);
    const before = await readResetCounts(tx);
    await tx`UPDATE intents SET status = 'PAUSED', first_discovery_succeeded_at = NULL,
      updated_at = greatest(now(), updated_at + interval '1 millisecond')
      WHERE archived_at IS NULL AND (status IS NULL OR status IN ('ACTIVE', 'PAUSED'))
        AND (status IS DISTINCT FROM 'PAUSED' OR first_discovery_succeeded_at IS NOT NULL)`;
    await tx`DELETE FROM agent_sessions`;
    await tx`DELETE FROM conversations c WHERE EXISTS (
      SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
    )`;
    await tx`UPDATE conversation_metadata SET metadata = metadata - 'matchProvenance', updated_at = now()
      WHERE metadata ? 'matchProvenance'`;

    // Negotiations and their turns cascade from their opportunity.
    await tx`DELETE FROM opportunities`;
    const after = await readResetCounts(tx);
    const cleared = new Set(['opportunities', 'negotiations', 'turns', 'agent_sessions', 'agent_conversations', 'match_provenance', 'intents_to_reset']);
    for (const [name, count] of Object.entries(after)) {
      if (count !== (cleared.has(name) ? 0 : before[name])) throw new Error(`Reset invariant failed: ${name}`);
    }
    console.log('[dev-intents] Reset counts:', JSON.stringify({ before, after }));
  });
}

export interface ReplayIntent { id: string; userId: string }

/** Select only intents that can discover counterparts in an existing network. */
export async function replayCandidates(sql: postgres.Sql | postgres.TransactionSql): Promise<ReplayIntent[]> {
  const candidates = await sql<ReplayIntent[]>`
    SELECT i.id, i.user_id AS "userId" FROM intents i
    WHERE i.status = 'PAUSED' AND i.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM intent_networks a
      JOIN networks n ON n.id = a.network_id AND n.deleted_at IS NULL
      JOIN network_members m ON m.network_id = n.id AND m.user_id = i.user_id AND m.deleted_at IS NULL
      WHERE a.intent_id = i.id
    ) ORDER BY i.id`;
  const [counts] = await sql`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
    count(*) FILTER (WHERE status = 'PAUSED' AND archived_at IS NULL)::int AS paused FROM intents`;
  console.log('[dev-intents] Cohort:', JSON.stringify({ ...counts, eligible: candidates.length, withoutNetwork: counts.paused - candidates.length }));
  return candidates;
}

/** Fisher–Yates shuffle; timestamps and stored intent order are preserved. */
export function shuffled<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export const DEFAULT_REPLAY_LIMIT = 5;

/** Read the optional resume count argument; omitted means the default limit. */
export function parseReplayLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_REPLAY_LIMIT;
  const limit = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error(`Resume count must be a positive integer (got "${value}").`);
  }
  return limit;
}

/** Independently jitter each gap between five and ten seconds. */
export function replayDelayMs(): number {
  return 5_000 + Math.floor(Math.random() * 5_001);
}

/** Select at most `limit` intents before staggering transitions; the caller drains discovery. */
export async function runReplay(
  candidates: readonly ReplayIntent[],
  limit: number,
  activate: (intent: ReplayIntent) => Promise<IntentTransitionOutcome>,
  signal: AbortSignal,
): Promise<{ selected: number; resumed: number; skipped: number; failed: string[] }> {
  const ordered = shuffled(candidates).slice(0, limit);
  const result = { selected: ordered.length, resumed: 0, skipped: 0, failed: [] as string[] };
  console.log(`[dev-intents] Selected ${result.selected} of ${candidates.length} eligible paused intents.`);
  for (const [index, intent] of ordered.entries()) {
    if (signal.aborted) break;
    if (index > 0) {
      const delayMs = replayDelayMs();
      console.log(`[dev-intents] Next activation in ${(delayMs / 1000).toFixed(1)}s`);
      try { await sleep(delayMs, undefined, { signal }); }
      catch (error) { if (signal.aborted) break; throw error; }
    }
    try {
      const outcome = await activate(intent);
      if (outcome.kind !== 'success') throw new Error(outcome.kind);
      if (outcome.changed) result.resumed++;
      else result.skipped++;
      console.log(`[dev-intents] ${new Date().toISOString()} ${index + 1}/${ordered.length} ${intent.id} ${outcome.changed ? 'resumed' : 'already active'}`);
    } catch (error) {
      result.failed.push(intent.id);
      console.error(`[dev-intents] ${intent.id} transition failed:`, error instanceof Error ? error.message : String(error));
    }
  }
  return result;
}

export async function resumeReplay(limit: number): Promise<void> {
  process.env.DATABASE_URL = databaseUrl(process.env.DATABASE_URL);
  if (!process.env.REDIS_URL || !process.env.OPENROUTER_API_KEY || process.env.NODE_ENV === 'test') {
    throw new Error('Development Redis and model credentials are required; test mode is not supported.');
  }
  const stop = new AbortController();
  let closing = false;
  let connectionLost = false;
  const pool = openControl(process.env.DATABASE_URL, () => {
    if (!closing) { connectionLost = true; stop.abort(); }
  });
  const interrupt = () => { stop.abort(); console.log('[dev-intents] Stopping activations.'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  process.on('SIGHUP', interrupt);
  let closeRuntime: (() => Promise<void>) | undefined;
  try {
    await pool.begin(async control => {
      await acquireLock(control, REPLAY_LOCK);
      const candidates = await replayCandidates(control);
      const [{ closeDb }, { getRedisClient }] = await Promise.all([import('../lib/drizzle/drizzle'), import('../adapters/cache.adapter')]);
      closeRuntime = async () => { try { await getRedisClient().quit(); } finally { await closeDb(); } };
      const [{ Intents }, { IntentService }, { intentDatabaseAdapter }, { intentIndexing }] = await Promise.all([
        import('@indexnetwork/protocol'), import('../services/intent.service'), import('../adapters/database.adapter'),
        import('../lib/intent/indexing'),
      ]);
      const graph = new Intents({ database: intentDatabaseAdapter, followUp: intentIndexing }).createGraph();
      const service = new IntentService({ intentGraph: graph });
      const result = await runReplay(candidates, limit, ({ id, userId }) => service.transitionStatus(id, userId, 'ACTIVE'), stop.signal);
      const remaining = connectionLost ? null : (await replayCandidates(control)).length;
      console.log('[dev-intents] Replay result:', JSON.stringify({ ...result, remaining, interrupted: stop.signal.aborted }));
      if (connectionLost) throw new Error('Replay lost its control connection; remaining intents were not activated.');
      if (result.failed.length) throw new Error('Replay completed with failures; see intent IDs above.');
      if (stop.signal.aborted) process.exitCode = 130;
    });
  } finally {
    try { await closeRuntime?.(); }
    finally {
      closing = true;
      await pool.end({ timeout: 5 });
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      process.off('SIGHUP', interrupt);
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 2 || args.length > 3 || args[0] !== 'resume' || args[1] !== '--confirm') {
    console.error('Use bun run db:dev:resume --confirm [count] from the repository root.');
    process.exitCode = 1;
  } else {
    try {
      await resumeReplay(parseReplayLimit(args[2]));
    } catch (error) {
      console.error('[dev-intents]', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
