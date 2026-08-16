import { afterEach, describe, expect, it } from 'bun:test';
import { DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT, DISCOVERY_MIN_SIMILARITY_DEFAULT, discoveryAllowedTypes, discoveryEvaluatorMinScore, discoveryIntentMatchingEnabled, discoveryMinSimilarity, discoveryProfileMatchingEnabled, discoveryProfileSource, resetDiscoveryEnvWarningsForTests, validateDiscoveryEvaluatorMinScore, validateDiscoveryMinSimilarity } from '../discovery.env.js';

const VARS = [
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_MIN_SIMILARITY',
  'DISCOVERY_EVALUATOR_MIN_SCORE',
] as const;
const saved: Record<string, string | undefined> = {};
for (const v of VARS) saved[v] = process.env[v];

afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
  resetDiscoveryEnvWarningsForTests();
});

describe('discovery thresholds', () => {
  it('uses existing defaults for absent and blank values', () => {
    delete process.env.DISCOVERY_MIN_SIMILARITY;
    process.env.DISCOVERY_EVALUATOR_MIN_SCORE = '   ';
    expect(discoveryMinSimilarity()).toBe(DISCOVERY_MIN_SIMILARITY_DEFAULT);
    expect(discoveryEvaluatorMinScore()).toBe(DISCOVERY_EVALUATOR_MIN_SCORE_DEFAULT);
  });

  it('parses finite decimal values and inclusive boundaries', () => {
    for (const [raw, expected] of [['0', 0], ['.35', 0.35], ['1.0', 1]] as const) {
      process.env.DISCOVERY_MIN_SIMILARITY = raw;
      expect(discoveryMinSimilarity()).toBe(expected);
    }
    for (const [raw, expected] of [['0', 0], ['62.5', 62.5], ['100', 100]] as const) {
      process.env.DISCOVERY_EVALUATOR_MIN_SCORE = raw;
      expect(discoveryEvaluatorMinScore()).toBe(expected);
    }
  });

  it.each(['nope', 'NaN', 'Infinity', '0x1', '-0', '-0.01', '1e0', '1.01'])(
    'rejects invalid similarity %s',
    (raw) => {
      process.env.DISCOVERY_MIN_SIMILARITY = raw;
      expect(() => discoveryMinSimilarity()).toThrow('DISCOVERY_MIN_SIMILARITY');
    },
  );

  it.each(['nope', 'NaN', 'Infinity', '0x32', '-0', '-1', '5e1', '100.01'])(
    'rejects invalid evaluator score %s',
    (raw) => {
      process.env.DISCOVERY_EVALUATOR_MIN_SCORE = raw;
      expect(() => discoveryEvaluatorMinScore()).toThrow('DISCOVERY_EVALUATOR_MIN_SCORE');
    },
  );

  it('validates numeric constructor values', () => {
    expect(validateDiscoveryMinSimilarity(0.42)).toBe(0.42);
    expect(validateDiscoveryEvaluatorMinScore(63)).toBe(63);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    'rejects invalid numeric similarity %s',
    (value) => {
      expect(() => validateDiscoveryMinSimilarity(value)).toThrow('DISCOVERY_MIN_SIMILARITY');
    },
  );

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, -1, 100.01])(
    'rejects invalid numeric evaluator score %s',
    (value) => {
      expect(() => validateDiscoveryEvaluatorMinScore(value)).toThrow('DISCOVERY_EVALUATOR_MIN_SCORE');
    },
  );
});

describe('discoveryAllowedTypes', () => {
  it('defaults to intent+profile when unset', () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
    expect(discoveryIntentMatchingEnabled()).toBe(true);
    expect(discoveryProfileMatchingEnabled()).toBe(true);
  });

  it('defaults to intent+profile when empty', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = '';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });

  it('parses intent-only', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    expect(discoveryIntentMatchingEnabled()).toBe(true);
    expect(discoveryProfileMatchingEnabled()).toBe(false);
  });

  it('parses profile-only', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'profile';
    expect(discoveryIntentMatchingEnabled()).toBe(false);
    expect(discoveryProfileMatchingEnabled()).toBe(true);
  });

  it('normalizes case and whitespace', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = ' Intent , PROFILE ';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });

  it('warns and ignores unknown tokens, keeping valid ones', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent,foo';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent']));
  });

  it('treats premises/user_context tokens as unknown', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent,premise,user_context';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent']));
  });

  it('falls back to both-allowed when no valid tokens remain', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'foo,bar';
    expect(discoveryAllowedTypes()).toEqual(new Set(['intent', 'profile']));
  });
});

describe('discoveryProfileSource', () => {
  it('defaults to premise when unset or empty', () => {
    delete process.env.DISCOVERY_PROFILE_SOURCE;
    expect(discoveryProfileSource()).toBe('premise');
    process.env.DISCOVERY_PROFILE_SOURCE = '';
    expect(discoveryProfileSource()).toBe('premise');
  });

  it('parses user_context', () => {
    process.env.DISCOVERY_PROFILE_SOURCE = 'user_context';
    expect(discoveryProfileSource()).toBe('user_context');
  });

  it('normalizes case/whitespace and falls back to premise on garbage', () => {
    process.env.DISCOVERY_PROFILE_SOURCE = ' User_Context ';
    expect(discoveryProfileSource()).toBe('user_context');
    process.env.DISCOVERY_PROFILE_SOURCE = 'heavy';
    expect(discoveryProfileSource()).toBe('premise');
  });
});
