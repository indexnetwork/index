import { describe, expect, it, mock } from 'bun:test';

import { buildProfileText, classifyCandidates, parseArgs, runBackfill, type BackfillDeps, type CandidateRow } from '../backfill-global-user-contexts';

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
    identity: overrides.identity ?? null,
    narrative: overrides.narrative ?? null,
    attributes: overrides.attributes ?? null,
  };
}

/** Deps with sensible defaults; override per test. */
function makeDeps(overrides: Partial<BackfillDeps> = {}) {
  const decomposeProfile = mock(async () => [
    { text: 'I build distributed systems.', tier: 'assertive' as const },
  ]);
  const createPremise = mock(async () => true);
  const ensureGlobalContext = mock(async () => 'A GENERATED GLOBAL CONTEXT PARAGRAPH.');
  return {
    decomposeProfile,
    createPremise,
    ensureGlobalContext,
    ...overrides,
  } satisfies BackfillDeps;
}

// ---------------------------------------------------------------------------
// buildProfileText
// ---------------------------------------------------------------------------

describe('buildProfileText', () => {
  it('joins only the non-empty fields', () => {
    const text = buildProfileText(
      { name: 'Ada', bio: 'Mathematician.', location: 'London' },
      { context: 'Working on engines.' },
      { skills: ['math', 'logic'], interests: ['poetry'] },
    );
    expect(text).toBe(
      'My name is Ada.\nI am based in London.\nMathematician.\nWorking on engines.\nMy skills include math, logic.\nMy interests include poetry.',
    );
  });

  it('returns empty string when every field is empty/missing', () => {
    expect(buildProfileText(null, null, null)).toBe('');
    expect(buildProfileText({ name: '', bio: '', location: '' }, { context: '' }, { skills: [], interests: [] })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// classifyCandidates (dry-run preview)
// ---------------------------------------------------------------------------

describe('classifyCandidates', () => {
  it('buckets has-premises / needs-decompose / no-data', () => {
    const candidates = [
      candidate({ premise_count: 3 }),
      candidate({ premise_count: 0, identity: { name: 'Bo', bio: '', location: '' } }),
      candidate({ premise_count: 0 }), // no premises, no profile text
    ];
    expect(classifyCandidates(candidates, true)).toEqual({
      total: 3,
      withPremises: 1,
      needDecompose: 1,
      noData: 1,
    });
  });

  it('counts profile-bearing no-premises users as noData when --no-decompose', () => {
    const candidates = [candidate({ premise_count: 0, identity: { name: 'Bo', bio: '', location: '' } })];
    expect(classifyCandidates(candidates, false)).toEqual({
      total: 1,
      withPremises: 0,
      needDecompose: 0,
      noData: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('defaults: no limit, not dry-run, decompose on', () => {
    expect(parseArgs([])).toEqual({ limit: null, dryRun: false, decompose: true });
  });

  it('parses --limit N and --limit=N, --dry-run, --no-decompose', () => {
    expect(parseArgs(['--limit', '10', '--dry-run'])).toEqual({ limit: 10, dryRun: true, decompose: true });
    expect(parseArgs(['--limit=25', '--no-decompose'])).toEqual({ limit: 25, dryRun: false, decompose: false });
  });
});

// ---------------------------------------------------------------------------
// runBackfill — orchestration branches
// ---------------------------------------------------------------------------

describe('runBackfill', () => {
  it('generates directly for users with active premises (no decompose)', async () => {
    const deps = makeDeps();
    const result = await runBackfill([candidate({ premise_count: 5 })], { decompose: true }, deps);

    expect(deps.decomposeProfile).not.toHaveBeenCalled();
    expect(deps.createPremise).not.toHaveBeenCalled();
    expect(deps.ensureGlobalContext).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ generated: 1, decomposedUsers: 0, skipped: 0, failed: 0 });
  });

  it('decomposes the legacy profile first when the user has no premises, then generates', async () => {
    const deps = makeDeps({
      decomposeProfile: mock(async () => [
        { text: 'I am assertive.', tier: 'assertive' as const },
        { text: 'I am contextual.', tier: 'contextual' as const, validityDays: 30 },
      ]),
    });
    const result = await runBackfill(
      [candidate({ premise_count: 0, identity: { name: 'Bo', bio: 'Builder.', location: 'NYC' } })],
      { decompose: true },
      deps,
    );

    expect(deps.decomposeProfile).toHaveBeenCalledTimes(1);
    expect(deps.createPremise).toHaveBeenCalledTimes(2);
    expect(deps.ensureGlobalContext).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ generated: 1, decomposedUsers: 1, skipped: 0, failed: 0 });
  });

  it('sets validUntil only for contextual premises, leaves assertive open-ended', async () => {
    const calls: Array<{ tier: string; volatile: boolean; validUntil?: string }> = [];
    const deps = makeDeps({
      decomposeProfile: mock(async () => [
        { text: 'assertive', tier: 'assertive' as const },
        { text: 'contextual', tier: 'contextual' as const, validityDays: 7 },
      ]),
      createPremise: mock(async (input) => {
        calls.push({ tier: input.tier, volatile: input.volatile, validUntil: input.validUntil });
        return true;
      }),
    });
    await runBackfill(
      [candidate({ premise_count: 0, identity: { name: 'Bo', bio: 'x', location: '' } })],
      { decompose: true },
      deps,
    );

    const assertive = calls.find((c) => c.tier === 'assertive')!;
    const contextual = calls.find((c) => c.tier === 'contextual')!;
    expect(assertive.volatile).toBe(false);
    expect(assertive.validUntil).toBeUndefined();
    expect(contextual.volatile).toBe(true);
    expect(typeof contextual.validUntil).toBe('string');
  });

  it('skips no-premises users with no profile text (never calls ensureGlobalContext)', async () => {
    const deps = makeDeps();
    const result = await runBackfill([candidate({ premise_count: 0 })], { decompose: true }, deps);

    expect(deps.decomposeProfile).not.toHaveBeenCalled();
    expect(deps.ensureGlobalContext).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, decomposedUsers: 0, skipped: 1, failed: 0 });
  });

  it('skips no-premises users under --no-decompose without touching the profile', async () => {
    const deps = makeDeps();
    const result = await runBackfill(
      [candidate({ premise_count: 0, identity: { name: 'Bo', bio: 'x', location: '' } })],
      { decompose: false },
      deps,
    );

    expect(deps.decomposeProfile).not.toHaveBeenCalled();
    expect(deps.ensureGlobalContext).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, decomposedUsers: 0, skipped: 1, failed: 0 });
  });

  it('counts an empty context result as failed (generation error / no usable premises)', async () => {
    const deps = makeDeps({ ensureGlobalContext: mock(async () => '') });
    const result = await runBackfill([candidate({ premise_count: 2 })], { decompose: true }, deps);

    expect(result).toEqual({ generated: 0, decomposedUsers: 0, skipped: 0, failed: 1 });
  });

  it('skips context generation when decomposition created zero premises', async () => {
    const deps = makeDeps({
      decomposeProfile: mock(async () => [{ text: 'dup', tier: 'assertive' as const }]),
      createPremise: mock(async () => false), // all near-duplicates
    });
    const result = await runBackfill(
      [candidate({ premise_count: 0, identity: { name: 'Bo', bio: 'x', location: '' } })],
      { decompose: true },
      deps,
    );

    expect(deps.ensureGlobalContext).not.toHaveBeenCalled();
    expect(result).toEqual({ generated: 0, decomposedUsers: 1, skipped: 1, failed: 0 });
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
      { decompose: true },
      deps,
    );

    expect(result).toEqual({ generated: 1, decomposedUsers: 0, skipped: 0, failed: 1 });
  });
});
