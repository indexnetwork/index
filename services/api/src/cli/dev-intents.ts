#!/usr/bin/env bun
import { setTimeout as sleep } from 'node:timers/promises';
import postgres from 'postgres';

import type { IntentTransitionOutcome } from '../services/intent.service';

export const DEV = {
  project: '5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10',
  environment: '455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca',
  service: '6697e7c7-b627-499b-876d-e040a47b5779',
  hostname: 'ep-divine-hall-ahr3jr7p.c-3.us-east-1.aws.neon.tech',
  database: 'protocol_prod',
  health: 'https://protocol.dev.index.network/health',
} as const;

// Separate locks let reset stop a running replay while serializing reset itself.
export const RESET_LOCK = 741_901;
export const REPLAY_LOCK = 741_902;

/** Validate the only supported database and remove routing overrides from its URL. */
export function devDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error('Railway dev DATABASE_URL is required.');
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('Railway dev DATABASE_URL is not a valid Postgres URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || ![DEV.hostname, DEV.hostname.replace('.c-3.', '-pooler.c-3.')].includes(url.hostname)
    || url.pathname !== `/${DEV.database}` || (url.port && url.port !== '5432')) {
    throw new Error('Refusing database: expected Railway dev protocol_prod. Production and protocol_sandbox are not supported.');
  }
  // Do not allow connection-string query parameters to override the checked route.
  url.search = '';
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

/** A dedicated direct connection keeps advisory locks for the whole command. */
export function openDevControl(value: string | undefined, onclose: () => void) {
  const url = new URL(devDatabaseUrl(value));
  url.hostname = DEV.hostname;
  return postgres(url.toString(), {
    max: 1, prepare: false, idle_timeout: 0, max_lifetime: 0, connect_timeout: 10, onclose,
  });
}

/** Fail rather than overlap another operation holding this session lock. */
export async function acquireLock(sql: postgres.Sql, key: number): Promise<void> {
  const [row] = await sql`SELECT pg_try_advisory_lock(${key}) AS acquired`;
  if (!row.acquired) throw new Error(key === RESET_LOCK ? 'A dev reset is already running.' : 'A dev replay is already running.');
}

type Counts = Record<string, number>;

/** Counts checked inside the reset transaction, while the API is stopped. */
export async function readResetCounts(sql: postgres.Sql | postgres.TransactionSql): Promise<Counts> {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM protocol_intents) AS intents,
      (SELECT count(*)::int FROM protocol_networks) AS networks,
      (SELECT count(*)::int FROM protocol_network_members) AS memberships,
      (SELECT count(*)::int FROM protocol_intent_networks) AS assignments,
      (SELECT count(*)::int FROM apikey) AS api_keys,
      (SELECT count(*)::int FROM accounts) AS accounts,
      (SELECT count(*)::int FROM sessions) AS sessions,
      (SELECT count(*)::int FROM conversations c WHERE NOT EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )) AS human_conversations,
      (SELECT count(*)::int FROM messages m WHERE NOT EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = m.conversation_id AND p.participant_type = 'agent'
      )) AS human_messages,
      (SELECT count(*)::int FROM protocol_opportunities) AS opportunities,
      (SELECT count(*)::int FROM protocol_negotiations) AS negotiations,
      (SELECT count(*)::int FROM protocol_negotiation_turns) AS turns,
      (SELECT count(*)::int FROM protocol_opportunity_outcome_events) AS feedback,
      (SELECT count(*)::int FROM agent_sessions) AS agent_sessions,
      (SELECT count(*)::int FROM conversations c WHERE EXISTS (
        SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
      )) AS agent_conversations,
      (SELECT count(*)::int FROM conversation_metadata WHERE metadata ? 'matchProvenance') AS match_provenance,
      (SELECT count(*)::int FROM protocol_intents WHERE archived_at IS NULL
        AND (status IS NULL OR status IN ('ACTIVE', 'PAUSED'))
        AND (status IS DISTINCT FROM 'PAUSED' OR first_discovery_succeeded_at IS NOT NULL OR last_visited_at IS NOT NULL)
      ) AS intents_to_reset
  `;
  return row as Counts;
}

/** Clear replay results atomically; the caller must have stopped the dev API first. */
export async function resetReplay(sql: postgres.Sql): Promise<void> {
  await sql.begin(async tx => {
    const [locks] = await tx`SELECT count(*)::int AS held FROM pg_locks
      WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
        AND classid = 0 AND objid IN (${RESET_LOCK}, ${REPLAY_LOCK}) AND objsubid = 1`;
    if (locks.held !== 2) throw new Error('Reset lost its operation locks; refusing to clear data.');
    const before = await readResetCounts(tx);
    await tx`UPDATE protocol_intents SET status = 'PAUSED', first_discovery_succeeded_at = NULL,
      last_visited_at = NULL, updated_at = greatest(now(), updated_at + interval '1 millisecond')
      WHERE archived_at IS NULL AND (status IS NULL OR status IN ('ACTIVE', 'PAUSED'))
        AND (status IS DISTINCT FROM 'PAUSED' OR first_discovery_succeeded_at IS NOT NULL OR last_visited_at IS NOT NULL)`;
    await tx`DELETE FROM agent_sessions`;
    await tx`DELETE FROM conversations c WHERE EXISTS (
      SELECT 1 FROM conversation_participants p WHERE p.conversation_id = c.id AND p.participant_type = 'agent'
    )`;
    await tx`UPDATE conversation_metadata SET metadata = metadata - 'matchProvenance', updated_at = now()
      WHERE metadata ? 'matchProvenance'`;
    await tx`DELETE FROM protocol_opportunity_outcome_events`;
    // Negotiations and their turns cascade from their opportunity.
    await tx`DELETE FROM protocol_opportunities`;
    const after = await readResetCounts(tx);
    const cleared = new Set(['opportunities', 'negotiations', 'turns', 'feedback', 'agent_sessions', 'agent_conversations', 'match_provenance', 'intents_to_reset']);
    for (const [name, count] of Object.entries(after)) {
      if (count !== (cleared.has(name) ? 0 : before[name])) throw new Error(`Reset invariant failed: ${name}`);
    }
    console.log('[dev-intents] Reset counts:', JSON.stringify({ before, after }));
  });
}

export interface ReplayIntent { id: string; userId: string }

/** Select only intents that can discover counterparts in an existing network. */
export async function replayCandidates(sql: postgres.Sql): Promise<ReplayIntent[]> {
  const candidates = await sql<ReplayIntent[]>`
    SELECT i.id, i.user_id AS "userId" FROM protocol_intents i
    WHERE i.status = 'PAUSED' AND i.archived_at IS NULL AND EXISTS (
      SELECT 1 FROM protocol_intent_networks a
      JOIN protocol_networks n ON n.id = a.network_id AND n.deleted_at IS NULL
      JOIN protocol_network_members m ON m.network_id = n.id AND m.user_id = i.user_id AND m.deleted_at IS NULL
      WHERE a.intent_id = i.id
    ) ORDER BY i.id`;
  const [counts] = await sql`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
    count(*) FILTER (WHERE status = 'PAUSED' AND archived_at IS NULL)::int AS paused FROM protocol_intents`;
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

/** Independently jitter each gap between ten and thirty seconds. */
export function replayDelayMs(): number {
  return 10_000 + Math.floor(Math.random() * 20_001);
}

/** Select at most five intents before staggering transitions; the caller drains discovery. */
export async function runReplay(
  candidates: readonly ReplayIntent[],
  activate: (intent: ReplayIntent) => Promise<IntentTransitionOutcome>,
  signal: AbortSignal,
): Promise<{ selected: number; resumed: number; skipped: number; failed: string[] }> {
  const ordered = shuffled(candidates).slice(0, 5);
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

async function resume(): Promise<void> {
  if (process.env.RAILWAY_PROJECT_ID !== DEV.project || process.env.RAILWAY_ENVIRONMENT_ID !== DEV.environment
    || process.env.RAILWAY_SERVICE_ID !== DEV.service || !process.env.RAILWAY_DEPLOYMENT_ID) {
    throw new Error('Run resume inside the Railway dev API service using bun run db:dev:resume --confirm.');
  }
  process.env.DATABASE_URL = devDatabaseUrl(process.env.DATABASE_URL);
  if (!process.env.REDIS_URL || !process.env.OPENROUTER_API_KEY || process.env.NODE_ENV === 'test') {
    throw new Error('Railway dev Redis and model credentials are required; test mode is not supported.');
  }
  const stop = new AbortController();
  let closing = false;
  let connectionLost = false;
  const pool = openDevControl(process.env.DATABASE_URL, () => {
    if (!closing) { connectionLost = true; stop.abort(); }
  });
  const interrupt = () => { stop.abort(); console.log('[dev-intents] Stopping activations; draining discovery.'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  process.on('SIGHUP', interrupt);
  const pending = new Set<Promise<void>>();
  const discoveryFailures: string[] = [];
  let closeRuntime: (() => Promise<void>) | undefined;
  let control: postgres.ReservedSql | undefined;
  try {
    control = await pool.reserve();
    await acquireLock(control, RESET_LOCK);
    await acquireLock(control, REPLAY_LOCK);
    await control`SELECT pg_advisory_unlock(${RESET_LOCK})`;
    const candidates = await replayCandidates(control);
    const [{ closeDb }, { getRedisClient }] = await Promise.all([import('../lib/drizzle/drizzle'), import('../adapters/cache.adapter')]);
    closeRuntime = async () => { try { await getRedisClient().quit(); } finally { await closeDb(); } };
    const [{ Intents }, { IntentService }, { intentDatabaseAdapter }, { intentIndexing }, { intentDiscovery }] = await Promise.all([
      import('@indexnetwork/protocol'), import('../services/intent.service'), import('../adapters/database.adapter'),
      import('../lib/intent/indexing'), import('../lib/opportunity/discovery'),
    ]);
    const graph = new Intents({ database: intentDatabaseAdapter, followUp: {
      scoreIntent: data => intentIndexing.scoreIntent(data),
      onIntentSaved: data => intentIndexing.onIntentSaved(data),
      onIntentArchived: data => intentIndexing.onIntentArchived(data),
      onIntentResumed: async data => {
        const job = intentDiscovery.runDiscover({ ...data, trigger: 'intent_resume' }).then(
          () => { console.log(`[dev-intents] ${data.intentId} discovery finished`); },
          (error: unknown) => {
            discoveryFailures.push(data.intentId);
            console.error(`[dev-intents] ${data.intentId} discovery failed:`, error instanceof Error ? error.message : String(error));
          },
        );
        pending.add(job);
        void job.finally(() => pending.delete(job));
      },
    } }).createGraph();
    const service = new IntentService({ intentGraph: graph });
    const result = await runReplay(candidates, ({ id, userId }) => service.transitionStatus(id, userId, 'ACTIVE'), stop.signal);
    console.log(`[dev-intents] Draining ${pending.size} discovery job(s).`);
    await Promise.all(pending);
    const remaining = connectionLost ? null : (await replayCandidates(control)).length;
    console.log('[dev-intents] Replay result:', JSON.stringify({ ...result, remaining, discoveryFailures, interrupted: stop.signal.aborted }));
    if (connectionLost) throw new Error('Replay lost its control connection; remaining intents were not activated.');
    if (result.failed.length || discoveryFailures.length) throw new Error('Replay completed with failures; see intent IDs above.');
    if (stop.signal.aborted) process.exitCode = 130;
  } finally {
    await Promise.all(pending);
    try { await closeRuntime?.(); }
    finally {
      closing = true;
      if (!connectionLost) control?.release();
      await pool.end({ timeout: 5 });
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
      process.off('SIGHUP', interrupt);
    }
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== 'resume' || args[1] !== '--confirm') {
    console.error('Use bun run db:dev:resume --confirm from the repository root.');
    process.exitCode = 1;
  } else {
    await resume().catch((error: unknown) => {
      console.error('[dev-intents]', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
