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
import { abSideIssues } from '../../../../../packages/protocol/eval/ops/ops.sides';
import { ENV_FLAG_METADATA, envValueIssueForKey } from '../../../../../packages/protocol/eval/ops/ops.metadata';
import { DISCOVERY_ENV_KEYS, ENV_VALUE_RULES as ENGINE_ENV_VALUE_RULES, assertAbEnvConfig } from '../discovery.flags';

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

describe('the engine and the site refuse the same values', () => {
  /**
   * The two validators are separate implementations by necessity — the site is
   * bundled for a browser and cannot import the engine's module — so the only
   * thing keeping them honest is a test that runs both.
   *
   * A disagreement in either direction is a real failure. If the site is
   * laxer, an operator launches a run that dies seconds later at the engine,
   * after the branch reset. If the engine is laxer, the site refuses a
   * configuration that would have worked, and the flag looks broken.
   */
  it.each([
    ['DISCOVERY_PROFILE_SOURCE', 'user-context'],
    ['DISCOVERY_PROFILE_SOURCE', 'user_context'],
    ['DISCOVERY_ALLOWED_TYPES', 'intent,nonsense'],
    ['DISCOVERY_ALLOWED_TYPES', 'intent'],
    ['NEGOTIATOR_STANCE', 'firm'],
    ['NEGOTIATOR_STANCE', 'skeptic'],
    ['DISCOVERY_SOURCE_PREMISE_LIMIT', '-5'],
    ['DISCOVERY_SOURCE_PREMISE_LIMIT', '40'],
    ['DISCOVERY_REJECTION_COOLDOWN_DAYS', '0'],
    ['POOL_QUESTIONS_MODE', 'on'],
    ['OPENROUTER_API_KEY', 'sk-test'],
  ])('agrees about %s=%s', (key, value) => {
    let engineAccepts = true;
    try { assertAbEnvConfig({ [key]: value }); } catch { engineAccepts = false; }
    const siteAccepts = abSideIssues({ a: { [key]: value }, b: { [key]: `${value}-other` } })
      .filter((issue) => issue.path[0] === 'a' && issue.path[1] === key)
      .length === 0;
    expect(engineAccepts, `engine ${engineAccepts ? 'accepts' : 'refuses'}, site ${siteAccepts ? 'accepts' : 'refuses'}`)
      .toBe(siteAccepts);
  });

  /**
   * The hand-picked cases above cover eleven pairs. That left a whole FIELD
   * invisible: the engine's rule type had no `max`, so NEGOTIATOR_TURN_TIMEOUT_MS
   * lost the MAX_SAFE_INTEGER ceiling the site enforces and a CLI-direct run
   * could still reach AbortSignal.timeout() out of range. No sampled pair
   * exercised it.
   *
   * So the cross-check is exhaustive over every shared key and every field. A
   * field added to ENV_FLAG_METADATA and not carried into the generator's
   * template now fails here instead of waiting for someone to sample it.
   */
  it('carries every metadata field for every offered key', () => {
    const offered = ENV_FLAG_METADATA.filter((meta) => DISCOVERY_ENV_KEYS.includes(meta.key));
    // Exact, not `> 0`: a count that only has to be positive would still pass if
    // the catalogue collapsed to one key, which is the failure this guards.
    expect(offered.length).toBe(DISCOVERY_ENV_KEYS.length);

    for (const meta of offered) {
      const rule = ENGINE_ENV_VALUE_RULES[meta.key];
      expect(rule, `${meta.key} is offered by the site but has no engine rule`).toBeDefined();

      // Compared as whole objects rather than field by field. Naming the fields
      // here is what let `max` be added to ENV_FLAG_METADATA and not to the
      // generator's template without a test noticing: a hardcoded list pins the
      // fields it happens to mention and is silent about the next one. The
      // projection is taken from the METADATA's own keys, minus the ones that
      // are documentation rather than validation, so a sixth validation field
      // fails here the day it is added.
      const DOC_ONLY = new Set(['key', 'label', 'description', 'defaultDescription']);
      const validationFields = Object.keys(meta).filter((field) => !DOC_ONLY.has(field));
      const project = (source: Record<string, unknown>) =>
        Object.fromEntries(validationFields.map((field) => [field, source[field] ?? undefined]));
      expect(project(rule as unknown as Record<string, unknown>), `${meta.key} validation fields`)
        .toEqual(project(meta as unknown as Record<string, unknown>));
    }
  });

  /**
   * The phantom-difference case, in the one kind that could still produce it.
   *
   * Every `number` read site parses with Number.parseFloat; validating with
   * Number() accepted '0x10' as sixteen days while the graph read NaN and fell
   * back to its 7-day default. Both sides then ran the SAME configuration while
   * the artifact's configDiff named a difference — the exact outcome an A/B run
   * must never produce. `integer` was never exposed, because its /^\d+$/ shape
   * rejects these already — and the integer case below is what makes that a
   * guard rather than an assertion about today: relaxing that regex to anything
   * Number()-shaped would otherwise pass this whole suite.
   */
  it.each(['0x10', '0b110', '0o17', '7abc', '1.2.3'])('refuses %s for a number flag, in both validators', (value) => {
    let engineAccepts = true;
    try { assertAbEnvConfig({ DISCOVERY_REJECTION_COOLDOWN_DAYS: value }); } catch { engineAccepts = false; }
    expect(engineAccepts, 'engine').toBe(false);
    expect(envValueIssueForKey('DISCOVERY_REJECTION_COOLDOWN_DAYS', value), 'site').not.toBeNull();
  });

  it.each(['0x10', '0b110', '0o17', '7abc', '1.2.3', ' 7', '7 ', '+7', '1e3'])(
    'refuses %s for an integer flag, in both validators',
    (value) => {
      // The parallel the docblock above promised and did not have. Every one of
      // these is Number()-parseable or Number-adjacent, and the integer read
      // site (optionalInt, /^\d+$/) honours none of them: it falls back to the
      // graph's own default while the artifact reports the operator's value.
      let engineAccepts = true;
      try { assertAbEnvConfig({ DISCOVERY_SOURCE_PREMISE_LIMIT: value }); } catch { engineAccepts = false; }
      expect(engineAccepts, 'engine').toBe(false);
      expect(envValueIssueForKey('DISCOVERY_SOURCE_PREMISE_LIMIT', value), 'site').not.toBeNull();
    },
  );

  it.each(['0', '7', '40'])('still accepts %s for an integer flag, in both validators', (value) => {
    expect(() => assertAbEnvConfig({ DISCOVERY_SOURCE_PREMISE_LIMIT: value })).not.toThrow();
    expect(envValueIssueForKey('DISCOVERY_SOURCE_PREMISE_LIMIT', value)).toBeNull();
  });

  it.each(['7', '0.5', '1e3', '.5'])('still accepts %s for a number flag, in both validators', (value) => {
    expect(() => assertAbEnvConfig({ DISCOVERY_REJECTION_COOLDOWN_DAYS: value })).not.toThrow();
    expect(envValueIssueForKey('DISCOVERY_REJECTION_COOLDOWN_DAYS', value)).toBeNull();
  });
});

describe('assertAbEnvConfig', () => {
  it('accepts a config drawn from the offered flags', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: 'intent' })).not.toThrow();
  });

  it('accepts a flag the nine-key pin refused', () => {
    expect(() => assertAbEnvConfig({ NEGOTIATOR_STANCE: 'skeptic' })).not.toThrow();
  });

  it('refuses a key the graph cannot reach, naming it', () => {
    expect(() => assertAbEnvConfig({ POOL_QUESTIONS_MODE: 'on' })).toThrow(/POOL_QUESTIONS_MODE/);
  });

  it('refuses a credential for the real reason, not a false one', () => {
    // The graph *does* read OPENROUTER_API_KEY. It is unofferable because it is
    // a credential, so "is not readable by the discovery graph" would be false
    // and would send an operator hunting for a code path that is right there.
    expect(() => assertAbEnvConfig({ OPENROUTER_API_KEY: 'sk-test' })).toThrow(/is a credential/);
    expect(() => assertAbEnvConfig({ OPENROUTER_API_KEY: 'sk-test' })).not.toThrow(/not readable/);
  });

  it('refuses a value the graph would silently fall back from', () => {
    // The defect this check exists for: `user-context` with a hyphen is not a
    // value the read site knows, and it does not fail there — it warns once and
    // runs `premise`. Without this the run measures the default and the artifact
    // records what the operator typed.
    expect(() => assertAbEnvConfig({ DISCOVERY_PROFILE_SOURCE: 'user-context' }))
      .toThrow(/must be one of: premise, user_context/);
    expect(() => assertAbEnvConfig({ DISCOVERY_PROFILE_SOURCE: 'user_context' })).not.toThrow();
  });

  it('refuses an out-of-shape value for each kind it validates', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_SOURCE_PREMISE_LIMIT: '-5' })).toThrow(/must be an integer/);
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: 'intent,nonsense' }))
      .toThrow(/comma-separated list of: intent, profile/);
    expect(() => assertAbEnvConfig({ DISCOVERY_REJECTION_COOLDOWN_DAYS: '0' })).toThrow(/positive number/);
  });

  it('refuses an empty value, because unset and empty are not the same thing', () => {
    expect(() => assertAbEnvConfig({ DISCOVERY_ALLOWED_TYPES: '   ' })).toThrow(/DISCOVERY_ALLOWED_TYPES/);
  });
});
