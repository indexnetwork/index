#!/usr/bin/env node
/**
 * Backfill CLI: generate the missing **global** `user_context` row (networkId = null)
 * for every user, synthesized from their ACTIVE premises. The global row is the
 * profile-replacing identity projection (WS7 of the `user_profiles` removal epic,
 * IND-360) and must exist before the WS6 surface cutover, otherwise legacy users
 * read blank.
 *
 * Two legacy populations are migrated in a single resumable pass:
 *   1. Users WITH active premises but no global `user_context` row — synthesize the
 *      global context directly via {@link ensureGlobalUserContext} (no HyDE; the
 *      global row is intentionally excluded from context-to-intent discovery).
 *   2. Users with NO active premises but a legacy `user_profiles` row — decompose the
 *      profile text into premises first (same path as `decompose-profiles` / WS2),
 *      then synthesize the global context. Disable with `--no-decompose`.
 *
 * Idempotent + resumable: users that already have a global row are excluded by the
 * candidate query, so re-running only processes what's left. Runs entirely
 * in-process — no Redis worker required.
 *
 * Requires LLM/embedding env vars (OPENROUTER_API_KEY + embedding config), since
 * context synthesis and premise creation run in-process.
 *
 * Safety: defaults to the **development** environment. Targeting production requires
 * explicitly setting `NODE_ENV=production` (no accidental prod writes from an unset env).
 *
 * Usage:
 *   bun run maintenance:backfill-global-user-contexts [--limit N] [--dry-run] [--no-decompose]
 *
 * The orchestration core ({@link classifyCandidates}, {@link runBackfill},
 * {@link buildProfileText}) is exported and dependency-injected so it can be unit
 * tested without a live DB or LLM (see `tests/backfill-global-user-contexts.spec.ts`).
 */
import dotenv from 'dotenv';
import path from 'path';

// Side-effecting env load + adapter wiring only run when this file is the entrypoint,
// so importing the pure orchestration core from a test never touches the DB/LLM.
const isEntrypoint = import.meta.main;

if (isEntrypoint) {
  // Safe default: development unless NODE_ENV is *explicitly* production.
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  dotenv.config({ path: path.resolve(process.cwd(), envFile) });
}

/** Enrichment-path confidence — mirrors decompose-profiles (derived from profile text, not explicit). */
const ENRICHMENT_CONFIDENCE = 0.85;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProfileIdentity { name: string; bio: string; location: string }
export interface ProfileNarrative { context: string }
export interface ProfileAttributes { interests: string[]; skills: string[] }

export type CandidateRow = {
  user_id: string;
  email: string;
  premise_count: number;
  identity: ProfileIdentity | null;
  narrative: ProfileNarrative | null;
  attributes: ProfileAttributes | null;
};

/** A decomposed premise as produced by `PremiseDecomposer`. */
export interface DecomposedPremise {
  text: string;
  tier: 'assertive' | 'contextual';
  validityDays?: number;
}

/** Input passed to {@link BackfillDeps.createPremise} (provenance is fixed by the caller). */
export interface CreatePremiseInput {
  userId: string;
  assertionText: string;
  tier: 'assertive' | 'contextual';
  volatile: boolean;
  validUntil?: string;
}

/**
 * Injectable seams for {@link runBackfill}. The CLI binds these to the real
 * decomposer / premise graph / global-context helper; tests pass mocks so the
 * branching (idempotent skip, decompose path, no-data skip, failure counting) is
 * exercised without a DB or LLM. Mirrors the `EnsureGlobalUserContextDeps` pattern.
 */
export interface BackfillDeps {
  /** Decompose legacy profile text into atomic premises. */
  decomposeProfile: (text: string) => Promise<DecomposedPremise[]>;
  /** Persist one premise; resolves `true` when a new premise was created (not a near-duplicate). */
  createPremise: (input: CreatePremiseInput) => Promise<boolean>;
  /** Synthesize + upsert the global context from ACTIVE premises; '' on no premises / failure. */
  ensureGlobalContext: (userId: string) => Promise<string>;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

export interface BackfillOptions {
  limit: number | null;
  dryRun: boolean;
  decompose: boolean;
}

export interface BackfillResult {
  generated: number;
  decomposedUsers: number;
  skipped: number;
  failed: number;
}

export interface Classification {
  total: number;
  withPremises: number;
  needDecompose: number;
  noData: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Assembles a text blob from legacy profile fields, skipping empty values.
 * @returns A newline-joined text suitable for premise decomposition, or '' when empty.
 */
export function buildProfileText(
  identity: ProfileIdentity | null,
  narrative: ProfileNarrative | null,
  attributes: ProfileAttributes | null,
): string {
  const lines: string[] = [];
  if (identity?.name) lines.push(`My name is ${identity.name}.`);
  if (identity?.location) lines.push(`I am based in ${identity.location}.`);
  if (identity?.bio) lines.push(identity.bio);
  if (narrative?.context) lines.push(narrative.context);
  if (attributes?.skills?.length) lines.push(`My skills include ${attributes.skills.join(', ')}.`);
  if (attributes?.interests?.length) lines.push(`My interests include ${attributes.interests.join(', ')}.`);
  return lines.join('\n');
}

/**
 * Classify candidates for the `--dry-run` preview without any side effects.
 * @param candidates - Users missing a global context row.
 * @param decompose - Whether the no-premises population would be decomposed.
 * @returns Counts of each disposition.
 */
export function classifyCandidates(candidates: CandidateRow[], decompose: boolean): Classification {
  let withPremises = 0;
  let needDecompose = 0;
  let noData = 0;
  for (const c of candidates) {
    if (c.premise_count > 0) withPremises++;
    else if (decompose && buildProfileText(c.identity, c.narrative, c.attributes).trim()) needDecompose++;
    else noData++;
  }
  return { total: candidates.length, withPremises, needDecompose, noData };
}

// ---------------------------------------------------------------------------
// Orchestration core (exported for testing, dependency-injected)
// ---------------------------------------------------------------------------

/**
 * Process the candidate set: for each user, decompose their legacy profile into
 * premises when they have none (population 2), then synthesize + upsert the global
 * context. Pure orchestration — all IO is injected via {@link BackfillDeps}.
 *
 * @param candidates - Users missing a global context row.
 * @param opts - `decompose` controls whether population 2 is decomposed; `limit`/`dryRun` are handled by the caller.
 * @param deps - Injected decomposer / premise writer / global-context synthesizer.
 * @returns Tallies of generated, decomposed, skipped, and failed users.
 */
export async function runBackfill(
  candidates: CandidateRow[],
  opts: Pick<BackfillOptions, 'decompose'>,
  deps: BackfillDeps,
): Promise<BackfillResult> {
  const log = deps.log ?? (() => {});
  const logError = deps.logError ?? (() => {});
  const result: BackfillResult = { generated: 0, decomposedUsers: 0, skipped: 0, failed: 0 };

  for (const [i, c] of candidates.entries()) {
    const label = `[${i + 1}/${candidates.length}] ${c.email}`;
    try {
      // Population 2: no premises yet — decompose the legacy profile into premises first.
      if (c.premise_count === 0) {
        if (!opts.decompose) {
          result.skipped++;
          log(`  ${label} — no premises, --no-decompose -> skipped`);
          continue;
        }
        const profileText = buildProfileText(c.identity, c.narrative, c.attributes);
        if (!profileText.trim()) {
          result.skipped++;
          log(`  ${label} — no premises, no profile text -> skipped`);
          continue;
        }

        const premises = await deps.decomposeProfile(profileText);
        let created = 0;
        for (const p of premises) {
          // Mirror decompose-profiles / decomposePremisesNode: contextual premises carry
          // an LLM-inferred validity window and are volatile; assertive don't expire.
          const isContextual = p.tier === 'contextual';
          const validUntil = isContextual && p.validityDays
            ? new Date(Date.now() + p.validityDays * MS_PER_DAY).toISOString()
            : undefined;
          const wasCreated = await deps.createPremise({
            userId: c.user_id,
            assertionText: p.text,
            tier: p.tier,
            volatile: isContextual,
            ...(validUntil ? { validUntil } : {}),
          });
          if (wasCreated) created++;
        }
        result.decomposedUsers++;
        log(`  ${label} — decomposed legacy profile -> ${created} premise(s)`);
        if (created === 0) {
          result.skipped++;
          log(`  ${label} — no premises created -> skipped global context`);
          continue;
        }
      }

      // Both populations: synthesize + upsert the global context from ACTIVE premises.
      // ensureGlobalContext is idempotent and swallows errors (returns ''), so an empty
      // result here means generation failed or there were no usable premises.
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
  return { limit, dryRun: argv.includes('--dry-run'), decompose: !argv.includes('--no-decompose') };
}

// ---------------------------------------------------------------------------
// Main (entrypoint only — wires real adapters)
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { sql } = await import('drizzle-orm');
  const { PremiseDecomposer, PremiseGraphFactory } = await import('@indexnetwork/protocol');
  type PremiseGraphDatabase = import('@indexnetwork/protocol').PremiseGraphDatabase;
  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const { ChatDatabaseAdapter } = await import('../adapters/database.adapter');
  const { EmbedderAdapter } = await import('../adapters/embedder.adapter');
  const { ensureGlobalUserContext } = await import('../lib/usercontext/global-context');

  const opts = parseArgs(process.argv.slice(2));
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  console.log(
    `backfill-global-user-contexts: env=${envFile} limit=${opts.limit ?? 'none'} dry-run=${opts.dryRun} decompose=${opts.decompose}`,
  );

  try {
    // Idempotent candidate set: live, non-ghost users WITHOUT a global context row
    // (networkId IS NULL). Ordered by premise count so cheap high-signal users go first.
    const candidates = await db.execute<CandidateRow>(sql`
      SELECT
        u.id AS user_id,
        u.email,
        (
          SELECT count(*)::int FROM premises p
          WHERE p.user_id = u.id AND p.deleted_at IS NULL AND p.status = 'ACTIVE'
        ) AS premise_count,
        up.identity,
        up.narrative,
        up.attributes
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.deleted_at IS NULL
        AND u.is_ghost = false
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
      const c = classifyCandidates(candidates, opts.decompose);
      console.log(`  [dry-run] ${c.withPremises} have active premises -> generate global context directly`);
      console.log(`  [dry-run] ${c.needDecompose} have no premises but legacy profile text -> decompose first`);
      console.log(`  [dry-run] ${c.noData} have no premises and no usable profile text -> skipped${opts.decompose ? '' : ' (--no-decompose)'}`);
      return;
    }

    const database = new ChatDatabaseAdapter();
    const embedder = new EmbedderAdapter();
    const decomposer = new PremiseDecomposer();
    const premiseGraph = new PremiseGraphFactory(
      database as unknown as PremiseGraphDatabase,
      embedder,
    ).createGraph();

    const deps: BackfillDeps = {
      decomposeProfile: async (text) => (await decomposer.invoke(text)).premises as DecomposedPremise[],
      createPremise: async (input) => {
        const res = await premiseGraph.invoke({
          ...input,
          provenanceSource: 'enrichment' as const,
          provenanceConfidence: ENRICHMENT_CONFIDENCE,
        });
        return !!res.premise;
      },
      ensureGlobalContext: ensureGlobalUserContext,
      log: (m) => console.log(m),
      logError: (m) => console.error(m),
    };

    const r = await runBackfill(candidates, opts, deps);
    console.log(
      `\nDone. ${r.generated} global context(s) generated (${r.decomposedUsers} required profile decomposition first), ${r.skipped} skipped, ${r.failed} failed.`,
    );
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
