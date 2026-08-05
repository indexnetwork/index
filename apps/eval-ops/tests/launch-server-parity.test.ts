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
import { validateConfigOverrides, resolveAdHoc, resolveProfile } from '../../../packages/protocol/eval/ops/ops.profiles';
import { envValueIssueForKey, modelMapBounds } from '../../../packages/protocol/eval/ops/ops.metadata';
import { abSideIssues, singleConfigIssues, SUPPORTS_SIDES } from '../../../packages/protocol/eval/ops/ops.sides';
import { HARNESS_ENV_KEYS } from '../../../packages/protocol/eval/ops/ops.envcatalog';
import { readableEnv } from '../../../packages/protocol/eval/ops/ops.envreach';
import { MODEL_OVERRIDE_KEY } from '../src/routes/Launch';
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
  const env = Object.keys(state.env ?? {}).length > 0;
  // Per column, because a scorecard A/B posts one spec per column and the env
  // rows are shared by both: a config on the CANDIDATE column drops that shared
  // env from the candidate's spec while the reference's spec still carries it.
  // Reading only `profile.reference` hid exactly that state.
  const columns: ('reference' | 'candidate')[] = state.ab ? ['reference', 'candidate'] : ['reference'];
  return columns.some((column) => {
    const models = column === 'reference' ? Object.keys(state.models ?? {}).length > 0 : false;
    return profile[column] !== 'default' && (models || env);
  });
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

/**
 * One column of the env rows, as the wire carries it.
 *
 * Mirrors Launch.tsx's `sidesFromRows`/`envFromRows` exactly, INCLUDING the
 * detail that decides whether a row is a parity case at all: a keyed row with no
 * value in this column contributes `''`, it is not omitted. This once filtered
 * such rows out, which made the asymmetric-keys row describe a spec the form
 * cannot post — the two layers then agreed for the wrong reason (a symmetry
 * refusal here, an empty-value refusal in the real form).
 */
function envFromRows(env: Record<string, Record<string, string>>, column: string): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([key, values]) => [key, values[column] ?? '']));
}

/**
 * The spec the form would POST for this state — Launch.tsx's `buildSidesSpec`
 * and `buildSpec`, including the `profile === 'default' && hasOverrides` gate
 * that decides whether `overrides` is sent at all.
 */
function buildSpec(state: FormState, column: 'reference' | 'candidate' = 'reference'): Record<string, unknown> {
  const profile = state.profile?.[column] ?? 'default';
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
  // Per column, exactly as Launch.tsx's buildSpec is called once per side for a
  // scorecard A/B: the env rows are SHARED by both specs, while the profile and
  // the models are the column's own. Modelling only the reference column made
  // this file blind to a candidate-column config dropping the shared env.
  const models = column === 'reference' ? state.models ?? {} : {};
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

/** Every spec this state posts: two for a scorecard A/B, one otherwise. */
function buildSpecs(state: FormState): Record<string, unknown>[] {
  return state.ab && !carriesSides(state)
    ? [buildSpec(state, 'reference'), buildSpec(state, 'candidate')]
    : [buildSpec(state)];
}

/**
 * Whether the FORM would let this state launch — Launch.tsx's `launchBlocked`,
 * restricted to the env/model/config terms this matrix varies.
 *
 * "Restricted to" is load-bearing and was once wrong: this omitted `envEmpty`,
 * which IS one of those terms, and the omission cancelled against the server
 * model's own missing layer to make the headline row assert the opposite of the
 * truth. Every term of `launchBlocked` that a row of this matrix can vary is
 * here; the ones that are not — `invalidSelectionFlags`, `flagIssues`,
 * `envIncomplete` — are functions of the selection/scoring controls and the
 * per-row text inputs, which no row varies (`FormState` cannot express them),
 * and `formCoversEveryVariedTerm` below pins that.
 */
function formVerdict(
  state: FormState,
  savedConfigs: Record<string, { models: Record<string, string>; env: Record<string, string> }> = {},
): { blocked: boolean; why: string[] } {
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

  // envEmpty (Launch.tsx). A sides-capable harness must configure SOMETHING, in
  // either shape — and for the single shape under a named config, "something"
  // means something THIS HARNESS READS, which is the server's own question.
  if (SUPPORTS_SIDES[state.harness] && Object.keys(env).length === 0) {
    const config = sides || profile.reference === 'default'
      ? undefined
      : savedConfigs[profile.reference];
    const configConfigures = config !== undefined
      && (Object.keys(readableEnv(state.harness, config.env ?? {})).length > 0
        || Object.keys(config.models ?? {}).length > 0);
    if (sides || profile.reference === 'default' || !configConfigures) why.push('envEmpty');
  }

  // modelOverrideConflict (Launch.tsx): the per-agent pickers and a typed
  // EVAL_MODEL_OVERRIDES row both write the same key, and the pickers win, so
  // the typed value would be silently discarded.
  const typedOverride = Object.keys(env).includes(MODEL_OVERRIDE_KEY);
  if (typedOverride && Object.keys(models).length > 0) why.push('modelOverrideConflict');

  // configEnvConflict / configModelConflict: gated on the spec's shape.
  if (!sides) {
    const columns: ('reference' | 'candidate')[] = state.ab ? ['reference', 'candidate'] : ['reference'];
    for (const column of columns) {
      if (profile[column] !== 'default' && Object.keys(env).length > 0) {
        why.push(`configEnvConflict:${column}`);
      }
      // Launch.tsx's configModelConflict checks BOTH columns; the models a row
      // can express are the reference column's, so the candidate term is
      // unreachable from FormState rather than absent from the rule.
      if (profile[column] !== 'default' && column === 'reference' && Object.keys(models).length > 0) {
        why.push(`configModelConflict:${column}`);
      }
    }
  }

  return { blocked: why.length > 0, why };
}

/**
 * Whether the SERVER would accept the posted spec — every content check on the
 * real `launchRun` path, in its order.
 *
 * `launchRun` is a Response-returning handler over a live OpsContext (a queue, a
 * config store, a profiles directory, a serverEnv), so calling it here would
 * mean standing up that context and would test the harness's plumbing rather
 * than its rules. What is modelled instead is every check that can refuse
 * BECAUSE OF THE SPEC'S CONTENT, which is what the form can and must anticipate.
 *
 * Deliberately not modelled, because no form state can predict them: the
 * 409s (`resetInFlight`, `exclusiveConflict` — server-wide state), the 503
 * (`resolveHarnessEnvironment` — this deployment's credentials), and the body
 * parse. A form cannot know them before POSTing, so they are not parity failures.
 *
 * THE ORDER MATTERS AND SO DOES THE COUNT: this model went one layer short once
 * already, and the row it made green was the exact case the fix was about. The
 * fourth check below — `singleConfigIssues` AFTER resolution — cannot be folded
 * into RunSpecSchema, which is synchronous and cannot read a named config's env
 * from a file or a store (ops.argv.ts says so in prose). `serverRefusalSites`
 * pins the count, so a fifth check added to launchRun fails this file rather
 * than silently escaping the matrix.
 */
function serverVerdict(
  spec: Record<string, unknown>,
  savedConfigs: Record<string, { models: Record<string, string>; env: Record<string, string> }> = {},
): { refused: boolean; why: string[] } {
  const harness = spec.harness as OpsHarness;

  // 1. RunSpecSchema (ops.server.ts, `RunSpecSchema.safeParse`).
  const parsed = RunSpecSchema.safeParse(spec);
  if (!parsed.success) {
    return { refused: true, why: parsed.error.issues.map((i) => i.message) };
  }

  // 2 & 3. Resolution: ad-hoc overrides are validated against this harness, a
  //        named config is looked up and resolved.
  const overrides = (spec as { overrides?: { models: Record<string, string>; env: Record<string, string> } }).overrides;
  const profileName = spec.profile as string;
  let resolvedEnv: Record<string, string>;
  if (overrides !== undefined) {
    const issues = validateConfigOverrides(overrides, harness);
    if (issues.length > 0) return { refused: true, why: issues };
    resolvedEnv = resolveAdHoc(overrides).env;
  } else if (profileName !== 'default') {
    const config = savedConfigs[profileName];
    if (config === undefined) return { refused: true, why: [`Unknown profile "${profileName}"`] };
    try {
      resolvedEnv = resolveProfile({ name: profileName, description: 'test', ...config }).env;
    } catch (error) {
      return { refused: true, why: [error instanceof Error ? error.message : String(error)] };
    }
  } else {
    resolvedEnv = {};
  }

  // 4. The post-resolution check, and the reason this function exists in this
  //    shape: only here is a named config's env knowable.
  if (SUPPORTS_SIDES[harness] && (spec as { sides?: unknown }).sides === undefined) {
    const issues = singleConfigIssues(readableEnv(harness, resolvedEnv));
    if (issues.length > 0) return { refused: true, why: issues.map((issue) => issue.message) };
  }

  return { refused: false, why: [] };
}

const SCORECARDS = ['matching', 'profile', 'premise', 'opportunity'] as const;
const SAVED = {
  'discovery-premise': { models: {}, env: { DISCOVERY_PROFILE_SOURCE: 'premise' } },
  // A config that is legal everywhere and configures NOTHING on discovery:
  // SMARTEST_VERIFIER_MODEL is read by the four scorecard harnesses and is
  // absent from the 26-key discovery catalogue. Launching discovery under it is
  // the state that reached a 400 after the operator confirmed the spend.
  'judge-only': { models: {}, env: { SMARTEST_VERIFIER_MODEL: 'google/gemini-2.5-flash' } },
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

  // --- discovery under a saved config: readable vs not (B3) -----------------
  {
    // The config sets a key discovery DOES read, so both layers accept it.
    name: 'discovery single, saved config this harness reads',
    state: {
      harness: 'discovery',
      ab: false,
      profile: { reference: 'discovery-premise', candidate: 'default' },
    },
    savedConfigs: SAVED,
  },
  {
    // The config is legal, but names nothing discovery reads. The server answers
    // 400 after resolution; the form must block it before the confirmation.
    name: 'discovery single, saved config this harness reads NOTHING of (B3)',
    state: {
      harness: 'discovery',
      ab: false,
      profile: { reference: 'judge-only', candidate: 'default' },
    },
    savedConfigs: SAVED,
  },

  // --- a scorecard harness with A/B on (C5) ---------------------------------
  // Every other ab:true row is discovery, which posts ONE sides spec. A
  // scorecard harness with A/B ticked posts two ordinary specs and takes the
  // per-column path instead, so without this the form's other A/B shape was
  // unexercised here.
  {
    name: 'matching A/B: valid env, both columns default',
    state: {
      harness: 'matching',
      ab: true,
      env: { CHAT_MODEL: { [SINGLE]: 'google/gemini-2.5-flash' } },
    },
  },
  {
    name: 'matching A/B: a saved config on the candidate column plus typed env',
    state: {
      harness: 'matching',
      ab: true,
      profile: { reference: 'default', candidate: 'discovery-premise' },
      env: { CHAT_MODEL: { [SINGLE]: 'google/gemini-2.5-flash' } },
    },
    savedConfigs: SAVED,
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
  {
    // C4: the pair shape's own bounds pin. The single shape had one
    // (`discovery single: EVAL_MODEL_OVERRIDES naming an unknown agent`), so
    // dropping modelMapBounds() from sideConfigIssues failed only that row and
    // the claim that the fix "closes the same hole on the discovery path" rested
    // on the single shape alone. A value invalid ONLY under bounds, on both
    // sides, differing, symmetric: nothing but the bounds check can refuse it.
    name: 'discovery pair: EVAL_MODEL_OVERRIDES unknown agent on BOTH sides (C4)',
    state: {
      harness: 'discovery',
      ab: true,
      env: {
        EVAL_MODEL_OVERRIDES: {
          a: '{"notAnAgent":"google/gemini-2.5-flash"}',
          b: '{"alsoNotAnAgent":"google/gemini-2.5-flash"}',
        },
      },
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
      const form = formVerdict(row.state, row.savedConfigs ?? {});
      const specs = buildSpecs(row.state);
      const spec = specs[0]!;
      // A scorecard A/B posts two specs and the operator gets one refusal if
      // EITHER is refused, so the server's verdict is the disjunction.
      const verdicts = specs.map((candidate) => serverVerdict(candidate, row.savedConfigs ?? {}));
      const server = {
        refused: verdicts.some((verdict) => verdict.refused),
        why: verdicts.flatMap((verdict) => verdict.why),
      };

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
    // Restricted to rows the picker could produce. The unreachable rows assert
    // `form.blocked === form.blocked` — a tautology — so counting them here
    // would let this pass while every REAL row shared one verdict.
    const verdicts = MATRIX
      .filter((row) => reachableFromPicker(row.state))
      .map((row) => buildSpecs(row.state).some((spec) => serverVerdict(spec, row.savedConfigs ?? {}).refused));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it('exercises both verdicts of the FORM too', () => {
    const verdicts = MATRIX
      .filter((row) => reachableFromPicker(row.state))
      .map((row) => formVerdict(row.state, row.savedConfigs ?? {}).blocked);
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
      const refused = buildSpecs(row.state).some((spec) => serverVerdict(spec, row.savedConfigs ?? {}).refused);
      expect(refused, `${row.name}: server must refuse what the picker cannot offer`).toBe(true);
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

  it('exercises a config that configures nothing THIS harness reads', () => {
    // The B3 state. Without a row of this shape the matrix cannot see the
    // difference between "a config is selected" and "the config configures this
    // harness", which is the distinction the form got wrong.
    const rows = MATRIX.filter((row) => {
      const name = row.state.profile?.reference;
      if (name === undefined || name === 'default' || row.savedConfigs === undefined) return false;
      const config = row.savedConfigs[name as keyof typeof SAVED];
      return config !== undefined
        && Object.keys(readableEnv(row.state.harness, config.env)).length === 0
        && Object.keys(config.models).length === 0;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it('exercises a scorecard harness with A/B on', () => {
    // The form's other A/B shape: two ordinary specs rather than one sides spec.
    expect(MATRIX.some((row) => row.state.ab && !SUPPORTS_SIDES[row.state.harness])).toBe(true);
  });
});

describe('the server model is the whole server', () => {
  /**
   * The count of content refusals on `launchRun`, pinned.
   *
   * `serverVerdict` models the server rather than calling it, and a model that
   * silently falls behind the thing it models is worse than no model: this file
   * shipped once with the post-resolution check missing, and the row that made
   * green was the exact defect the commit was fixing.
   *
   * So the source is read and its `return json({...}, 400)` sites counted. A new
   * one fails here, naming this file, rather than being quietly excluded from
   * every row of the matrix. The 409/503 sites are excluded by status code:
   * they are server state and deployment configuration, which no form can
   * anticipate.
   */
  it('has a check for every 400 the launch path can return', async () => {
    // node:fs rather than Bun.file, so this guard runs under a bare `vitest`
    // too; and a path from the app root rather than import.meta.url, because
    // vitest serves test modules under a `/@fs` prefix that does not exist on
    // disk.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      `${process.cwd()}/../../packages/protocol/eval/ops/ops.server.ts`,
      'utf8',
    );
    const start = source.indexOf('async function launchRun(');
    expect(start, 'launchRun not found; this guard is reading the wrong file').toBeGreaterThan(-1);
    // To the next top-level function declaration.
    const rest = source.slice(start + 1);
    const end = rest.search(/\n(?:async )?function /);
    const body = end === -1 ? rest : rest.slice(0, end);

    const four00s = [...body.matchAll(/,\s*400\s*\)/g)].length;
    expect(
      four00s,
      'launchRun gained or lost a 400. serverVerdict in this file models the server\'s content '
        + 'checks; update it to match, then update this count. The four modelled are: RunSpecSchema, '
        + 'validateConfigOverrides, unknown profile, and the post-resolution singleConfigIssues '
        + '(which has two returns: the named-config message and the general one).',
    ).toBe(5);
  });
});
