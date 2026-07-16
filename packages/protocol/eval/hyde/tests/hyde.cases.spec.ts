import { describe, expect, it } from 'bun:test';

import { HYDE_CORPUS_MANIFEST } from '../cases/hyde.corpus.manifest.js';
import { assertFrozenHydeCorpus, fingerprintHydeCorpus, HYDE_CASES, HYDE_CORPUS_FINGERPRINT } from '../hyde.cases.js';
import { HYDE_ARTIFACT_SCHEMA_VERSION, HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_BOOTSTRAP_REPLICATES, HYDE_BOOTSTRAP_SEED, HYDE_CANONICAL_EMBEDDING_PIN, HYDE_CANONICAL_FRAME_GENERATION_VERSION, HYDE_CANONICAL_MODEL_PINS, HYDE_CANONICAL_PROVENANCE_PINS, HYDE_CANONICAL_RUNS, HYDE_CORPUS_VERSION, HYDE_EXECUTION_SEED, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_CASE_COUNT, HYDE_EXPECTED_MODE_SLOT_COUNT, HYDE_EXPECTED_PAIR_COUNT, HYDE_EXPECTED_SOURCE_CASE_COUNTS, HYDE_GATE_POLICY_VERSION, HYDE_GATE_THRESHOLDS, HYDE_LENS_BONUS, HYDE_MAX_LENSES, HYDE_METRIC_K, HYDE_MIN_SCORE, HYDE_RUBRIC_VERSION } from '../hyde.policy.js';
import { HYDE_EVAL_STRATA, type HydeEvalCase } from '../hyde.types.js';

describe('frozen HyDE evidence corpus', () => {
  it('contains the exact background-only source mix while retaining at least 15 cases per stratum', () => {
    expect(HYDE_CASES).toHaveLength(HYDE_EXPECTED_CASE_COUNT);
    expect(HYDE_EVAL_STRATA).toEqual([
      'profile-context-contamination',
      'entity-location-substitution',
      'time-numeric-scale',
      'credential-organization-exclusivity',
      'role-polarity-controls',
    ]);
    for (const stratum of HYDE_EVAL_STRATA) {
      expect(HYDE_CASES.filter((candidate) => candidate.stratum === stratum).length).toBeGreaterThanOrEqual(15);
    }
    expect(Object.fromEntries(['saved-intent', 'user-context'].map((backgroundSource) => [
      backgroundSource,
      HYDE_CASES.filter((candidate) => candidate.backgroundSource === backgroundSource).length,
    ]))).toEqual(HYDE_EXPECTED_SOURCE_CASE_COUNTS);
    expect(HYDE_CASES.flatMap((c) => c.candidates)).toHaveLength(HYDE_EXPECTED_CANDIDATE_COUNT);
    expect(HYDE_EXPECTED_PAIR_COUNT).toBe(360);
    expect(HYDE_EXPECTED_MODE_SLOT_COUNT).toBe(720);
    expect(HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING).toEqual({ 'saved-intent': 'query', 'user-context': 'context' });
    expect(HYDE_CASES.some((candidate) => candidate.backgroundSource === ('direct-search' as never))).toBeFalse();
  });

  it('keeps user-context cases intents-only and free of profile context', () => {
    const contextCases = HYDE_CASES.filter((candidate) => candidate.backgroundSource === 'user-context');
    expect(contextCases).toHaveLength(15);
    expect(contextCases.every((candidate) => candidate.profileContext === undefined)).toBeTrue();
    expect(contextCases.every((candidate) => candidate.stratum !== 'profile-context-contamination')).toBeTrue();
    expect(contextCases.every((candidate) => candidate.candidates.every((entry) => entry.corpus === 'intents'))).toBeTrue();
  });

  it('enforces graded positives, linked minimal-pair negatives, and candidate bounds', () => {
    const allCandidateIds = new Set<string>();
    const allCaseIds = new Set<string>();

    for (const c of HYDE_CASES) {
      expect(allCaseIds.has(c.id)).toBeFalse();
      allCaseIds.add(c.id);
      expect(c.candidates.length).toBeGreaterThanOrEqual(10);
      expect(c.candidates.length).toBeLessThanOrEqual(14);

      const positives = c.candidates.filter((candidate) => candidate.relevanceGrade > 0);
      const hardNegatives = c.candidates.filter((candidate) => candidate.role === 'hard-negative');
      expect([2, 3]).toContain(positives.length);
      expect(positives.some((candidate) => candidate.relevanceGrade === 3)).toBeTrue();
      expect(hardNegatives.length).toBeGreaterThanOrEqual(4);

      const positiveIds = new Set(positives.map((candidate) => candidate.id));
      for (const candidate of c.candidates) {
        expect(allCandidateIds.has(candidate.id)).toBeFalse();
        allCandidateIds.add(candidate.id);
        expect([0, 1, 2, 3]).toContain(candidate.relevanceGrade);

        if (candidate.role === 'positive') {
          expect(candidate.relevanceGrade).toBeGreaterThan(0);
          expect(candidate.hardNegativeOf).toBeUndefined();
        } else if (candidate.role === 'hard-negative') {
          expect(candidate.relevanceGrade).toBe(0);
          expect(candidate.hardNegativeOf).toBeDefined();
          expect(positiveIds.has(candidate.hardNegativeOf?.positiveCandidateId ?? '')).toBeTrue();
          expect(candidate.hardNegativeOf?.axis.trim().length).toBeGreaterThan(0);
          expect(candidate.hardNegativeOf?.rationale.trim().length).toBeGreaterThan(0);
        } else {
          expect(candidate.relevanceGrade).toBe(0);
          expect(candidate.hardNegativeOf).toBeUndefined();
        }
      }
    }
  });

  it('represents both retrieval corpora and preserves the original scenario ideas', () => {
    const corpora = new Set(HYDE_CASES.flatMap((c) => c.candidates.map((candidate) => candidate.corpus)));
    expect(corpora).toEqual(new Set(['intents', 'premises']));
    expect(HYDE_CASES.map((candidate) => candidate.id)).toEqual(expect.arrayContaining([
      'profile-context-contamination/nairobi-solar-grants',
      'credential-organization-exclusivity/robotics-nonprofit-advisor',
      'time-numeric-scale/portugal-september-packaging',
    ]));
    expect(HYDE_CASES.find((candidate) => candidate.id.endsWith('nairobi-solar-grants'))?.profileContext)
      .toContain('oncology commercialization');
    expect(HYDE_CASES.find((candidate) => candidate.id.endsWith('portugal-september-packaging'))?.profileContext)
      .toContain('million-unit plastics');
  });

  it('matches the committed fingerprint and ordered ID manifest', () => {
    expect(HYDE_CORPUS_FINGERPRINT).toBe(HYDE_CORPUS_MANIFEST.fingerprint);
    expect(fingerprintHydeCorpus(HYDE_CASES)).toBe(HYDE_CORPUS_MANIFEST.fingerprint);
    expect(HYDE_CASES.map((candidate) => candidate.id)).toEqual([...HYDE_CORPUS_MANIFEST.orderedCaseIds]);
    expect(HYDE_CASES.flatMap((c) => c.candidates.map((candidate) => candidate.id)))
      .toEqual([...HYDE_CORPUS_MANIFEST.orderedCandidateIds]);
    expect(() => assertFrozenHydeCorpus()).not.toThrow();

    const changed = structuredClone(HYDE_CASES) as HydeEvalCase[];
    changed[0].sourceText += ' Accidental edit.';
    expect(() => assertFrozenHydeCorpus(changed)).toThrow('fingerprint');
  });
});

describe('committed HyDE evidence policy', () => {
  it('preserves retrieval policy and canonical reproducibility constants', () => {
    expect(HYDE_ARTIFACT_SCHEMA_VERSION).toBe('hyde-evidence-artifact-v4');
    expect(HYDE_CORPUS_VERSION).toBe('hyde-frozen-corpus-v3');
    expect(HYDE_RUBRIC_VERSION).toBe('hyde-relevance-rubric-v3');
    expect(HYDE_GATE_POLICY_VERSION).toBe('hyde-gate-policy-v3');
    expect(HYDE_CANONICAL_RUNS).toBe(4);
    expect(HYDE_CANONICAL_RUNS % 2).toBe(0);
    expect(HYDE_BOOTSTRAP_REPLICATES).toBe(10_000);
    expect(HYDE_EXECUTION_SEED).toBe(426_202_601);
    expect(HYDE_BOOTSTRAP_SEED).toBe(426_202_602);
    expect(HYDE_MIN_SCORE).toBe(0.30);
    expect(HYDE_LENS_BONUS).toBe(0.1);
    expect(HYDE_MAX_LENSES).toBe(3);
    expect(HYDE_METRIC_K).toBe(5);
    expect(HYDE_CANONICAL_MODEL_PINS).toEqual({
      lensInferrer: 'google/gemini-2.5-flash',
      generator: 'google/gemini-2.5-flash',
      validator: 'google/gemini-2.5-flash',
    });
    expect(HYDE_CANONICAL_EMBEDDING_PIN).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'openai/text-embedding-3-large',
      dimensions: 2000,
      encodingFormat: 'float',
    });
    expect(HYDE_CANONICAL_FRAME_GENERATION_VERSION).toBe('frame-v1');
    expect(HYDE_CANONICAL_PROVENANCE_PINS).toEqual({
      models: HYDE_CANONICAL_MODEL_PINS,
      embedding: HYDE_CANONICAL_EMBEDDING_PIN,
      frameGenerationVersion: HYDE_CANONICAL_FRAME_GENERATION_VERSION,
    });
  });

  it('pins every exact confidence-bound gate threshold', () => {
    expect(HYDE_GATE_THRESHOLDS).toEqual({
      groundingDeltaCiUpperExclusive: 0,
      frameGroundingCiUpperInclusive: 0.05,
      precisionAt5DeltaCiLowerInclusive: -0.05,
      ndcgAt5DeltaCiLowerInclusive: -0.05,
      marginDeltaCiLowerInclusive: -0.03,
      hardNegativeFprDeltaCiUpperInclusive: 0.02,
      frameAllRejectedCiUpperInclusive: 0.05,
      frameFailedOpenCiUpperInclusive: 0.02,
    });
  });
});
