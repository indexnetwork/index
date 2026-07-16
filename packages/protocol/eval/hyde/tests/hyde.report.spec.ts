import { describe, expect, it } from 'bun:test';

import { HYDE_CASES } from '../hyde.cases.js';
import { buildHydeEvalMetadata, fingerprint, getHydeEvalModelMetadata, readGitMetadata } from '../hyde.report.js';

const git = {
  revision: 'abc123',
  dirty: true,
  revisionWithDirtyMarker: 'abc123-dirty',
} as const;

function metadata(minScore = 0.4) {
  return buildHydeEvalMetadata({
    allCases: HYDE_CASES,
    selectedCases: HYDE_CASES.slice(0, 1),
    embedding: {
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-large',
      dimensions: 2000,
      encodingFormat: 'float',
    },
    minScore,
    lensBonusPerAdditionalMatch: 0.1,
    recallK: 2,
    runsPerCase: 3,
    git,
  });
}

describe('HyDE report metadata', () => {
  it('fingerprints canonical object content independent of key order', () => {
    expect(fingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(
      fingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });

  it('reads git revision and dirty state through argument-safe commands', () => {
    const calls: string[][] = [];
    const result = readGitMetadata('/repo', (args, cwd) => {
      expect(cwd).toBe('/repo');
      calls.push(args);
      return args[0] === 'rev-parse' ? 'deadbeef\n' : ' M eval/hyde/hyde.scorer.ts\n';
    });

    expect(calls).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '--untracked-files=normal'],
    ]);
    expect(result).toEqual({
      revision: 'deadbeef',
      dirty: true,
      revisionWithDirtyMarker: 'deadbeef-dirty',
    });
  });

  it('reports model IDs and reproducible corpus/config/case metadata without providers', () => {
    expect(getHydeEvalModelMetadata()).toEqual({
      lensInferrer: 'google/gemini-2.5-flash',
      generator: 'google/gemini-2.5-flash',
      validator: 'google/gemini-2.5-flash',
    });

    const first = metadata();
    const repeated = metadata();
    expect(first).toEqual(repeated);
    expect(first).toMatchObject({
      git,
      generationVersion: 'frame-v1',
      minScore: 0.4,
      lensBonus: {
        perAdditionalMatch: 0.1,
      },
      executionOrdering: {
        modes: ['legacy', 'frame-v1'],
      },
      selectedCaseIds: [HYDE_CASES[0].id],
    });
    expect(first.corpusFingerprint).toHaveLength(64);
    expect(first.configFingerprint).toHaveLength(64);
    expect(first.selectedCaseSnapshots).toEqual([
      { id: HYDE_CASES[0].id, sha256: fingerprint(HYDE_CASES[0]) },
    ]);
    expect(metadata(0.45).configFingerprint).not.toBe(first.configFingerprint);
  });
});
