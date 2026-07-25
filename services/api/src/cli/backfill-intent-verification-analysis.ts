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
if (isEntrypoint) {
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
  mode: 'dry-run' | 'write';
  predicateVersion: string;
  targetCounts: Record<CandidatePartition, number>;
  controls: { completeAnalysis: number; partialAnalysis: number };
  candidates: Array<{ id: string; partition: CandidatePartition; validation: string }>;
  estimatedVerifierCalls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  attempted: number;
  updated: number;
  skipped: number;
  failed: number;
  unchangedControl: number;
};

type CandidateDbRow = {
  id: string; user_id: string; payload: string; source_id: string | null; source_type: string | null;
  proposal_confirmed: boolean;
  semantic_entropy: number | null; referential_anchor: string | null; intent_mode: string | null;
  speech_act_type: string | null; felicity_authority: number | null; felicity_sincerity: number | null;
  felicity_clarity: number | null; summary: string | null; is_incognito: boolean; embedding: string | null;
  created_at: Date; updated_at: Date; archived_at: Date | null; last_visited_at: Date | null;
  first_discovery_succeeded_at: Date | null; status: string | null;
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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runBackfill(options: BackfillOptions, deps: BackfillDeps): Promise<BackfillReport> {
  if (!options.dryRun && !options.runId) throw new Error('--write requires a stable --run-id for resumability');
  if (!options.dryRun && process.env.NODE_ENV === 'production' && !options.confirmProduction) {
    throw new Error('production write requires --confirm-production after dry-run review');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 250) {
    throw new Error('--limit must be an integer from 1 through 250');
  }
  const [targetCounts, controls, candidates] = await Promise.all([deps.countCandidates(), deps.countControls(), deps.listCandidates(options.limit)]);
  const cost = estimateVerificationCost(candidates, options.inputCostPerMillion, options.outputCostPerMillion);
  const report: BackfillReport = {
    mode: options.dryRun ? 'dry-run' : 'write', predicateVersion: BACKFILL_PREDICATE_VERSION,
    targetCounts, controls, candidates: [],
    estimatedVerifierCalls: cost.calls, estimatedInputTokens: cost.inputTokens,
    estimatedOutputTokens: cost.outputTokens, estimatedCostUsd: cost.costUsd,
    attempted: 0, updated: 0, skipped: 0, failed: 0, unchangedControl: 0,
  };
  if (!options.dryRun) await deps.beginRun(options.runId!, options.verifierModel);

  let completed = true;
  for (const candidate of candidates) {
    const partition = classifyCandidate(candidate);
    const payloadHash = await sha256(candidate.payload);
    try {
      const prior = options.dryRun ? null : await deps.getAttemptStatus(options.runId!, candidate.id);
      if (prior === 'updated' || prior === 'skipped') {
        report.skipped++;
        report.candidates.push({ id: candidate.id, partition, validation: `resume_${prior}` });
        continue;
      }
      const profile = await deps.getProfileContext(candidate.userId);
      if (!profile) {
        report.skipped++;
        report.candidates.push({ id: candidate.id, partition, validation: 'missing_context' });
        if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'skipped', payloadHash, contextHash: await sha256('missing_context'), verifierOutput: null, errorCode: 'missing_context' });
        continue;
      }
      const context = JSON.stringify(profile);
      // A dry run is fully side-effect free: it does not spend a verifier call.
      // It reports whether each bounded row has the authoritative prerequisites.
      if (options.dryRun) {
        report.candidates.push({ id: candidate.id, partition, validation: 'ready_for_verification' });
        continue;
      }
      const output = await deps.verify(candidate.payload, context);
      report.attempted++;
      const validation = validateVerifierOutput(output);
      if (validation.kind === 'skip') {
        report.skipped++;
        report.candidates.push({ id: candidate.id, partition, validation: validation.code });
        if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'skipped', payloadHash, contextHash: await sha256(context), verifierOutput: output, errorCode: validation.code });
        continue;
      }
      const updated = await deps.applyAnalysis(candidate, validation.analysis, {
        runId: options.runId!, partition, payloadHash, contextHash: await sha256(context), verifierOutput: output,
      });
      const status: AttemptStatus = updated ? 'updated' : 'unchanged_control';
      if (updated) report.updated++; else report.unchangedControl++;
      report.candidates.push({ id: candidate.id, partition, validation: status });
    } catch (error) {
      completed = false;
      report.failed++;
      report.candidates.push({ id: candidate.id, partition, validation: 'failed' });
      if (!options.dryRun) await deps.recordAttempt({ runId: options.runId!, intentId: candidate.id, partition, status: 'failed', payloadHash, contextHash: await sha256('verification_failed_before_context'), verifierOutput: null, errorCode: error instanceof Error ? error.name : 'unknown_error' });
    }
  }
  if (!options.dryRun) await deps.finishRun(options.runId!, completed ? 'completed' : 'failed');
  return report;
}

/** Runtime wiring. It is kept here rather than in the pure orchestration core. */
export async function createRuntimeDeps(): Promise<BackfillDeps> {
  // Keep imports that initialize a database connection out of the module graph
  // used by dry-run orchestration tests. The entrypoint is the only live caller.
  const [{ sql }, { default: db }, { ChatDatabaseAdapter }] = await Promise.all([
    import('drizzle-orm'),
    import('../lib/drizzle/drizzle'),
    import('../adapters/chat.database.adapter'),
  ]);
  const verifier = new SemanticVerifier();
  const chat = new ChatDatabaseAdapter();
  return {
    async listCandidates(limit) {
      const rows = await db.execute(sql`
        SELECT i.id, i.user_id, i.payload, i.source_id, i.source_type, (p.id IS NOT NULL) AS proposal_confirmed, i.semantic_entropy,
          referential_anchor, intent_mode, speech_act_type, felicity_authority,
          felicity_sincerity, felicity_clarity, summary, is_incognito,
          embedding::text AS embedding, created_at, updated_at, archived_at,
          last_visited_at, first_discovery_succeeded_at, status
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
      const rows = await db.execute(sql`SELECT
        count(*) FILTER (WHERE felicity_authority IS NOT NULL AND felicity_sincerity IS NOT NULL AND felicity_clarity IS NOT NULL)::int AS complete_analysis,
        count(*) FILTER (WHERE (felicity_authority IS NULL OR felicity_sincerity IS NULL OR felicity_clarity IS NULL)
          AND NOT (felicity_authority IS NULL AND felicity_sincerity IS NULL AND felicity_clarity IS NULL))::int AS partial_analysis
        FROM intents`);
      const row = rows[0] as { complete_analysis?: number; partial_analysis?: number } | undefined;
      return { completeAnalysis: Number(row?.complete_analysis ?? 0), partialAnalysis: Number(row?.partial_analysis ?? 0) };
    },
    getProfileContext: (userId) => chat.getProfile(userId),
    verify: (payload, context) => verifier.invoke(payload, context),
    async getAttemptStatus(runId, intentId) {
      const rows = await db.execute(sql`SELECT status FROM intent_verification_backfill_attempts WHERE run_id = ${runId} AND intent_id = ${intentId}`);
      return (rows[0] as { status?: AttemptStatus } | undefined)?.status ?? null;
    },
    async beginRun(runId, model) {
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
      await db.execute(sql`INSERT INTO intent_verification_backfill_attempts
        (run_id, intent_id, partition, status, payload_hash, context_hash, verifier_output, error_code, applied_at)
        VALUES (${input.runId}, ${input.intentId}, ${input.partition}, ${input.status}, ${input.payloadHash}, ${input.contextHash}, ${input.verifierOutput ? JSON.stringify(input.verifierOutput) : null}::jsonb, ${input.errorCode}, ${input.status === 'updated' ? new Date() : null})
        ON CONFLICT (run_id, intent_id) DO UPDATE SET partition = EXCLUDED.partition, status = EXCLUDED.status,
          payload_hash = EXCLUDED.payload_hash, context_hash = EXCLUDED.context_hash,
          verifier_output = EXCLUDED.verifier_output, error_code = EXCLUDED.error_code,
          applied_at = EXCLUDED.applied_at, updated_at = now()`);
    },
    async applyAnalysis(candidate, analysis, provenance) {
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

if (isEntrypoint) {
  const options = parseArgs(process.argv.slice(2));
  let close: (() => Promise<void>) | undefined;
  try {
    const [{ closeDb }, deps] = await Promise.all([
      import('../lib/drizzle/drizzle'),
      createRuntimeDeps(),
    ]);
    close = closeDb;
    const report = await runBackfill(options, deps);
    // Reports include identifiers and counter/status evidence, never payload/profile/verifier reasoning.
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.failed > 0 ? 1 : 0;
  } finally {
    await close?.();
  }
}
