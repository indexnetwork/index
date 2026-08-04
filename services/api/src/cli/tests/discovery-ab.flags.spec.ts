import { describe, expect, it } from 'bun:test';
import path from 'node:path';

import { AB_FLAGS, assertAbEnvConfig, reachableEnvKeys } from '../discovery-ab.flags';

const PROFILE_ENV_ALLOWLIST = [
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'INTRODUCER_DISCOVERY_ENABLED',
  'NEGOTIATION_EVIDENCE_QUESTIONS_MODE',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'OUTCOME_QUESTIONS_MODE',
  'POOL_QUESTIONS_MINING',
  'POOL_QUESTIONS_MODE',
  'POOL_QUESTIONS_PUSH',
  'POOL_QUESTIONS_RANKING',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
];

const GRAPH_ENTRY = path.resolve(
  import.meta.dir,
  '../../../../../packages/protocol/src/opportunity/application/opportunity.graph.ts',
);

describe('AB_FLAGS', () => {
  it('is exactly the set of allowlisted keys the discovery graph can reach', () => {
    const reachable = reachableEnvKeys(GRAPH_ENTRY, PROFILE_ENV_ALLOWLIST);
    expect([...reachable].sort()).toEqual([...AB_FLAGS].sort());
  });

  it('offers nine flags and excludes every queue-only key', () => {
    expect(AB_FLAGS).toHaveLength(9);
    for (const key of [
      'POOL_QUESTIONS_MODE',
      'POOL_QUESTIONS_PUSH',
      'POOL_QUESTIONS_RANKING',
      'POOL_QUESTIONS_MINING',
      'OUTCOME_QUESTIONS_MODE',
      'NEGOTIATION_EVIDENCE_QUESTIONS_MODE',
      'INTRODUCER_DISCOVERY_ENABLED',
    ]) {
      expect(AB_FLAGS).not.toContain(key);
    }
  });
});

describe('assertAbEnvConfig', () => {
  it('accepts a config drawn from the offered flags', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: 'intent' })).not.toThrow();
  });

  it('refuses a key the graph cannot reach, naming it', () => {
    expect(() => assertAbEnvConfig({ POOL_QUESTIONS_MODE: 'on' })).toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses an empty value, because unset and empty are not the same thing', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: '   ' })).toThrow(/DISCOVERY_ALLOWED_TYPES/);
  });
});
