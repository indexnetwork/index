import { describe, expect, it } from 'bun:test';

// The catalogue is imported, never re-typed: a hand-kept copy is exactly the
// drift this module exists to prevent, and the reason the harness once offered
// nine flags when the graph read twenty-six. Imported by path because
// @indexnetwork/protocol only exports its built `dist` entry point, and both
// ops.allowlist.ts and ops.envcatalog.ts are deliberately dependency-free so any
// consumer can read them. Production code here cannot do this — services/api
// sets rootDir ./src, making it TS6059 — but tsconfig excludes specs.
import { HARNESS_ENV_KEYS } from '../../../../../packages/protocol/eval/ops/ops.envcatalog';
import { DISCOVERY_ENV_KEYS as SITE_KEYS, isCredentialEnvKey } from '../../../../../packages/protocol/eval/ops/ops.allowlist';
import { DISCOVERY_ENV_KEYS, assertAbEnvConfig } from '../discovery.flags';

describe('DISCOVERY_ENV_KEYS', () => {
  it('is exactly the generated catalogue for this harness', () => {
    // The engine's copy against the generated source of truth. The catalogue is
    // itself regenerated and diffed by eval/ops/tests/envcatalog.spec.ts, so
    // this chains the engine to a scan of the graph's own import closure
    // without this file needing to run the scanner.
    expect([...DISCOVERY_ENV_KEYS].sort()).toEqual([...HARNESS_ENV_KEYS.discovery].sort());
  });

  it('is exactly the list the eval-ops site offers, by import rather than by eye', () => {
    // The site offering a key the harness does not honour is a control that
    // moves nothing; the reverse is a comparison the site cannot express.
    expect([...SITE_KEYS].sort()).toEqual([...DISCOVERY_ENV_KEYS].sort());
  });

  it('offers no credential, so no configuration can repoint the run', () => {
    // Not a fixed count. A count is the assertion that let nine look correct:
    // it passes for any nine keys, including nine wrong ones. What must hold is
    // that nothing offered is a credential — checked by the same predicate the
    // generator filters with, so a key added to the graph tomorrow is covered.
    for (const key of DISCOVERY_ENV_KEYS) {
      expect(isCredentialEnvKey(key), `${key} is a credential and must not be offerable`).toBe(false);
    }
  });

  it('excludes every key no harness entry point can reach', () => {
    // The queue-only and protocol-only flags of IND-630. They are absent
    // because no scan reaches them, not because a list omits them — if one
    // becomes reachable it should appear here, and this test should be the
    // thing that notices.
    for (const key of [
      'POOL_QUESTIONS_MODE',
      'POOL_QUESTIONS_PUSH',
      'POOL_QUESTIONS_RANKING',
      'POOL_QUESTIONS_MINING',
      'OUTCOME_QUESTIONS_MODE',
      'NEGOTIATION_EVIDENCE_QUESTIONS_MODE',
      'INTRODUCER_DISCOVERY_ENABLED',
    ]) {
      expect(DISCOVERY_ENV_KEYS).not.toContain(key);
    }
  });

  it('offers the flags the nine-key pin wrongly refused', () => {
    // The defect this branch exists to fix, stated as a test: each of these is
    // read by the discovery graph and was refused by a message claiming it was
    // not. Named individually rather than counted, so the assertion says what
    // it means.
    for (const key of [
      'NEGOTIATOR_STANCE',
      'NEGOTIATION_SCREEN_MODE',
      'NEGOTIATION_DEADLOCK_SHIFT_ENABLED',
      'NEGOTIATION_DEADLOCK_THRESHOLD',
      'NEGOTIATION_ASK_USER_ENABLED',
      'NEGOTIATION_ASK_USER_WINDOW_MS',
      'NEGOTIATION_CONSULTATION_POLICY_MODE',
      'NEGOTIATION_PROTOCOL_VERSION',
      'NEGOTIATOR_TURN_TIMEOUT_MS',
      'HYDE_FRAME_CONSTRAINTS_ENABLED',
    ]) {
      expect(DISCOVERY_ENV_KEYS).toContain(key);
    }
  });
});

describe('assertAbEnvConfig', () => {
  it('accepts a config drawn from the offered flags', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: 'intent' })).not.toThrow();
  });

  it('accepts a flag the nine-key pin refused', () => {
    expect(() => assertAbEnvConfig({ NEGOTIATOR_STANCE: 'firm' })).not.toThrow();
  });

  it('refuses a key the graph cannot reach, naming it', () => {
    expect(() => assertAbEnvConfig({ POOL_QUESTIONS_MODE: 'on' })).toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses a credential outright', () => {
    expect(() => assertAbEnvConfig({ OPENROUTER_API_KEY: 'sk-test' })).toThrow(/OPENROUTER_API_KEY/);
  });

  it('refuses an empty value, because unset and empty are not the same thing', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: '   ' })).toThrow(/DISCOVERY_ALLOWED_TYPES/);
  });
});
