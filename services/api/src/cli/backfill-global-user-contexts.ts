#!/usr/bin/env node
/**
 * Backfill CLI: generate the missing **global** `user_context` row (networkId = null)
 * for every user, synthesized from their ACTIVE premises. The global row is the
 * profile-replacing identity projection (WS7 of the `user_profiles` removal epic,
 * IND-360) and must exist before the WS6 surface cutover, otherwise legacy users
 * read blank.
 *
 * Users WITH active premises but no global `user_context` row are synthesized
 * directly via {@link ensureGlobalUserContext} (no HyDE; the global row is
 * intentionally excluded from context-to-intent discovery). Users with no active
 * premises have no source material and are skipped — they self-heal lazily via
 * `ensureGlobalUserContext` on their next read/enrichment. NOTE: the one-off
 * profile->premises decompose CLI was removed when `user_profiles` was dropped
 * (WS8/IND-365), so this backfill only sources from premises; a user with a
 * legacy profile but no premises is skipped here, not decomposed.
 *
 * Idempotent + resumable: users that already have a global row are excluded by the
 * candidate query, so re-running only processes what's left. Runs entirely
 * in-process — no Redis worker required.
 *
 * Requires LLM/embedding env vars (OPENROUTER_API_KEY + embedding config), since
 * context synthesis runs in-process.
 *
 * Safety: defaults to the **development** environment. Targeting production requires
 * explicitly setting `NODE_ENV=production` (no accidental prod writes from an unset env).
 *
 * Usage:
 *   bun run maintenance:backfill-global-user-contexts [--limit N] [--dry-run]
 *
 * The orchestration core ({@link classifyCandidates}, {@link runBackfill}) is
 * exported and dependency-injected so it can be unit tested without a live DB or
 * LLM (see `tests/backfill-global-user-contexts.spec.ts`).
 */
import dotenv from 'dotenv';
import path from 'path';

// Side-effecting env load + adapter wiring only run when this file is the entrypoint,
// so importing the pure orchestration core from a test never touches the DB/LLM.
const isEntrypoint = import.meta.main;

if (isEntrypoint) {
  // Safe default: development unless NODE_ENV is *explicitly* production.
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });
}

export type CandidateRow = {
  user_id: string;
  email: string;
  premise_count: number;
};

/**
 * Injectable seams for {@link runBackfill}. The CLI binds these to the real
 * global-context helper; tests pass mocks so the branching (no-premises skip,
 * generation, failure counting) is exercised without a DB or LLM.
 */
export interface BackfillDeps {
  /** Synthesize + upsert the global context from ACTIVE premises; '' on no premises / failure. */
  ensureGlobalContext: (userId: string) => Promise<string>;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

export interface BackfillOptions {
  limit: number | null;
  dryRun: boolean;
}

export interface BackfillResult {
  generated: number;
  skipped: number;
  failed: number;
}

export interface Classification {
  total: number;
  withPremises: number;
  noData: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Classify candidates for the `--dry-run` preview without any side effects.
 * @param candidates - Users missing a global context row.
 * @returns Counts of each disposition.
 */
export function classifyCandidates(candidates: CandidateRow[]): Classification {
  let withPremises = 0;
  let noData = 0;
  for (const c of candidates) {
    if (c.premise_count > 0) withPremises++;
    else noData++;
  }
  return { total: candidates.length, withPremises, noData };
}

// ---------------------------------------------------------------------------
// Orchestration core (exported for testing, dependency-injected)
// ---------------------------------------------------------------------------

/**
 * Process the candidate set: for each user with ACTIVE premises, synthesize +
 * upsert the global context. Users with no premises have no source material and
 * are skipped. Pure orchestration — all IO is injected via {@link BackfillDeps}.
 *
 * @param candidates - Users missing a global context row.
 * @param deps - Injected global-context synthesizer.
 * @returns Tallies of generated, skipped, and failed users.
 */
export async function runBackfill(
  candidates: CandidateRow[],
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const log = deps.log ?? (() => {});
  const logError = deps.logError ?? (() => {});
  const result: BackfillResult = { generated: 0, skipped: 0, failed: 0 };

  for (const [i, c] of candidates.entries()) {
    const label = `[${i + 1}/${candidates.length}] ${c.email}`;
    try {
      // No active premises — no source material to synthesize from.
      if (c.premise_count === 0) {
        result.skipped++;
        log(`  ${label} — no active premises -> skipped`);
        continue;
      }

      // Synthesize + upsert the global context from ACTIVE premises. ensureGlobalContext
      // is idempotent and swallows errors (returns ''), so an empty result here means
      // generation failed or there were no usable premises.
      const text = await deps.ensureGlobalContext(c.user_id);
      if (text) {
        result.generated++;
        log(`  ${label} — global context generated (${text.length} chars)`);
      } else {
        result.failed++;
        logError(`  ${label} — FAILED: empty global context (no usable premises or generation error)`);
      }
    } catch (err) {
      result.failed++;
      logError(`  ${label} — FAILED: ${err instanceof Error ? err.message : `${err}`}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): BackfillOptions {
  let limit: number | null = null;
  const limitIdx = argv.indexOf('--limit');
  if (limitIdx !== -1) {
    limit = Number(argv[limitIdx + 1]);
  } else {
    const eqArg = argv.find((a) => a.startsWith('--limit='));
    if (eqArg) limit = Number(eqArg.split('=')[1]);
  }
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    console.error('--limit must be a positive integer');
    process.exit(1);
  }
  return { limit, dryRun: argv.includes('--dry-run') };
}

// ---------------------------------------------------------------------------
// Main (entrypoint only — wires real adapters)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { sql } = await import('drizzle-orm');
  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const { ensureGlobalUserContext } = await import('../lib/usercontext/global-context');

  const opts = parseArgs(process.argv.slice(2));
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  console.log(
    `backfill-global-user-contexts: env=${envFile} limit=${opts.limit ?? 'none'} dry-run=${opts.dryRun}`,
  );

  try {
    // Idempotent candidate set: live users WITHOUT a global context row
    // (networkId IS NULL). Ordered by premise count so cheap high-signal users go first.
    const candidates = await db.execute<CandidateRow>(sql`
      SELECT
        u.id AS user_id,
        u.email,
        (
          SELECT count(*)::int FROM premises p
          WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
        ) AS premise_count
      FROM users u
      WHERE u.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM user_contexts uc
          WHERE uc.user_id = u.id AND uc.network_id IS NULL
        )
      ORDER BY premise_count DESC
      ${opts.limit !== null ? sql`LIMIT ${opts.limit}` : sql``}
    `);

    console.log(`Users without a global user_context: ${candidates.length}`);
    if (candidates.length === 0) return;

    if (opts.dryRun) {
      const c = classifyCandidates(candidates);
      console.log(`  [dry-run] ${c.withPremises} have active premises -> generate global context directly`);
      console.log(`  [dry-run] ${c.noData} have no active premises -> skipped (no source material)`);
      return;
    }

    const deps: BackfillDeps = {
      ensureGlobalContext: ensureGlobalUserContext,
      log: (m) => console.log(m),
      logError: (m) => console.error(m),
    };

    const r = await runBackfill(candidates, deps);
    console.log(`\nDone. ${r.generated} global context(s) generated, ${r.skipped} skipped, ${r.failed} failed.`);
    if (r.failed > 0) process.exitCode = 1;
  } finally {
    await closeDb().catch(() => {});
  }
}

if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error('backfill-global-user-contexts failed:', err instanceof Error ? err.message : `${err}`);
    process.exit(1);
  });
}
