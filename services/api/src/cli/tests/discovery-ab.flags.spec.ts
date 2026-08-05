import { describe, expect, it } from 'bun:test';
import path from 'node:path';

// The allowlist is imported, never re-typed: a hand-kept copy would silently
// stop noticing a seventeenth flag added at the source of truth, which is the
// same drift this module exists to prevent. Imported by path because
// @indexnetwork/protocol only exports its built `dist` entry point, and
// ops.allowlist.ts is deliberately dependency-free so any consumer can read it.
import { DISCOVERY_AB_ENV_KEYS, PROFILE_ENV_ALLOWLIST } from '../../../../../packages/protocol/eval/ops/ops.allowlist';
import { AB_FLAGS, assertAbEnvConfig, reachableEnvKeys } from '../discovery-ab.flags';

const GRAPH_ENTRY = path.resolve(
  import.meta.dir,
  '../../../../../packages/protocol/src/opportunity/application/opportunity.graph.ts',
);

describe('AB_FLAGS', () => {
  it('is exactly the set of allowlisted keys the discovery graph can reach', () => {
    const reachable = reachableEnvKeys(GRAPH_ENTRY, PROFILE_ENV_ALLOWLIST);
    expect([...reachable].sort()).toEqual([...AB_FLAGS].sort());
  });

  it('is exactly the list the eval-ops site offers, by import rather than by eye', () => {
    // The site cannot import AB_FLAGS (this module needs node:fs and the browser
    // bundle cannot have it) and this module cannot import DISCOVERY_AB_ENV_KEYS
    // in production code (services/api's tsconfig sets rootDir ./src, so a
    // relative import of a protocol file is TS6059, and @indexnetwork/protocol
    // exports only its built root entry). So the two lists are compared here,
    // where a spec file may reach across: the site offering a key the harness
    // does not honour is a control that moves nothing, and the reverse is a
    // comparison the site cannot express.
    expect([...DISCOVERY_AB_ENV_KEYS].sort()).toEqual([...AB_FLAGS].sort());
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
