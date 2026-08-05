/**
 * The launch form and the server, on the same specs, in both directions.
 *
 * WHY THIS FILE EXISTS
 *
 * `fetch` is stubbed throughout launch.test.tsx, so every other test of this
 * form asserts form/server agreement BY SHARED IMPORT: the form calls
 * `abSideIssues`, the test calls `abSideIssues`, and both agree because they are
 * one function. That proves the form uses the rule. It cannot prove the rule the
 * form uses is the rule the server enforces, because the server is never
 * consulted — and the server does more than call that one function. It runs
 * `RunSpecSchema` (which composes several rules and adds its own), then
 * `validateConfigOverrides` (which adds the credential and per-harness catalogue
 * checks, and passes BOUNDS the form was omitting).
 *
 * Three defects lived in exactly that gap, and all three needed the server's own
 * functions executed to surface:
 *
 *   - the form blocked a pinned-default discovery pair the server ACCEPTS,
 *     with a message naming a control that was not on screen;
 *   - the form accepted an EVAL_MODEL_OVERRIDES value the server REFUSES,
 *     because it called `envValueIssueForKey` without the bounds that ARE the
 *     rule for that kind — enabled, priced, confirmed, POSTED, then 400;
 *   - the form refused a saved config on discovery that the server accepts.
 *
 * So this file takes the spec the form would POST for a matrix of form states
 * and runs it through the server's own entry points. The contract, stated at
 * ops.sides.ts:8-13: the form must refuse exactly what the server refuses. Both
 * directions are failures, and they fail differently — a form stricter than the
 * server silently removes a legitimate run, and a form looser than the server
 * turns a configuration mistake into a 400 after the operator has committed to
 * the spend.
 *
 * WHAT IS MODELLED HERE, AND THE ONE THING THAT IS NOT
 *
 * `formVerdict` reimplements the form's gate from its real inputs. That is a
 * copy, and a copy can drift — but it is a copy of a BOOLEAN, checked against
 * the server on every row of the matrix, whereas the thing it replaces (a
 * rendered React tree driven by a stubbed fetch) cannot reach the server at all.
 * launch.test.tsx keeps proving the rendered form matches these same rules; this
 * file proves the rules match the server.
 */
import { describe, expect, it } from 'vitest';

import { RunSpecSchema } from '../../../packages/protocol/eval/ops/ops.argv';
import { validateConfigOverrides, resolveProfile } from '../../../packages/protocol/eval/ops/ops.profiles';
import { envValueIssueForKey, modelMapBounds } from '../../../packages/protocol/eval/ops/ops.metadata';
import { abSideIssues, singleConfigIssues, SUPPORTS_SIDES } from '../../../packages/protocol/eval/ops/ops.sides';
import { HARNESS_ENV_KEYS } from '../../../packages/protocol/eval/ops/ops.envcatalog';
import type { OpsHarness } from '../../../packages/protocol/eval/ops/ops.types';

/**
 * Whether the posted spec still carries everything the operator configured.
 *
 * A spec-versus-spec comparison cannot see a SILENT DROP: `buildSpec` sends
 * `overrides` only when the profile is "default", so a run configured with a
 * saved config AND typed models posts neither the models nor the env, and the
 * server accepts it — because by then the evidence is gone. The server is not
 * wrong; it is answering a question about a different run from the one the
 * operator configured.
 *
 * So "the server accepts it" is not sufficient for agreement. A state whose
 * configuration does not survive into the posted spec MUST be blocked by the
 * form, and this is the term that says so. It is the C7 class, and the env
 * sibling that was already fixed.
 */
function dropsConfiguration(state: FormState): boolean {
  if (carriesSides(state)) return false;
  const profile = state.profile ?? { reference: 'default', candidate: 'default' };
  const configured = Object.keys(state.models ?? {}).length > 0 || Object.keys(state.env ?? {}).length > 0;
  return profile.reference !== 'default' && configured;
}

/**
 * Whether the form's flag picker could ever have produced this key for this
 * harness.
 *
 * The form's first line of defence against an unreadable key or a credential is
 * that the control does not offer it: the picker lists exactly
 * `HARNESS_ENV_KEYS[harness]`, from which the generator has already excluded
 * every credential. A state naming a key outside that list is therefore not a
 * form state at all — it is what a hand-written POST looks like, and the server
 * refusing it is the correct and only defence.
 *
 * Modelled explicitly rather than left out, so the matrix can carry those rows
 * (they prove the server refuses them) without claiming the form has a bug for
 * not blocking a control it never rendered.
 */
function reachableFromPicker(state: FormState): boolean {
  const keys = Object.keys(state.env ?? {});
  return keys.every((key) => HARNESS_ENV_KEYS[state.harness].includes(key));
}

/** A form state, in the terms the operator manipulates. */
interface FormState {
  harness: OpsHarness;
  /** A/B ticked. */
  ab: boolean;
  /** Named config per column; 'default' means ad-hoc. */
  profile?: { reference: string; candidate: string };
  /** Per-agent model pickers, reference column. */
  models?: Record<string, string>;
  /** Env rows, as `key -> value per column`. */
  env?: Record<string, Record<string, string>>;
}

const SINGLE = 'single';

/** Whether this state posts a `sides` spec — Launch.tsx's `carriesSides`. */
function carriesSides(state: FormState): boolean {
  return SUPPORTS_SIDES[state.harness] === true && state.ab;
}

function envFromRows(env: Record<string, Record<string, string>>, column: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([, values]) => values[column] !== undefined)
      .map(([key, values]) => [key, values[column]!]),
  );
}

/**
 * The spec the form would POST for this state — Launch.tsx's `buildSidesSpec`
 * and `buildSpec`, including the `profile === 'default' && hasOverrides` gate
 * that decides whether `overrides` is sent at all.
 */
function buildSpec(state: FormState): Record<string, unknown> {
  const profile = state.profile?.reference ?? 'default';
  if (carriesSides(state)) {
    // Note what this does NOT read: state.profile. A sides spec pins "default"
    // unconditionally, which is why a stale config selection cannot reach the
    // server and must not block the run.
    return {
      kind: 'eval',
      harness: state.harness,
      profile: 'default',
      flags: {},
      sides: { a: envFromRows(state.env ?? {}, 'a'), b: envFromRows(state.env ?? {}, 'b') },
    };
  }
  const models = state.models ?? {};
  const env = envFromRows(state.env ?? {}, SINGLE);
  const hasOverrides = Object.keys(models).length > 0 || Object.keys(env).length > 0;
  return {
    kind: 'eval',
    harness: state.harness,
    profile,
    flags: {},
    ...(profile === 'default' && hasOverrides ? { overrides: { models, env } } : {}),
  };
}

/**
 * Whether the FORM would let this state launch — Launch.tsx's `launchBlocked`,
 * restricted to the env/model/config terms this matrix varies.
 */
function formVerdict(state: FormState): { blocked: boolean; why: string[] } {
  const why: string[] = [];
  const env = state.env ?? {};
  const models = state.models ?? {};
  const profile = state.profile ?? { reference: 'default', candidate: 'default' };
  const sides = carriesSides(state);

  // envIssues
  if (Object.keys(env).length > 0) {
    if (sides) {
      why.push(...abSideIssues({ a: envFromRows(env, 'a'), b: envFromRows(env, 'b') }).map((i) => i.message));
    } else if (SUPPORTS_SIDES[state.harness]) {
      why.push(...singleConfigIssues(envFromRows(env, SINGLE)).map((i) => i.message));
    } else {
      for (const [key, value] of Object.entries(envFromRows(env, SINGLE))) {
        const problem = envValueIssueForKey(key, value, modelMapBounds());
        if (problem !== null) why.push(`${key}="${value}" ${problem}`);
      }
    }
  }

  // configEnvConflict / configModelConflict: gated on the spec's shape.
  if (!sides) {
    const columns: ('reference' | 'candidate')[] = state.ab ? ['reference', 'candidate'] : ['reference'];
    for (const column of columns) {
      if (profile[column] !== 'default' && Object.keys(env).length > 0) {
        why.push(`configEnvConflict:${column}`);
      }
      if (profile[column] !== 'default' && column === 'reference' && Object.keys(models).length > 0) {
        why.push(`configModelConflict:${column}`);
      }
    }
  }

  return { blocked: why.length > 0, why };
}

/**
 * Whether the SERVER would accept the posted spec — the real launch path:
 * RunSpecSchema first, then validateConfigOverrides on any ad-hoc overrides,
 * then resolveProfile for a named config.
 */
function serverVerdict(
  spec: Record<string, unknown>,
  savedConfigs: Record<string, { models: Record<string, string>; env: Record<string, string> }> = {},
): { refused: boolean; why: string[] } {
  const parsed = RunSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return { refused: true, why: parsed.error.issues.map((i) => i.message) };
  }
  const overrides = (spec as { overrides?: { models: Record<string, string>; env: Record<string, string> } }).overrides;
  if (overrides !== undefined) {
    const issues = validateConfigOverrides(overrides, spec.harness as OpsHarness);
    if (issues.length > 0) return { refused: true, why: issues };
  }
  const profileName = spec.profile as string;
  if (profileName !== 'default') {
    const config = savedConfigs[profileName];
    if (config === undefined) return { refused: true, why: [`unknown config ${profileName}`] };
    try {
      resolveProfile({ name: profileName, description: 'test', ...config });
    } catch (error) {
      return { refused: true, why: [error instanceof Error ? error.message : String(error)] };
    }
  }
  return { refused: false, why: [] };
}

const SCORECARDS = ['matching', 'profile', 'premise', 'opportunity'] as const;
const SAVED = {
  'discovery-premise': { models: {}, env: { DISCOVERY_PROFILE_SOURCE: 'premise' } },
};

/** One row of the matrix. */
interface Row {
  name: string;
  state: FormState;
  savedConfigs?: typeof SAVED;
}

const MATRIX: Row[] = [
  // --- every harness, no configuration at all -------------------------------
  ...SCORECARDS.map((harness) => ({
    name: `${harness}: bare default run`,
    state: { harness, ab: false } as FormState,
  })),
  {
    name: 'discovery: bare run (configures nothing)',
    state: { harness: 'discovery', ab: false },
  },

  // --- every harness, a valid env value -------------------------------------
  ...SCORECARDS.map((harness) => ({
    name: `${harness}: valid CHAT_MODEL`,
    state: {
      harness,
      ab: false,
      env: { CHAT_MODEL: { [SINGLE]: 'google/gemini-2.5-flash' } },
    } as FormState,
  })),

  // --- the B3 class: EVAL_MODEL_OVERRIDES, whose bounds ARE its rule ---------
  ...SCORECARDS.map((harness) => ({
    name: `${harness}: EVAL_MODEL_OVERRIDES naming an unknown agent`,
    state: {
      harness,
      ab: false,
      env: { EVAL_MODEL_OVERRIDES: { [SINGLE]: '{"notAnAgent":"not/a-model"}' } },
    } as FormState,
  })),
  ...SCORECARDS.map((harness) => ({
    name: `${harness}: EVAL_MODEL_OVERRIDES naming an unselectable model`,
    state: {
      harness,
      ab: false,
      env: { EVAL_MODEL_OVERRIDES: { [SINGLE]: '{"opportunityEvaluator":"evil/backdoor"}' } },
    } as FormState,
  })),
  {
    name: 'discovery single: EVAL_MODEL_OVERRIDES naming an unknown agent',
    state: {
      harness: 'discovery',
      ab: false,
      env: { EVAL_MODEL_OVERRIDES: { [SINGLE]: '{"notAnAgent":"not/a-model"}' } },
    },
  },
  {
    name: 'discovery pair: EVAL_MODEL_OVERRIDES naming an unknown agent on one side',
    state: {
      harness: 'discovery',
      ab: true,
      env: {
        EVAL_MODEL_OVERRIDES: {
          a: '{"notAnAgent":"not/a-model"}',
          b: '{"opportunityEvaluator":"google/gemini-2.5-flash"}',
        },
      },
    },
  },
  {
    name: 'discovery: valid EVAL_MODEL_OVERRIDES both sides, differing',
    state: {
      harness: 'discovery',
      ab: true,
      env: {
        EVAL_MODEL_OVERRIDES: {
          a: '{"opportunityEvaluator":"google/gemini-2.5-flash"}',
          b: '{"opportunityEvaluator":"google/gemini-2.5-flash-lite"}',
        },
      },
    },
  },

  // --- the B2 class: a stale config selection under a sides spec ------------
  {
    name: 'discovery pair with a saved config still selected (B2)',
    state: {
      harness: 'discovery',
      ab: true,
      profile: { reference: 'discovery-premise', candidate: 'default' },
      env: {
        DISCOVERY_ALLOWED_TYPES: { a: 'intent', b: 'intent,profile' },
      },
    },
    savedConfigs: SAVED,
  },

  // --- valid discovery pair, the headline feature ---------------------------
  {
    name: 'discovery pair, differing values',
    state: {
      harness: 'discovery',
      ab: true,
      env: { DISCOVERY_ALLOWED_TYPES: { a: 'intent', b: 'intent,profile' } },
    },
  },
  {
    name: 'discovery pair, identical values (measures noise)',
    state: {
      harness: 'discovery',
      ab: true,
      env: { DISCOVERY_ALLOWED_TYPES: { a: 'intent', b: 'intent' } },
    },
  },
  {
    name: 'discovery pair, asymmetric keys',
    state: {
      harness: 'discovery',
      ab: true,
      env: {
        DISCOVERY_ALLOWED_TYPES: { a: 'intent', b: 'intent,profile' },
        DISCOVERY_CONTEXT_TO_INTENT: { a: '1' },
      },
    },
  },
  {
    name: 'discovery single, one valid flag',
    state: {
      harness: 'discovery',
      ab: false,
      env: { DISCOVERY_ALLOWED_TYPES: { [SINGLE]: 'intent' } },
    },
  },

  // --- invalid values that fall back rather than failing --------------------
  {
    name: 'discovery single, hyphenated profile source (silently falls back)',
    state: {
      harness: 'discovery',
      ab: false,
      env: { DISCOVERY_PROFILE_SOURCE: { [SINGLE]: 'user-context' } },
    },
  },
  {
    name: 'discovery pair, non-integer where an integer is required',
    state: {
      harness: 'discovery',
      ab: true,
      env: { DISCOVERY_SOURCE_PREMISE_LIMIT: { a: 'lots', b: '40' } },
    },
  },

  // --- a key the harness does not read --------------------------------------
  {
    name: 'matching: a key only discovery reads',
    state: {
      harness: 'matching',
      ab: false,
      env: { DISCOVERY_ALLOWED_TYPES: { [SINGLE]: 'intent' } },
    },
  },

  // --- credentials, which no path may set -----------------------------------
  ...SCORECARDS.slice(0, 1).map((harness) => ({
    name: `${harness}: OPENROUTER_API_KEY`,
    state: {
      harness,
      ab: false,
      env: { OPENROUTER_API_KEY: { [SINGLE]: 'sk-stolen' } },
    } as FormState,
  })),

  // --- saved config plus typed env / models (C7 and its env sibling) --------
  {
    name: 'matching: saved config AND typed env',
    state: {
      harness: 'matching',
      ab: false,
      profile: { reference: 'discovery-premise', candidate: 'default' },
      env: { CHAT_MODEL: { [SINGLE]: 'google/gemini-2.5-flash' } },
    },
    savedConfigs: SAVED,
  },
  {
    name: 'matching: saved config AND typed models (C7)',
    state: {
      harness: 'matching',
      ab: false,
      profile: { reference: 'discovery-premise', candidate: 'default' },
      models: { opportunityEvaluator: 'google/gemini-2.5-flash' },
    },
    savedConfigs: SAVED,
  },
  {
    name: 'matching: saved config alone',
    state: {
      harness: 'matching',
      ab: false,
      profile: { reference: 'discovery-premise', candidate: 'default' },
    },
    savedConfigs: SAVED,
  },
];

describe('launch form and server agree on every spec the form can post', () => {
  for (const row of MATRIX) {
    it(row.name, () => {
      const form = formVerdict(row.state);
      const spec = buildSpec(row.state);
      const server = serverVerdict(spec, row.savedConfigs ?? {});

      // What the form OUGHT to do with this state, in three terms:
      //
      //   1. the server would refuse the posted spec        -> block it
      //   2. the configuration would be silently dropped    -> block it
      //   3. the picker could never have produced this key  -> not a form
      //      state; the server's refusal is the whole defence, and the form is
      //      not expected to duplicate it
      //
      // (2) is not redundant with (1): a dropped value is absent from the spec,
      // so the server sees a run it rightly accepts and only the form is in a
      // position to notice.
      const shouldBlock = reachableFromPicker(row.state)
        ? server.refused || dropsConfiguration(row.state)
        : form.blocked;

      // Both directions at once. The message names which way the disagreement
      // went, because the two failures have opposite causes and opposite fixes.
      expect(
        form.blocked,
        form.blocked
          ? `FORM STRICTER THAN SERVER: the form blocks a run the server accepts `
            + `and whose configuration survives into the posted spec, so a legitimate `
            + `run is unreachable from the page.\n`
            + `  form said: ${JSON.stringify(form.why, null, 2)}\n`
            + `  spec: ${JSON.stringify(spec)}`
          : `FORM LOOSER THAN SERVER: the form enables a run that the server refuses `
            + `or whose configuration it would silently drop, so the operator confirms `
            + `a spend and gets a 400 or a run they did not configure.\n`
            + `  server said: ${JSON.stringify(server.why, null, 2)}\n`
            + `  drops configuration: ${dropsConfiguration(row.state)}\n`
            + `  spec: ${JSON.stringify(spec)}`,
      ).toBe(shouldBlock);
    });
  }
});

describe('the matrix covers what it claims to cover', () => {
  // A matrix that silently stopped exercising a harness would keep passing, so
  // the coverage itself is asserted rather than assumed.
  it('exercises every harness', () => {
    const covered = new Set(MATRIX.map((row) => row.state.harness));
    expect([...covered].sort()).toEqual([...Object.keys(HARNESS_ENV_KEYS)].sort());
  });

  it('exercises both shapes of the harness that has two', () => {
    const discovery = MATRIX.filter((row) => row.state.harness === 'discovery');
    expect(discovery.some((row) => carriesSides(row.state))).toBe(true);
    expect(discovery.some((row) => !carriesSides(row.state))).toBe(true);
  });

  it('exercises both verdicts, so neither direction is vacuous', () => {
    const verdicts = MATRIX.map((row) => serverVerdict(buildSpec(row.state), row.savedConfigs ?? {}).refused);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('proves the server refuses every key the picker could not have produced', () => {
    // Term 3 of the contract excuses the FORM from blocking these, on the
    // grounds that the control never offered them. That excuse is only sound if
    // the server really does refuse them, so it is asserted here rather than
    // assumed — otherwise a key that escaped the catalogue would be silently
    // exempted from both layers at once.
    const unreachable = MATRIX.filter((row) => !reachableFromPicker(row.state));
    expect(unreachable.length).toBeGreaterThan(0);
    for (const row of unreachable) {
      const verdict = serverVerdict(buildSpec(row.state), row.savedConfigs ?? {});
      expect(verdict.refused, `${row.name}: server must refuse what the picker cannot offer`).toBe(true);
    }
  });

  it('exercises a silent drop, so term 2 of the contract is not vacuous', () => {
    expect(MATRIX.some((row) => dropsConfiguration(row.state))).toBe(true);
  });

  it('exercises saved configs and ad-hoc overrides', () => {
    expect(MATRIX.some((row) => row.state.profile?.reference !== undefined
      && row.state.profile.reference !== 'default')).toBe(true);
    expect(MATRIX.some((row) => row.state.env !== undefined && row.state.profile === undefined)).toBe(true);
  });
});
