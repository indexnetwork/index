/**
 * Executable, credential-free harness for the actual CLI entrypoint function.
 * It supplies only local no-op dependencies, so no database/provider path can
 * run while stdout/stderr behavior remains the production command boundary.
 */
import { runEntrypoint, type BackfillDeps } from '../../backfill-intent-verification-analysis';

const partitionCounts = {
  proposal_confirm_default_only: 0,
  proposal_confirm_partial_missing: 0,
  legacy_discovery_missing_analysis: 0,
  other_missing_analysis: 0,
} as const;

const deps: BackfillDeps = {
  listCandidates: async () => [],
  countCandidates: async () => partitionCounts,
  countControls: async () => ({ completeAnalysis: 0, partialAnalysis: 0 }),
  getProfileContext: async () => { throw new Error('dry-run fixture must not request profile context'); },
  verify: async () => { throw new Error('dry-run fixture must not invoke verifier'); },
  getAttemptStatus: async () => { throw new Error('dry-run fixture must not read attempts'); },
  beginRun: async () => { throw new Error('dry-run fixture must not create a run'); },
  recordAttempt: async () => { throw new Error('dry-run fixture must not record an attempt'); },
  applyAnalysis: async () => { throw new Error('dry-run fixture must not update an intent'); },
  finishRun: async () => { throw new Error('dry-run fixture must not finish a run'); },
};

process.exitCode = await runEntrypoint([], {
  createDeps: async () => deps,
  stdout: (line) => process.stdout.write(line),
  stderr: (line) => process.stderr.write(line),
});
