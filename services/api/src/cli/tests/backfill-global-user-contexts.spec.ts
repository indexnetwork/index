import { describe, expect, it, mock } from 'bun:test';

import { classifyCandidates, parseArgs, runBackfill, type BackfillDeps, type CandidateRow } from '../backfill-global-user-contexts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;
function candidate(overrides: Partial<CandidateRow> = {}): CandidateRow {
  seq += 1;
  return {
    user_id: overrides.user_id ?? `user-${seq}`,
    email: overrides.email ?? `user-${seq}@example.com`,
    premise_count: overrides.premise_count ?? 0,
  };
}

/** Deps with sensible defaults; override per test. */
function makeDeps(overrides: Partial<BackfillDeps> = {}) {
  const ensureGlobalContext = mock(async () => 'A GENERATED GLOBAL CONTEXT PARAGRAPH.');
  return {
    ensureGlobalContext,
    ...overrides,
  } satisfies BackfillDeps;
}

// ---------------------------------------------------------------------------
// classifyCandidates (dry-run preview)
// ---------------------------------------------------------------------------

describe('classifyCandidates', () => {
  it('buckets has-premises / no-data', () => {
    const candidates = [
      candidate({ premise_count: 3 }),
      candidate({ premise_count: 0 }),
      candidate({ premise_count: 0 }),
    ];
    expect(classifyCandidates(candidates)).toEqual({
      total: 3,
      withPremises: 1,
      noData: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults: no limit, not dry-run', () => {
    expect(parseArgs([])).toEqual({ limit: null, dryRun: false });
  });

  it('parses --limit N and --limit=N, --dry-run', () => {
    expect(parseArgs(['--limit', '10', '--dry-run'])).toEqual({ limit: 10, dryRun: true });
    expect(parseArgs(['--limit=25'])).toEqual({ limit: 25, dryRun: false });
  });
});

// ---------------------------------------------------------------------------
// runBackfill — orchestration branches
// ---------------------------------------------------------------------------

describe('runBackfill', () => {
  it('generates directly for users with active premises', async () => {
    const deps = makeDeps();
    const result = await runBackfill([candidate({ premise_count: 5 })], deps);

    expect(deps.ensureGlobalContext).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ generated: 1, skipped: 0, failed: 0 });
  });

  it('skips no-premises users (never calls ensureGlobalContext)', async () => {
    const deps = makeDeps();
    const result = await runBackfill([candidate({ premise_count: 0 })], deps);

    expect(deps.ensureGlobalContext).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, skipped: 1, failed: 0 });
  });

  it('counts an empty context result as failed (generation error / no usable premises)', async () => {
    const deps = makeDeps({ ensureGlobalContext: mock(async () => '') });
    const result = await runBackfill([candidate({ premise_count: 2 })], deps);

    expect(result).toEqual({ generated: 0, skipped: 0, failed: 1 });
  });

  it('isolates a thrown error to one user and continues (resumable)', async () => {
    let call = 0;
    const deps = makeDeps({
      ensureGlobalContext: mock(async () => {
        call += 1;
        if (call === 1) throw new Error('boom');
        return 'OK CONTEXT';
      }),
    });
    const result = await runBackfill(
      [candidate({ premise_count: 1 }), candidate({ premise_count: 1 })],
      deps,
    );

    expect(result).toEqual({ generated: 1, skipped: 0, failed: 1 });
  });
});
