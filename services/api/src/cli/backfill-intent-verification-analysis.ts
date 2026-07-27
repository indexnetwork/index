#!/usr/bin/env bun
/**
 * Repair missing intent verification analysis without touching unrelated intent
 * state. The default is a side-effect-free report; `--write` is deliberately
 * explicit, bounded, and leaves a durable run/attempt audit trail.
 *
 * This command is intentionally not a discovery/indexing reconciler. It invokes
 * the canonical SemanticVerifier with the stored intent payload and the same
 * owner profile context used by the intent composition path. Assignment,
 * relevance, opportunity, HyDE, and raw/final score data are never selected.
 */
import dotenv from 'dotenv';
import path from 'path';
import { getModelName, SemanticVerifier } from '@indexnetwork/protocol';

import { intentProposalVerifierOutputSchema } from '../lib/intent/intent-proposal';

const isEntrypoint = import.meta.main;
export function loadEntrypointEnvironment(): void {
  // The maintenance path is safe by default: an explicit production environment
  // is required before any caller can even select production configuration.
  const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
  dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });
}

export const BACKFILL_PREDICATE_VERSION = 'intent-verification-analysis-v1';
export const DEFAULT_LIMIT = 25;

export type CandidatePartition =
  | 'proposal_confirm_default_only'
  | 'proposal_confirm_partial_missing'
  | 'legacy_discovery_missing_analysis'
  | 'other_missing_analysis';

export type Candidate = {
  id: string;
  userId: string;
  payload: string;
  sourceId: string | null;
  sourceType: string | null;
  /** Derived from intent_proposals.consumed_intent_id; source_id alone is not proof. */
  proposalConfirmed: boolean;
  semanticEntropy: number | null;
  referentialAnchor: string | null;
  intentMode: string | null;
  speechActType: string | null;
  felicityAuthority: number | null;
  felicitySincerity: number | null;
  felicityClarity: number | null;
  /** Immutable control values compared in the write WHERE clause. */
  control: {
    userId: string;
    payload: string;
    summary: string | null;
    isIncognito: boolean;
    sourceId: string | null;
    sourceType: string | null;
    embedding: string | null;
    createdAt: Date;
    updatedAt: Date;
    archivedAt: Date | null;
    lastVisitedAt: Date | null;
    firstDiscoverySucceededAt: Date | null;
    status: string | null;
  };
};

export type AnalysisColumns = {
  semanticEntropy: number;
  referentialAnchor: string | null;
  intentMode: 'REFERENTIAL' | 'ATTRIBUTIVE';
  speechActType: 'COMMISSIVE' | 'DIRECTIVE' | null;
  felicityAuthority: number;
  felicitySincerity: number;
  felicityClarity: number;
};

export type ValidationOutcome =
  | { kind: 'valid'; analysis: AnalysisColumns }
  | { kind: 'skip'; code: 'invalid_output' | 'non_actionable' };

export type AttemptStatus = 'updated' | 'skipped' | 'failed' | 'unchanged_control';
export type VerifierOutput = Awaited<ReturnType<SemanticVerifier['invoke']>>;

export interface BackfillDeps {
  listCandidates: (limit: number) => Promise<Candidate[]>;
  countCandidates: () => Promise<Record<CandidatePartition, number>>;
  countControls: () => Promise<{ completeAnalysis: number; partialAnalysis: number }>;
  getProfileContext: (userId: string) => Promise<unknown | null>;
  verify: (payload: string, context: string) => Promise<VerifierOutput>;
  getAttemptStatus: (runId: string, intentId: string) => Promise<AttemptStatus | null>;
  beginRun: (runId: string, model: string) => Promise<void>;
  recordAttempt: (input: {
    runId: string;
    intentId: string;
    partition: CandidatePartition;
    status: AttemptStatus;
    payloadHash: string;
    contextHash: string;
    verifierOutput: VerifierOutput | null;
    errorCode: string | null;
  }) => Promise<void>;
  /** Atomically updates the seven analysis columns and persists its outcome. */
  applyAnalysis: (candidate: Candidate, analysis: AnalysisColumns, provenance: {
    runId: string; partition: CandidatePartition; payloadHash: string; contextHash: string; verifierOutput: VerifierOutput;
  }) => Promise<boolean>;
  finishRun: (runId: string, status: 'completed' | 'failed') => Promise<void>;
}

export type BackfillOptions = {
  dryRun: boolean;
  limit: number;
  runId?: string;
  confirmProduction: boolean;
  verifierModel: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
};

export type BackfillReport = {
  reportVersion: 1;
  mode: 'dry-run' | 'write';
  predicateVersion: string;
  targetCounts: Record<CandidatePartition, number>;
  controls: { completeAnalysis: number; partialAnalysis: number };
  /** Aggregate only: reporting candidate identifiers or content is prohibited. */
  candidateCount: number;
  candidateCounts: Record<CandidatePartition, number>;
  validationOutcomes: Record<CandidatePartition, Record<string, number>>;
  estimatedVerifierCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  /** Actual invocation attempts, always zero for a default dry run. */
  verifierCalls: number;
  attempted: number;
  updated: number;
  skipped: number;
  failed: number;
  unchangedControl: number;
};

/** Static, content-free failure categories emitted only on stderr. */
export const CLI_FAILURE_STAGES = [
  'environment_loading',
  'entrypoint_setup',
  'parse_options',
  'validate_options',
  'dependency_assembly',
  'count_partitions',
  'count_controls',
  'candidate_listing',
  'profile_context',
  'write_operation',
  'report_serialization',
  'report_emission',
] as const;
export type CliFailureStage = typeof CLI_FAILURE_STAGES[number];

class CliStageError extends Error {
  constructor(readonly stage: CliFailureStage) {
    super(stage);
  }
}

function failureDiagnostic(stage: CliFailureStage): string {
  return `backfill-intent-verification-analysis failed stage=${stage}\n`;
}

function emptyPartitionCounts(): Record<CandidatePartition, number> {
  return {
    proposal_confirm_default_only: 0, proposal_confirm_partial_missing: 0,
    legacy_discovery_missing_analysis: 0, other_missing_analysis: 0,
  };
}

function emptyValidationOutcomes(): Record<CandidatePartition, Record<string, number>> {
  return {
    proposal_confirm_default_only: {}, proposal_confirm_partial_missing: {},
    legacy_discovery_missing_analysis: {}, other_missing_analysis: {},
  };
}

function addValidationOutcome(report: BackfillReport, partition: CandidatePartition, outcome: string) {
  report.validationOutcomes[partition] ??= {};
  report.validationOutcomes[partition][outcome] = (report.validationOutcomes[partition][outcome] ?? 0) + 1;
}

type CandidateDbRow = {
  id: string; user_id: string; payload: string; source_id: string | null; source_type: string | null;
  proposal_confirmed: boolean;
  semantic_entropy: number | null; referential_anchor: string | null; intent_mode: string | null;
  speech_act_type: string | null; felicity_authority: number | null; felicity_sincerity: number | null;
  felicity_clarity: number | null; summary: string | null; is_incognito: boolean; embedding: string | null;
  created_at: Date; updated_at: Date; archived_at: Date | null; last_visited_at: Date | null;
  first_discovery_succeeded_at: Date | null; status: string | null;
};

/**
 * Minimal runtime surface for the maintenance query path. Exported so the
 * package-script boundary test can exercise production dependency assembly
 * with a hermetic SQL recorder rather than a database connection.
 */
export type BackfillRuntime = {
  sql: typeof import('drizzle-orm').sql;
  db: (Awaited<typeof import('../lib/drizzle/drizzle')>)['default'];
  getProfileContext: (userId: string) => Promise<unknown | null>;
};

/** Candidate partitioning is diagnostic; all four partitions are evaluated independently. */
export function classifyCandidate(candidate: Pick<Candidate, 'proposalConfirmed' | 'sourceType' | 'semanticEntropy' | 'referentialAnchor' | 'intentMode' | 'speechActType' | 'felicityAuthority' | 'felicitySincerity' | 'felicityClarity'>): CandidatePartition {
  const allScoresMissing = candidate.felicityAuthority === null
    && candidate.felicitySincerity === null && candidate.felicityClarity === null;
  const defaultOnly = allScoresMissing && candidate.semanticEntropy === 1
    && candidate.referentialAnchor === null && candidate.intentMode === 'ATTRIBUTIVE'
    && candidate.speechActType === null;
  if (candidate.proposalConfirmed) {
    return defaultOnly ? 'proposal_confirm_default_only' : 'proposal_confirm_partial_missing';
  }
  if (candidate.sourceType === 'discovery_form') return 'legacy_discovery_missing_analysis';
  return 'other_missing_analysis';
}

/** Applies the canonical verifier's actionability policy without inventing output. */
export function validateVerifierOutput(output: unknown): ValidationOutcome {
  const parsed = intentProposalVerifierOutputSchema.safeParse(output);
  if (!parsed.success) return { kind: 'skip', code: 'invalid_output' };
  const value = parsed.data;

  // Reviewed policy: preserve un-actionable intents untouched. In particular,
  // ASSERTIVE/EXPRESSIVE/UNKNOWN and broad/vague results must never be made up.
  if (!['COMMISSIVE', 'DIRECTIVE', 'DECLARATION'].includes(value.classification)
    || value.semantic_entropy > 0.75 || value.felicity_scores.clarity < 40
    || value.referential_breadth === 'broad') {
    return { kind: 'skip', code: 'non_actionable' };
  }

  return {
    kind: 'valid',
    analysis: {
      semanticEntropy: value.semantic_entropy,
      referentialAnchor: value.referential_anchor,
      intentMode: value.referential_anchor ? 'REFERENTIAL' : 'ATTRIBUTIVE',
      speechActType: value.classification === 'COMMISSIVE' || value.classification === 'DIRECTIVE'
        ? value.classification : null,
      felicityAuthority: value.felicity_scores.authority,
      felicitySincerity: value.felicity_scores.sincerity,
      felicityClarity: value.felicity_scores.clarity,
    },
  };
}

export function estimateVerificationCost(candidates: Candidate[], inputCostPerMillion: number, outputCostPerMillion: number) {
  // Conservative estimator, deliberately reported as an estimate rather than a bill.
  const inputTokens = candidates.reduce((sum, candidate) => sum + 900 + Math.ceil(candidate.payload.length / 4), 0);
  const outputTokens = candidates.length * 500;
  return {
    calls: candidates.length,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens / 1_000_000) * inputCostPerMillion + (outputTokens / 1_000_000) * outputCostPerMillion,
  };
}

function validateBackfillOptions(options: BackfillOptions): void {
  if (!options.dryRun && !options.runId) throw new Error('--write requires a stable --run-id for resumability');
  if (!options.dryRun && process.env.NODE_ENV === 'production' && !options.confirmProduction) {
    throw new Error('production write requires --confirm-production after dry-run review');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 250) {
    throw new Error('--limit must be an integer from 1 through 250');
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runBackfill(options: BackfillOptions, deps: BackfillDeps): Promise<BackfillReport> {
  validateBackfillOptions(options);
  const [targetCounts, controls, candidates] = await Promise.all([deps.countCandidates(), deps.countControls(), deps.listCandidates(options.limit)]);
  const cost = estimateVerificationCost(candidates, options.inputCostPerMillion, options.outputCostPerMillion);
  const report: BackfillReport = {
    reportVersion: 1, mode: options.dryRun ? 'dry-run' : 'write', predicateVersion: BACKFILL_PREDICATE_VERSION,
    targetCounts, controls, candidateCount: candidates.length, candidateCounts: emptyPartitionCounts(), validationOutcomes: emptyValidationOutcomes(),
    estimatedVerifierCalls: cost.calls, estimatedInputTokens: cost.inputTokens,
    estimatedOutputTokens: cost.outputTokens, estimatedCostUsd: cost.costUsd,
    verifierCalls: 0, attempted: 0, updated: 0, skipped: 0, failed: 0, unchangedControl: 0,
  };
  if (!options.dryRun) await deps.beginRun(options.runId!, options.verifierModel);

  let completed = true;
  for (const candidate of candidates) {
    const partition = classifyCandidate(candidate);
    report.candidateCounts[partition]++;
    const payloadHash = await sha256(candidate.payload);
    try {
      const prior = options.dryRun ? null : await deps.getAttemptStatus(options.runId!, candidate.id);
      if (prior === 'updated' || prior === 'skipped') {
        report.skipped++;
        addValidationOutcome(report, partition, `resume_${prior}`);
        continue;
      }
      const profile = await deps.getProfileContext(candidate.userId);
      if (!profile) {
        report.skipped++;
        addValidationOutcome(report, partition, 'missing_context');
        if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'skipped', payloadHash, contextHash: await sha256('missing_context'), verifierOutput: null, errorCode: 'missing_context' });
        continue;
      }
      const context = JSON.stringify(profile);
      // A dry run is fully side-effect free: it does not spend a verifier call.
      // It reports whether each bounded row has the authoritative prerequisites.
      if (options.dryRun) {
        addValidationOutcome(report, partition, 'ready_for_verification');
        continue;
      }
      report.verifierCalls++;
      const output = await deps.verify(candidate.payload, context);
      report.attempted++;
      const validation = validateVerifierOutput(output);
      if (validation.kind === 'skip') {
        report.skipped++;
        addValidationOutcome(report, partition, validation.code);
        if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'skipped', payloadHash, contextHash: await sha256(context), verifierOutput: output, errorCode: validation.code });
        continue;
      }
      const updated = await deps.applyAnalysis(candidate, validation.analysis, {
        runId: options.runId!, partition, payloadHash, contextHash: await sha256(context), verifierOutput: output,
      });
      const status: AttemptStatus = updated ? 'updated' : 'unchanged_control';
      if (updated) report.updated++; else report.unchangedControl++;
      addValidationOutcome(report, partition, status);
    } catch (error) {
      completed = false;
      report.failed++;
      addValidationOutcome(report, partition, 'failed');
      if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'failed', payloadHash, contextHash: await sha256('verification_failed_before_context'), verifierOutput: null, errorCode: error instanceof Error ? error.name : 'unknown_error' });
    }
  }
  if (!options.dryRun) await deps.finishRun(options.runId!, completed ? 'completed' : 'failed');
  return report;
}

/** Runtime wiring. It is kept here rather than in the pure orchestration core. */
export async function createRuntimeDeps(
  options: Pick<BackfillOptions, 'dryRun'>,
  registerCloseDb?: (closeDb: () => Promise<void>) => void,
  runtimeLoader?: () => Promise<BackfillRuntime>,
): Promise<BackfillDeps> {
  // Runtime modules remain lazy: assembling a dry-run command must not validate
  // DATABASE_URL, open a database client, or construct a provider-backed model.
  let runtime: Promise<BackfillRuntime> | undefined;
  const getRuntime = () => runtime ??= runtimeLoader?.() ?? Promise.all([
    import('drizzle-orm'),
    import('../lib/drizzle/drizzle'),
    import('../adapters/chat.database.adapter'),
  ]).then(([{ sql }, { default: db, closeDb }, { ChatDatabaseAdapter }]) => {
    registerCloseDb?.(closeDb);
    const chat = new ChatDatabaseAdapter();
    return { sql, db, getProfileContext: (userId: string) => chat.getProfile(userId) };
  });
  let verifier: SemanticVerifier | undefined;
  const getVerifier = () => {
    if (options.dryRun) throw new Error('verifier is unavailable in dry-run mode');
    return verifier ??= new SemanticVerifier();
  };
  return {
    async listCandidates(limit) {
      const { db, sql } = await getRuntime();
      const rows = await db.execute(sql`
        SELECT i.id, i.user_id, i.payload, i.source_id, i.source_type, (p.id IS NOT NULL) AS proposal_confirmed, i.semantic_entropy,
          referential_anchor, intent_mode, speech_act_type, felicity_authority,
          felicity_sincerity, felicity_clarity, summary, is_incognito,
          embedding::text AS embedding, i.created_at AS created_at, updated_at, archived_at,
          last_visited_at, first_discovery_succeeded_at, i.status AS status
        FROM intents i LEFT JOIN intent_proposals p ON p.consumed_intent_id = i.id AND p.status = 'consumed'
        WHERE i.felicity_authority IS NULL AND i.felicity_sincerity IS NULL AND i.felicity_clarity IS NULL
        ORDER BY i.created_at ASC, i.id ASC LIMIT ${limit}`);
      return (rows as unknown as CandidateDbRow[]).map((row) => ({
        id: row.id, userId: row.user_id, payload: row.payload, sourceId: row.source_id,
        sourceType: row.source_type, proposalConfirmed: row.proposal_confirmed, semanticEntropy: row.semantic_entropy,
        referentialAnchor: row.referential_anchor, intentMode: row.intent_mode,
        speechActType: row.speech_act_type, felicityAuthority: row.felicity_authority,
        felicitySincerity: row.felicity_sincerity, felicityClarity: row.felicity_clarity,
        control: { userId: row.user_id, payload: row.payload, summary: row.summary,
          isIncognito: row.is_incognito, sourceId: row.source_id, sourceType: row.source_type,
          embedding: row.embedding, createdAt: row.created_at, updatedAt: row.updated_at,
          archivedAt: row.archived_at, lastVisitedAt: row.last_visited_at,
          firstDiscoverySucceededAt: row.first_discovery_succeeded_at, status: row.status },
      }));
    },
    async countCandidates() {
      const { db, sql } = await getRuntime();
      const rows = await db.execute(sql`
        SELECT
          CASE
            WHEN p.id IS NOT NULL AND i.semantic_entropy = 1 AND i.referential_anchor IS NULL
              AND i.intent_mode = 'ATTRIBUTIVE' AND i.speech_act_type IS NULL
              THEN 'proposal_confirm_default_only'
            WHEN p.id IS NOT NULL THEN 'proposal_confirm_partial_missing'
            WHEN i.source_type = 'discovery_form' THEN 'legacy_discovery_missing_analysis'
            ELSE 'other_missing_analysis'
          END AS partition, count(*)::int AS count
        FROM intents i LEFT JOIN intent_proposals p ON p.consumed_intent_id = i.id AND p.status = 'consumed'
        WHERE i.felicity_authority IS NULL AND i.felicity_sincerity IS NULL AND i.felicity_clarity IS NULL
        GROUP BY 1`);
      const result: Record<CandidatePartition, number> = {
        proposal_confirm_default_only: 0, proposal_confirm_partial_missing: 0,
        legacy_discovery_missing_analysis: 0, other_missing_analysis: 0,
      };
      for (const row of rows as unknown as Array<{ partition: CandidatePartition; count: number }>) result[row.partition] = Number(row.count);
      return result;
    },
    async countControls() {
      const { db, sql } = await getRuntime();
      const rows = await db.execute(sql`SELECT
        count(*) FILTER (WHERE felicity_authority IS NOT NULL AND felicity_sincerity IS NOT NULL AND felicity_clarity IS NOT NULL)::int AS complete_analysis,
        count(*) FILTER (WHERE (felicity_authority IS NULL OR felicity_sincerity IS NULL OR felicity_clarity IS NULL)
          AND NOT (felicity_authority IS NULL AND felicity_sincerity IS NULL AND felicity_clarity IS NULL))::int AS partial_analysis
        FROM intents`);
      const row = rows[0] as { complete_analysis?: number; partial_analysis?: number } | undefined;
      return { completeAnalysis: Number(row?.complete_analysis ?? 0), partialAnalysis: Number(row?.partial_analysis ?? 0) };
    },
    async getProfileContext(userId) {
      return (await getRuntime()).getProfileContext(userId);
    },
    verify: (payload, context) => getVerifier().invoke(payload, context),
    async getAttemptStatus(runId, intentId) {
      const { db, sql } = await getRuntime();
      const rows = await db.execute(sql`SELECT status FROM intent_verification_backfill_attempts WHERE run_id = ${runId} AND intent_id = ${intentId}`);
      return (rows[0] as { status?: AttemptStatus } | undefined)?.status ?? null;
    },
    async beginRun(runId, model) {
      const { db, sql } = await getRuntime();
      const rows = await db.execute(sql`INSERT INTO intent_verification_backfill_runs (id, predicate_version, verifier_name, verifier_model, status)
        VALUES (${runId}, ${BACKFILL_PREDICATE_VERSION}, 'SemanticVerifier', ${model}, 'running')
        ON CONFLICT (id) DO UPDATE SET status = 'running', finished_at = NULL
        WHERE intent_verification_backfill_runs.predicate_version = ${BACKFILL_PREDICATE_VERSION}
          AND intent_verification_backfill_runs.verifier_name = 'SemanticVerifier'
          AND intent_verification_backfill_runs.verifier_model = ${model}
        RETURNING id`);
      if (rows.length !== 1) throw new Error('run ID belongs to incompatible provenance; choose a new run ID');
    },
    async recordAttempt(input) {
      const { db, sql } = await getRuntime();
      await db.execute(sql`INSERT INTO intent_verification_backfill_attempts
        (run_id, intent_id, partition, status, payload_hash, context_hash, verifier_output, error_code, applied_at)
        VALUES (${input.runId}, ${input.intentId}, ${input.partition}, ${input.status}, ${input.payloadHash}, ${input.contextHash}, ${input.verifierOutput ? JSON.stringify(input.verifierOutput) : null}::jsonb, ${input.errorCode}, ${input.status === 'updated' ? new Date() : null})
        ON CONFLICT (run_id, intent_id) DO UPDATE SET partition = EXCLUDED.partition, status = EXCLUDED.status,
          payload_hash = EXCLUDED.payload_hash, context_hash = EXCLUDED.context_hash,
          verifier_output = EXCLUDED.verifier_output, error_code = EXCLUDED.error_code,
          applied_at = EXCLUDED.applied_at, updated_at = now()`);
    },
    async applyAnalysis(candidate, analysis, provenance) {
      const { db, sql } = await getRuntime();
      // Fail closed: all source/lifecycle/payload/embedding/timestamp/old-analysis controls
      // must still match the dry-run snapshot. The SET list is intentionally seven fields only.
      const c = candidate.control;
      return db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        UPDATE intents SET semantic_entropy = ${analysis.semanticEntropy}, referential_anchor = ${analysis.referentialAnchor},
          intent_mode = ${analysis.intentMode}, speech_act_type = ${analysis.speechActType},
          felicity_authority = ${analysis.felicityAuthority}, felicity_sincerity = ${analysis.felicitySincerity},
          felicity_clarity = ${analysis.felicityClarity}
        WHERE id = ${candidate.id} AND user_id = ${c.userId}
          AND payload IS NOT DISTINCT FROM ${c.payload} AND summary IS NOT DISTINCT FROM ${c.summary}
          AND is_incognito IS NOT DISTINCT FROM ${c.isIncognito}
          AND source_id IS NOT DISTINCT FROM ${c.sourceId} AND source_type IS NOT DISTINCT FROM ${c.sourceType}
          AND embedding::text IS NOT DISTINCT FROM ${c.embedding}
          AND created_at IS NOT DISTINCT FROM ${c.createdAt} AND updated_at IS NOT DISTINCT FROM ${c.updatedAt}
          AND archived_at IS NOT DISTINCT FROM ${c.archivedAt} AND last_visited_at IS NOT DISTINCT FROM ${c.lastVisitedAt}
          AND first_discovery_succeeded_at IS NOT DISTINCT FROM ${c.firstDiscoverySucceededAt}
          AND status IS NOT DISTINCT FROM ${c.status}
          AND semantic_entropy IS NOT DISTINCT FROM ${candidate.semanticEntropy}
          AND referential_anchor IS NOT DISTINCT FROM ${candidate.referentialAnchor}
          AND intent_mode IS NOT DISTINCT FROM ${candidate.intentMode}
          AND speech_act_type IS NOT DISTINCT FROM ${candidate.speechActType}
          AND felicity_authority IS NOT DISTINCT FROM ${candidate.felicityAuthority}
          AND felicity_sincerity IS NOT DISTINCT FROM ${candidate.felicitySincerity}
          AND felicity_clarity IS NOT DISTINCT FROM ${candidate.felicityClarity}
        RETURNING id`);
      const updated = rows.length === 1;
      await tx.execute(sql`INSERT INTO intent_verification_backfill_attempts
        (run_id, intent_id, partition, status, payload_hash, context_hash, verifier_output, error_code, applied_at)
        VALUES (${provenance.runId}, ${candidate.id}, ${provenance.partition}, ${updated ? 'updated' : 'unchanged_control'},
          ${provenance.payloadHash}, ${provenance.contextHash}, ${JSON.stringify(provenance.verifierOutput)}::jsonb,
          ${updated ? null : 'unchanged_control'}, ${updated ? new Date() : null})
        ON CONFLICT (run_id, intent_id) DO UPDATE SET partition = EXCLUDED.partition, status = EXCLUDED.status,
          payload_hash = EXCLUDED.payload_hash, context_hash = EXCLUDED.context_hash,
          verifier_output = EXCLUDED.verifier_output, error_code = EXCLUDED.error_code,
          applied_at = EXCLUDED.applied_at, updated_at = now()`);
      return updated;
      });
    },
    async finishRun(runId, status) {
      const { db, sql } = await getRuntime();
      await db.execute(sql`UPDATE intent_verification_backfill_runs SET status = ${status}, finished_at = now() WHERE id = ${runId}`);
    },
  };
}

export function parseArgs(args: string[]): BackfillOptions {
  let dryRun = true;
  let limit = DEFAULT_LIMIT;
  let runId: string | undefined;
  let confirmProduction = false;
  let inputCostPerMillion = 0.30;
  let outputCostPerMillion = 2.50;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    const next = () => args[++index] ?? (() => { throw new Error(`missing value for ${value}`); })();
    if (value === '--write') dryRun = false;
    else if (value === '--confirm-production') confirmProduction = true;
    else if (value === '--limit') limit = Number(next());
    else if (value === '--run-id') runId = next();
    else if (value === '--input-cost-per-million') inputCostPerMillion = Number(next());
    else if (value === '--output-cost-per-million') outputCostPerMillion = Number(next());
    else if (value === '--dry-run') dryRun = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!Number.isFinite(inputCostPerMillion) || !Number.isFinite(outputCostPerMillion) || inputCostPerMillion < 0 || outputCostPerMillion < 0) throw new Error('cost inputs must be non-negative numbers');
  return { dryRun, limit, runId, confirmProduction, verifierModel: getModelName('intentVerifier'), inputCostPerMillion, outputCostPerMillion };
}

export interface CliEntrypointDeps {
  createDeps: (options: BackfillOptions) => Promise<BackfillDeps>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  serializeReport?: (report: BackfillReport) => string;
}

export interface EntrypointOverrides {
  createDeps?: (options: BackfillOptions) => Promise<BackfillDeps>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const forbiddenReportKeys = new Set([
  'id', 'userId', 'payload', 'sourceId', 'content', 'description', 'context',
  'verifierOutput', 'reasoning', 'embedding', 'summary',
]);

function assertSanitizedJson(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertSanitizedJson(item);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenReportKeys.has(key)) throw new Error(`report contains forbidden field: ${key}`);
    assertSanitizedJson(child);
  }
}

/** Serialize exactly the public report contract, rejecting malformed or unsafe output. */
export function serializeBackfillReport(report: BackfillReport): string {
  const serialized = JSON.stringify(report);
  const parsed: unknown = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('report serialization did not produce a JSON object');
  }
  assertSanitizedJson(parsed);
  return serialized;
}

function stageCall<T>(stage: CliFailureStage, operation: () => Promise<T>): Promise<T> {
  return operation().catch(() => { throw new CliStageError(stage); });
}

function stageBackfillDeps(deps: BackfillDeps): BackfillDeps {
  return {
    ...deps,
    countCandidates: () => stageCall('count_partitions', () => deps.countCandidates()),
    countControls: () => stageCall('count_controls', () => deps.countControls()),
    listCandidates: (limit) => stageCall('candidate_listing', () => deps.listCandidates(limit)),
    getProfileContext: (userId) => stageCall('profile_context', () => deps.getProfileContext(userId)),
    verify: (payload, context) => stageCall('write_operation', () => deps.verify(payload, context)),
    getAttemptStatus: (runId, intentId) => stageCall('write_operation', () => deps.getAttemptStatus(runId, intentId)),
    beginRun: (runId, model) => stageCall('write_operation', () => deps.beginRun(runId, model)),
    recordAttempt: (input) => stageCall('write_operation', () => deps.recordAttempt(input)),
    applyAnalysis: (candidate, analysis, provenance) => stageCall('write_operation', () => deps.applyAnalysis(candidate, analysis, provenance)),
    finishRun: (runId, status) => stageCall('write_operation', () => deps.finishRun(runId, status)),
  };
}

/**
 * The real command boundary: parses arguments, owns stdout/stderr discipline,
 * and turns any setup/reporting failure into a nonzero exit code. Injectable
 * seams keep its tests credential- and database-free.
 */
export async function runCli(args: string[], deps: CliEntrypointDeps): Promise<number> {
  let stage: CliFailureStage = 'parse_options';
  try {
    const options = parseArgs(args);
    stage = 'validate_options';
    validateBackfillOptions(options);
    stage = 'dependency_assembly';
    const backfillDeps = await deps.createDeps(options);
    const report = await runBackfill(options, stageBackfillDeps(backfillDeps));
    stage = 'report_serialization';
    const serialized = (deps.serializeReport ?? serializeBackfillReport)(report);
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('report serialization did not produce a JSON object');
    }
    assertSanitizedJson(parsed);
    // The only stdout write: one machine-parseable report object plus newline.
    stage = 'report_emission';
    deps.stdout(`${serialized}\n`);
    if (report.failed > 0) {
      deps.stderr(`backfill-intent-verification-analysis completed with ${report.failed} failed candidate(s)\n`);
      return 1;
    }
    return 0;
  } catch (error) {
    // Keep diagnostics static and out of stdout: raw errors can include SQL,
    // URIs, row data, provider details, or user content.
    const failureStage = error instanceof CliStageError ? error.stage : stage;
    deps.stderr(failureDiagnostic(failureStage));
    return 1;
  }
}

/** Actual executable entrypoint, with local-only seams for boundary tests. */
export async function runEntrypoint(args: string[], overrides: EntrypointOverrides = {}): Promise<number> {
  let close: (() => Promise<void>) | undefined;
  try {
    return await runCli(args, {
      createDeps: overrides.createDeps ?? ((options) => createRuntimeDeps(options, (closeDb) => { close = closeDb; })),
      stdout: overrides.stdout ?? ((line) => process.stdout.write(line)),
      stderr: overrides.stderr ?? ((line) => process.stderr.write(line)),
    });
  } finally {
    await close?.();
  }
}

/**
 * The package-script subprocess test cannot share an in-memory dependency seam
 * with its parent. Keep this harness strictly test-only so production assembly
 * always uses createRuntimeDeps; production assembly itself is covered directly
 * by the local runtime-assembly fixture.
 */
async function loadTestEntrypointHarness(): Promise<EntrypointOverrides> {
  // The explicit second gate lets the subprocess regression retain the real
  // production entrypoint environment branch without making this harness
  // reachable during ordinary production operation.
  const enabled = process.env.NODE_ENV === 'test' || process.env.IND590_CLI_TEST_MODE === '1';
  if (!enabled || !process.env.IND590_CLI_TEST_HARNESS) return {};
  const harness = await import('./tests/fixtures/backfill-intent-verification-analysis.package-script.harness');
  const harnesses = {
    productionAssemblyDryRun: harness.productionAssemblyDryRun,
    productionPartitionFailure: harness.productionPartitionFailure,
    productionCandidateListingFailure: harness.productionCandidateListingFailure,
    candidateDiagnostic: harness.candidateDiagnostic,
  };
  const name = process.env.IND590_CLI_TEST_HARNESS;
  if (name !== 'productionAssemblyDryRun' && name !== 'productionPartitionFailure' && name !== 'productionCandidateListingFailure' && name !== 'candidateDiagnostic') {
    throw new Error('invalid IND-590 CLI test harness');
  }
  return { createDeps: harnesses[name] };
}

async function runExecutableEntrypoint(): Promise<number> {
  let stage: CliFailureStage = 'environment_loading';
  try {
    // Explicit dotenv loading is not part of a hermetic test process. Bun's
    // --no-env-file prevents implicit loading, and this preserves that boundary.
    if (process.env.NODE_ENV !== 'test') loadEntrypointEnvironment();
    stage = 'entrypoint_setup';
    return await runEntrypoint(process.argv.slice(2), await loadTestEntrypointHarness());
  } catch {
    process.stderr.write(failureDiagnostic(stage));
    return 1;
  }
}

if (isEntrypoint) {
  process.exitCode = await runExecutableEntrypoint();
}
