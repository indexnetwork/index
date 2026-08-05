import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { HARNESS_ENV_KEYS } from '../../../../packages/protocol/eval/ops/ops.envcatalog';
import { unreadEnvKeys } from '../../../../packages/protocol/eval/ops/ops.envreach';
import { flagValueIssues } from '../../../../packages/protocol/eval/ops/ops.flags';
import { envValueIssueForKey } from '../../../../packages/protocol/eval/ops/ops.metadata';
import { SUPPORTS_SIDES, abSideIssues, singleConfigIssues, sidesPerRun } from '../../../../packages/protocol/eval/ops/ops.sides';
import { Frame } from '../components/Frame';
import { EnvConfigEditor, type EnvFlagRow } from '../components/EnvConfigEditor';
import { ModelOverrideEditor } from '../components/ModelOverrideEditor';
import { api, type AbSides, type AgentMeta, type ConfigMetadata, type ConfigProfile, type EnvFlagMeta, type EvalRunSpec, type FlagMeta, type HarnessDescriptor, type HarnessFlag, type ModelMeta, type OpsHarness, type ProfileDescriptor, type RunFlags } from '../api/client';

/**
 * Flags that decide WHICH cases run. Two runs that disagree here are not
 * comparable at all (the comparison refuses on a selection mismatch), so the
 * A/B form shares one control for these between both sides.
 */
const SELECTION_FLAGS = ['runs', 'case', 'rule', 'tier'] as const;

/** A/B side ids. "reference" runs first, "candidate" second. */
type Side = 'reference' | 'candidate';

/**
 * The single column's id, for a run that measures one configuration.
 *
 * A row carries one value per column, so the single shape needs a column name
 * even though the operator never sees one. Not 'a': that is a side id, and a
 * single run has no sides — using it would make the two shapes indistinguishable
 * in state and invite an `a`-shaped bug into the shape that has no `b`.
 */
const SINGLE_COLUMN = 'single';

const EMPTY_SINGLE_ROW: EnvFlagRow = { key: '', values: { [SINGLE_COLUMN]: '' } };

/** Column ids and headings for each shape, in display order. */
const SINGLE_COLUMNS = [SINGLE_COLUMN] as const;
const SIDE_COLUMNS = ['a', 'b'] as const;
const SINGLE_COLUMN_LABELS: Readonly<Record<string, string>> = { [SINGLE_COLUMN]: '' };
// "A · reference" / "B · candidate": the same vocabulary every other harness
// uses for its two columns. The previous "A · side a" repeated the letter and
// named nothing the operator did not already know.
const SIDE_COLUMN_LABELS: Readonly<Record<string, string>> = {
  a: 'A · reference',
  b: 'B · candidate',
};

/** The two configurations as the wire carries them; keyless rows contribute nothing. */
function sidesFromRows(rows: readonly EnvFlagRow[]): AbSides {
  const sides: AbSides = { a: {}, b: {} };
  for (const row of rows) {
    if (row.key === '') continue;
    sides.a[row.key] = row.values.a ?? '';
    sides.b[row.key] = row.values.b ?? '';
  }
  return sides;
}

/** The single configuration as the wire carries it; keyless rows contribute nothing. */
function envFromRows(rows: readonly EnvFlagRow[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === '') continue;
    env[row.key] = row.values[SINGLE_COLUMN] ?? '';
  }
  return env;
}

/**
 * The env key whose value the per-agent model pickers also write.
 *
 * `resolveProfile` builds the child's environment from the profile's `models`
 * block and writes EVAL_MODEL_OVERRIDES from it, unconditionally — so when both
 * are set, the picker's value REPLACES whatever the operator typed here, and the
 * run spends real money on a model they did not choose while the page showed
 * their value as accepted. Measured, not assumed: resolveProfile({models:
 * {opportunityEvaluator: 'google/gemini-2.5-flash'}, env: {EVAL_MODEL_OVERRIDES:
 * '{"opportunityEvaluator":"anthropic/claude-sonnet-4"}'}}) resolves to the
 * gemini value.
 *
 * So the form refuses the pair rather than picking a winner. Refusing is the
 * honest option: silently applying the picker is the current bug, and silently
 * applying the typed value would contradict the server. The operator is told
 * which control to clear.
 */
const MODEL_OVERRIDE_KEY = 'EVAL_MODEL_OVERRIDES';

interface LaunchState {
  harnesses: HarnessDescriptor[];
  profiles: ProfileDescriptor[];
  savedConfigs: ConfigProfile[];
  /** Flag/agent/model copy; null when the endpoint cannot be reached. */
  metadata: ConfigMetadata | null;
  selectedHarness: HarnessDescriptor | null;
  ab: boolean;
  /** Per side: the named config it runs under ("default" = ad-hoc overrides allowed). */
  profile: Record<Side, string>;
  /** Per side: model overrides, only expressible on top of "default". */
  models: Record<Side, Record<string, string>>;
  /** Per side: flags that change how a run is scored. */
  scoring: Record<Side, RunFlags>;
  /** Shared by both sides: what gets tested. */
  selection: RunFlags;
  /**
   * The environment configuration, for every harness. One row per flag; one
   * value per column, so the single and paired shapes are the same rows.
   */
  env: EnvFlagRow[];
  awaitingConfirmation: boolean;
  savingConfig: boolean;
  configName: string;
  configDescription: string;
  saveError: string | null;
  error: string | null;
  launchError: string | null;
}

const EMPTY_FLAGS: RunFlags = {};

/**
 * Every flag value this harness itself would refuse, deduplicated across the
 * specs this page would post.
 *
 * Not derived here: `flagValueIssues` is the function `RunSpecSchema` and
 * `renderRun` call, applied to the descriptor the server sent. It matters
 * because the shared schema bounds a flag by the widest value ANY harness
 * allows, while each harness declares its own: discovery caps `--runs` at 10
 * where the scorecard harnesses allow 25. Without this the form would enable a
 * launch, price it, take the operator's confirmation and post it — and the
 * engine would then refuse it, which is the one thing this page exists to
 * prevent.
 *
 * `FlagField` puts each flag's CONTROL bounds on the input's min/max, which are
 * not what this refuses on: a control is offered at a step resolution and the
 * API accepts more than it can express (`--alpha` at step 0.001 versus the
 * engines' 0 < alpha < 1). The descriptor's `accepts` is the rule, the input's
 * min/max is only what the widget offers — and a typed value is not validated by
 * the browser until a form is submitted, and there is no form here.
 */
function refusedFlagValues(
  harness: OpsHarness,
  flags: readonly HarnessFlag[],
  specs: readonly RunFlags[],
): string[] {
  const messages = new Set<string>();
  for (const spec of specs) {
    for (const issue of flagValueIssues(harness, flags, spec)) messages.add(issue.message);
  }
  return [...messages];
}

export function Launch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<LaunchState>({
    harnesses: [],
    profiles: [],
    savedConfigs: [],
    metadata: null,
    selectedHarness: null,
    ab: false,
    profile: { reference: 'default', candidate: 'default' },
    models: { reference: {}, candidate: {} },
    scoring: { reference: EMPTY_FLAGS, candidate: EMPTY_FLAGS },
    selection: EMPTY_FLAGS,
    env: [],
    awaitingConfirmation: false,
    savingConfig: false,
    configName: '',
    configDescription: '',
    saveError: null,
    error: null,
    launchError: null,
  });

  useEffect(() => {
    let mounted = true;
    const requested = searchParams.get('harness');

    Promise.all([api.harnesses(), api.profiles()])
      .then(([harnesses, profiles]) => {
        if (!mounted) return;
        const selected =
          harnesses.harnesses.find((h) => h.harness === requested) ?? harnesses.harnesses[0] ?? null;
        setState((prev) => ({
          ...prev,
          harnesses: harnesses.harnesses,
          profiles: profiles.profiles,
          selectedHarness: selected,
          // Env is per harness — catalogues differ — so it clears whenever the
          // harness changes, by WHICHEVER route. This effect reruns on every
          // searchParams change and can land on a different harness than the one
          // on screen: /launch?profile=x from the Configs page, then the nav's
          // own /launch link, resets the selection to harnesses[0] while leaving
          // rows the previous harness's catalogue produced. That posts a key the
          // new harness does not read, and the server answers 400.
          env: prev.selectedHarness?.harness === selected?.harness ? prev.env : [],
        }));
      })
      .catch((error) => {
        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    // Saved configs and copy metadata enhance the form but must never break it.
    api
      .configs()
      .then((result) => {
        if (mounted) setState((prev) => ({ ...prev, savedConfigs: result.saved ?? [] }));
      })
      .catch(() => {});
    api
      .configMetadata()
      .then((result) => {
        if (!mounted) return;
        const metadata: ConfigMetadata = {
          env: result.env ?? [],
          models: result.models ?? [],
          harnessAgents: result.harnessAgents ?? {},
          flags: result.flags ?? [],
        };
        setState((prev) => ({ ...prev, metadata }));
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [searchParams]);

  const handleHarnessChange = (harness: string) => {
    const descriptor = state.harnesses.find((h) => h.harness === harness) ?? null;
    setState((prev) => ({
      ...prev,
      selectedHarness: descriptor,
      // Model overrides name agents, and flags are per harness: both reset.
      models: { reference: {}, candidate: {} },
      scoring: { reference: EMPTY_FLAGS, candidate: EMPTY_FLAGS },
      selection: EMPTY_FLAGS,
      // Env resets for the same reason, and it is not cosmetic: catalogues differ
      // per harness, so a key chosen under the old one may not exist in the new
      // one's. Carrying it over would post a key the server refuses as unreadable
      // by this harness — a 400 the operator did nothing to earn.
      env: [],
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  /**
   * Picking a flag replaces the row in EVERY column: a key belongs to the row,
   * not to a side. This is what makes the asymmetric pair unbuildable.
   */
  const handleEnvKeyChange = useCallback((index: number, key: string) => {
    setState((prev) => ({
      ...prev,
      // A different flag has a different value schema, so no value carries over —
      // the columns are preserved, their values are not.
      env: prev.env.map((row, i) =>
        i === index
          ? { key, values: Object.fromEntries(Object.keys(row.values).map((c) => [c, ''])) }
          : row,
      ),
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  /** The only per-column edit: what this column gives the flag. */
  const handleEnvValueChange = useCallback((column: string, index: number, value: string) => {
    setState((prev) => ({
      ...prev,
      env: prev.env.map((row, i) =>
        i === index ? { ...row, values: { ...row.values, [column]: value } } : row,
      ),
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  /**
   * Adds an empty row shaped for the columns currently on screen.
   *
   * Takes the shape as an argument rather than reading the first existing row:
   * the FIRST row has no predecessor to copy, and defaulting it to the single
   * column gave a comparison's opening row a `single` value and no `a`/`b` —
   * contradicting the comment above it and leaving a residue that the A/B toggle
   * then had to paper over. The caller knows the shape; the reducer should not
   * have to infer it.
   */
  const handleEnvRowAdd = useCallback((columns: readonly string[]) => {
    setState((prev) => ({
      ...prev,
      env: [...prev.env, { key: '', values: Object.fromEntries(columns.map((c) => [c, ''])) }],
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  const handleEnvRowRemove = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      env: prev.env.filter((_, i) => i !== index),
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  /** Assigns one flag while preserving RunFlags' key/value type relation. */
  const withFlag = (
    flags: RunFlags,
    name: HarnessFlag['name'],
    value: string | number | boolean | undefined,
  ): RunFlags => {
    const next: RunFlags = { ...flags };
    if (value === undefined) {
      delete next[name];
      return next;
    }
    switch (name) {
      case 'runs':
        next.runs = value as number;
        break;
      case 'tier':
        next.tier = value as number;
        break;
      case 'alpha':
        next.alpha = value as number;
        break;
      case 'attemptTimeoutMs':
        next.attemptTimeoutMs = value as number;
        break;
      case 'case':
        next.case = value as string;
        break;
      case 'rule':
        next.rule = value as string;
        break;
      case 'noJudge':
        next.noJudge = value as boolean;
        break;
      case 'strictEvidence':
        next.strictEvidence = value as boolean;
        break;
    }
    return next;
  };

  const handleSelectionChange = (
    name: HarnessFlag['name'],
    value: string | number | boolean | undefined,
  ) => {
    setState((prev) => ({
      ...prev,
      selection: withFlag(prev.selection, name, value),
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  const handleScoringChange = (
    side: Side,
    name: HarnessFlag['name'],
    value: string | number | boolean | undefined,
  ) => {
    setState((prev) => ({
      ...prev,
      scoring: { ...prev.scoring, [side]: withFlag(prev.scoring[side], name, value) },
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  const isFullCorpus = (): boolean =>
    !(['case', 'rule', 'tier'] as const).some((name) => state.selection[name] !== undefined);

  /**
   * A selection value beginning with "-" would reach the harness parser looking
   * like a flag. The server rejects it; the form says so rather than silently
   * discarding the keystroke.
   */
  const invalidSelectionFlags = (Object.entries(state.selection) as [string, unknown][])
    .filter(([, value]) => typeof value === 'string' && value.startsWith('-'))
    .map(([name]) => state.selectedHarness?.flags.find((flag) => flag.name === name)?.cli ?? `--${name}`);

  /**
   * The spec for a run that compares two environment configurations.
   *
   * `profile` is "default" and there is no picker offering anything else: see
   * the note rendered above the two columns. No `overrides` either — this
   * harness declares no overridable agent, and its two sides differ in
   * environment alone.
   */
  const buildSidesSpec = (): EvalRunSpec => ({
    kind: 'eval',
    harness: state.selectedHarness!.harness,
    profile: 'default',
    flags: { ...state.selection },
    sides: sidesFromRows(state.env),
  });

  const buildSpec = (side: Side): EvalRunSpec => {
    const profile = state.profile[side];
    const models = state.models[side];
    // Env belongs to the run, not to a column: the scorecard A/B posts two specs
    // that differ in models and scoring, and giving each a different environment
    // would be a second, unlabelled axis of difference in a comparison whose
    // whole claim is that one thing changed.
    const env = envFromRows(state.env);
    const hasOverrides = Object.keys(models).length > 0 || Object.keys(env).length > 0;
    return {
      kind: 'eval',
      harness: state.selectedHarness!.harness,
      profile,
      flags: { ...state.selection, ...state.scoring[side] },
      ...(profile === 'default' && hasOverrides ? { overrides: { models, env } } : {}),
    };
  };

  const handleRun = () => {
    if (launchBlocked || state.selectedHarness === null) return;

    // What a confirmation is for is the destruction a launch causes, and a
    // harness that resets something destroys it however few cases are selected:
    // --case narrows what is measured, not what is reset. So the operator
    // confirms every run of one, filtered or not, and the copy names what the
    // DESCRIPTOR says is reset rather than only counting invocations.
    if ((isFullCorpus() || destroys) && !state.awaitingConfirmation) {
      setState((prev) => ({ ...prev, awaitingConfirmation: true }));
      return;
    }

    const fail = (error: unknown) =>
      setState((prev) => ({
        ...prev,
        launchError: error instanceof Error ? error.message : String(error),
        awaitingConfirmation: false,
      }));

    if (carriesSides) {
      // One run, both sides: the engine evaluates every case under configuration
      // a and configuration b and emits a single artifact holding the pair.
      api
        .launch(buildSidesSpec())
        .then((record) => navigate(`/r/${record.id}`))
        .catch(fail);
      return;
    }

    if (ab) {
      // Reference first, candidate second: they serialise through the run queue,
      // which keeps the comparison fair on one machine.
      const referenceSpec = buildSpec('reference');
      const candidateSpec = buildSpec('candidate');
      api
        .launch(referenceSpec)
        .then((reference) => api.launch(candidateSpec).then((candidate) => ({ reference, candidate })))
        .then(({ reference, candidate }) => {
          navigate(`/compare?referenceRun=${reference.id}&subjectRun=${candidate.id}`);
        })
        .catch(fail);
      return;
    }

    api
      .launch(buildSpec('reference'))
      .then((record) => navigate(`/r/${record.id}`))
      .catch(fail);
  };

  const handleSaveConfig = () => {
    const name = state.configName.trim();
    const description = state.configDescription.trim();
    const models = state.models.reference;
    if (name === '' || description === '' || Object.keys(models).length === 0) return;
    // The typed environment is saved WITH the models, not dropped. Before this
    // branch there was no env editor on this page, so `env: {}` was simply true;
    // now it would silently discard rows the operator had filled in and hand
    // back a config that does less than the form showed. A config carries both
    // blocks, and the Configs page already renders both.
    const env = envFromRows(state.env);
    api
      .createConfig({ name, description, models, env })
      .then((created) => {
        setState((prev) => ({
          ...prev,
          savedConfigs: [...prev.savedConfigs, created],
          profile: { ...prev.profile, reference: created.name },
          // Both blocks move into the config, so both clear from the ad-hoc form:
          // leaving the env rows behind would immediately conflict with the
          // config now selected, refusing a launch the operator just set up.
          models: { ...prev.models, reference: {} },
          env: [],
          savingConfig: false,
          configName: '',
          configDescription: '',
          saveError: null,
        }));
      })
      .catch((error) => {
        setState((prev) => ({
          ...prev,
          saveError: error instanceof Error ? error.message : String(error),
        }));
      });
  };

  const harnessId: OpsHarness | null = state.selectedHarness?.harness ?? null;

  /**
   * Whether this harness's run MAY compare two environment configurations. Read
   * from the server's own table, so the form branches on the same fact
   * `RunSpecSchema` and `renderRun` branch on.
   *
   * "May", not "must": discovery measures one configuration without `sides` and
   * compares two with them, so this no longer decides the shape by itself — the
   * operator's A/B checkbox does.
   */
  const supportsSides = harnessId !== null && SUPPORTS_SIDES[harnessId] === true;

  /**
   * Whether the spec this page would post carries `sides`. The one fact the
   * shape, the workload and the refusals all derive from.
   */
  const carriesSides = supportsSides && state.ab;

  /**
   * Exactly the keys this harness reads, with the server's copy for each.
   *
   * HARNESS_ENV_KEYS is generated from each harness's own import closure, so
   * this is "what the code reads", not a hand-kept list — which is how the site
   * came to offer nine flags for a graph that reads twenty-eight. Intersected
   * with the metadata the server sent, because a key with no description has no
   * value schema either, and offering it would invite a value that silently
   * falls back.
   */
  /**
   * Whether the server's env copy actually arrived.
   *
   * Not `metadata !== null`: the fetch resolves to an object either way, and the
   * reducer fills a missing `env` with `[]` — so a failed or empty metadata
   * response and a harness that genuinely reads nothing both end as an empty
   * `envFlags`. They need different sentences, and only this distinguishes them.
   */
  const envCopyLoaded = (state.metadata?.env ?? []).length > 0;

  const envFlags: readonly EnvFlagMeta[] = useMemo(
    () =>
      harnessId === null
        ? []
        : (state.metadata?.env ?? []).filter((flag) =>
            (HARNESS_ENV_KEYS[harnessId] ?? []).includes(flag.key),
          ),
    [state.metadata, harnessId],
  );

  /**
   * Every reason the server would refuse this configuration, from the server's
   * own functions — `abSideIssues` for a pair, `singleConfigIssues` for one,
   * and `envValueIssueForKey` for every harness's plain values. Not re-derived
   * here: a form with its own copy of these rules is how a page comes to accept
   * a configuration the launch rejects, or worse, one the graph silently falls
   * back on.
   *
   * Two rules, not one, and the split is deliberate. `singleConfigIssues`
   * couples a DISCOVERY_ENV_KEYS membership check to a value check, and only
   * the membership half is discovery-specific: running it over a scorecard
   * harness would refuse CHAT_MODEL as "not readable by the discovery graph"
   * when that harness demonstrably reads it. So the scorecard harnesses get the
   * value half alone — `envValueIssueForKey`, the exact function the server's
   * `validateProfileEnv` calls — because without it OPENROUTER_MAX_RETRIES="not-a-number"
   * left this page enabled, was priced, was confirmed, and came back a 400 after
   * the operator had committed to the spend.
   *
   * The membership check is unnecessary for them by construction: the picker
   * only offers `HARNESS_ENV_KEYS[harness]`, so a key it produced is one this
   * harness reads.
   */
  // Depends on `state.ab` rather than the derived `carriesSides`: the compiler
  // cannot prove a value computed from two other locals is stable, and the two
  // primitives it IS derived from are exactly as precise.
  const envIssues = useMemo(() => {
    if (state.env.length === 0) return [];
    if (supportsSides) {
      return state.ab
        ? abSideIssues(sidesFromRows(state.env))
        : singleConfigIssues(envFromRows(state.env));
    }
    // Same shape of issue as the discovery rules return, so one renderer and one
    // `envIssueFor` lookup serve both. Path is [key] because a scorecard run has
    // one column, exactly as `singleConfigIssues` reports it.
    const issues: { path: string[]; message: string }[] = [];
    for (const [key, value] of Object.entries(envFromRows(state.env))) {
      const problem = envValueIssueForKey(key, value);
      if (problem !== null) issues.push({ path: [key], message: `${key}="${value}" ${problem}` });
    }
    return issues;
  }, [supportsSides, state.ab, state.env]);

  const envIssueFor = useCallback(
    (column: string, key: string): string | undefined =>
      envIssues.find((issue) =>
        column === SINGLE_COLUMN
          ? issue.path[0] === key
          : issue.path[0] === column && issue.path[1] === key,
      )?.message,
    [envIssues],
  );

  /**
   * The contradiction the operator must not be able to author invisibly: a
   * per-agent model picker AND a typed EVAL_MODEL_OVERRIDES.
   *
   * resolveProfile writes EVAL_MODEL_OVERRIDES from the picker's models block,
   * so the typed value is discarded and the run uses models the operator did not
   * choose — while the page showed both as accepted. Refused here, naming both
   * controls, rather than resolved silently in either direction.
   */
  const modelOverrideConflict = useMemo(() => {
    const typed = state.env.some((row) => row.key === MODEL_OVERRIDE_KEY);
    if (!typed) return false;
    return Object.keys(state.models.reference).length > 0
      || Object.keys(state.models.candidate).length > 0;
  }, [state.env, state.models]);

  /**
   * The columns holding BOTH a named config and typed environment — a
   * combination `buildSpec` cannot express, so it must not be launchable.
   *
   * `RunSpecSchema` forbids `overrides` alongside a named profile, and
   * `buildSpec` honours that by sending `overrides` only when profile is
   * "default". The editor, though, renders outside ConfigColumn and stayed on
   * screen, filled and validated, whichever config was picked: the operator
   * typed an environment, the page showed it as accepted, and the run spent real
   * money without it. Silently dropping is the one wrong option of the three.
   *
   * Refused rather than hidden, for the same reason `modelOverrideConflict` is
   * refused: hiding the editor would discard rows the operator had already
   * typed, without saying so. Naming the two controls lets them choose which to
   * clear. Configs are per column, so the message can say which side.
   */
  const configEnvConflict: readonly Side[] = useMemo(() => {
    if (!state.env.some((row) => row.key !== '')) return [];
    // A run carrying sides has no config picker at all (profile is pinned to
    // "default"), so only the columns actually offering one can conflict.
    const sides: Side[] = state.ab ? ['reference', 'candidate'] : ['reference'];
    return sides.filter((side) => state.profile[side] !== 'default');
  }, [state.env, state.ab, state.profile]);

  /**
   * Keys the selected saved config sets that this harness does not read.
   *
   * Said BEFORE the launch, not after: the server reports these on the 202, but
   * every launch path here navigates away from this page, so a notice rendered
   * from the response would never be read. Derived with `unreadEnvKeys`, the
   * server's own function, against the same generated catalogue — so the page
   * names exactly the keys the 202 would.
   *
   * Not an error, and deliberately not blocking: a saved config is
   * harness-agnostic and may carry a key this harness never reads because it is
   * shared with one that does. EVAL_MODEL_OVERRIDES is excluded for the same
   * reason the server excludes it — renderRun writes it from the config's models
   * block, so naming it would tell the operator their model selection was
   * ignored when it was in fact applied.
   */
  const unreadConfigKeys: readonly string[] = useMemo(() => {
    if (harnessId === null) return [];
    // Both columns' configs when the form is in A/B, so a key unread by this
    // harness is named whichever column carries it. `state.ab` rather than the
    // derived `ab`, which is declared below the hooks.
    const names = new Set([
      state.profile.reference,
      ...(state.ab ? [state.profile.candidate] : []),
    ]);
    const keys = new Set<string>();
    for (const name of names) {
      const config = state.savedConfigs.find((candidate) => candidate.name === name)
        ?? state.profiles.find((candidate) => candidate.name === name);
      if (config === undefined) continue;
      for (const key of unreadEnvKeys(harnessId, config.env ?? {})) {
        if (key !== MODEL_OVERRIDE_KEY) keys.add(key);
      }
    }
    return [...keys].sort();
  }, [harnessId, state.profile, state.savedConfigs, state.profiles, state.ab]);

  // Every hook is above this line: the two returns below are conditional.
  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  if (state.harnesses.length === 0 || state.profiles.length === 0) {
    return (
      <div className="p-4">
        <Frame label="launch">
          <p className="text-term-dim">Loading...</p>
        </Frame>
      </div>
    );
  }

  const agents: readonly AgentMeta[] =
    harnessId === null ? [] : (state.metadata?.harnessAgents[harnessId] ?? []);
  const guidedModels: readonly ModelMeta[] = state.metadata?.models ?? [];
  const flagMeta: readonly FlagMeta[] = state.metadata?.flags ?? [];
  const profileDefaults = state.profiles.find((p) => p.name === 'default')?.models ?? {};

  const harnessFlags = state.selectedHarness?.flags ?? [];
  const metaFor = (name: string): FlagMeta | undefined => flagMeta.find((f) => f.name === name);
  const selectionFlags = harnessFlags.filter((flag) =>
    (SELECTION_FLAGS as readonly string[]).includes(flag.name),
  );
  const scoringFlags = harnessFlags.filter(
    (flag) => !(SELECTION_FLAGS as readonly string[]).includes(flag.name),
  );

  const fullCorpus = isFullCorpus();
  const runs = state.selection.runs ?? state.selectedHarness?.defaultRuns ?? 0;
  const cases = state.selectedHarness === null ? 0 : fullCorpus ? state.selectedHarness.caseCount : 1;

  /**
   * A/B is the operator's checkbox, for every harness that can express it. It is
   * no longer pinned on for discovery: a run without `sides` measures one
   * configuration, which is the cheaper of the two shapes and was previously
   * unreachable from this page.
   */
  const ab = state.ab;

  // Two independent multipliers, and conflating them is what overstated this
  // page by double. `sidesPerRun` is how many times ONE run passes over the
  // corpus, and it reads the SPEC rather than the harness: a discovery pair
  // evaluates every case under both configurations in one invocation, while a
  // single discovery run passes over the corpus once. The constant this replaced
  // was pinned at 2 for discovery, so the page quoted 30 invocations for a
  // single run that costs 15. It comes from the same module renderRun records
  // the workload from, so the number confirmed here and the number stored on the
  // record cannot drift.
  //
  // `sidesPerRun` reads the spec's own shape — `sides === undefined ? 1 : 2` —
  // so it consults no per-harness table and cannot be stumped by a harness this
  // build does not know. It returns 1 or 2 and never undefined, which is why
  // there is no `|| 1` fallback here: a guard against a value the function
  // cannot produce reads as a real possibility to the next person, and the test
  // pinning it would have asserted a branch that cannot execute.
  const passesPerLaunch =
    harnessId === null
      ? 1
      : sidesPerRun({ harness: harnessId, ...(carriesSides ? { sides: sidesFromRows(state.env) } : {}) });
  // What this run DESTROYS, in the harness's own words, because the branch that
  // shows it is the descriptor's own field and not a harness name: discovery
  // resets Neon branches, and another harness must not inherit that claim from a
  // sentence written here. A harness that names nothing gets no sentence.
  //
  // Selected by SHAPE. A single discovery run resets one branch and a comparison
  // resets both, so quoting one string for both told an operator launching one
  // configuration that both branches would go — in the confirmation, which is the
  // last moment they can decline.
  const resets = carriesSides ? state.selectedHarness?.resets?.sides : state.selectedHarness?.resets?.single;
  const destroys = resets !== undefined;
  // A harness that carries both configurations in ONE run launches once; the
  // form's own A/B mode for every other harness launches twice, back to back.
  const launches = carriesSides ? 1 : ab ? 2 : 1;
  const passes = passesPerLaunch * launches;
  const workload = cases * runs * passes;

  // Scoring differences are legitimate to compare but change what a verdict
  // means, so the form says so instead of presenting the diff as like-for-like.
  const scoringDiffers =
    ab && JSON.stringify(state.scoring.reference) !== JSON.stringify(state.scoring.candidate);

  /**
   * A row nobody has finished is not a refusal to quote at the operator: the
   * server's word for a blank value is "unset it on both sides instead of
   * blanking it", which is not what an untouched field means. So incompleteness
   * is said once, plainly, and the server's own refusals are shown for what the
   * operator has actually filled in.
   */
  //
  // Scoped to the columns ON SCREEN, never to every key the row happens to
  // carry: toggling A/B rebuilds `values` for the new shape, and judging a row
  // by a column it no longer shows would block a launch on a field the operator
  // cannot see, with a message pointing at nothing.
  const activeColumns: readonly string[] = carriesSides ? SIDE_COLUMNS : SINGLE_COLUMNS;
  const envIncomplete = state.env.some(
    (row) =>
      row.key === ''
      || activeColumns.some((column) => (row.values[column] ?? '').trim() === ''),
  );
  /**
   * A discovery run must configure something, in EITHER shape.
   *
   * The engine refuses a shape that names no key (`parseAbSideConfig`), and
   * `singleConfigIssues({})` returns "This run has no configuration; set at
   * least one flag the discovery graph reads, or there is nothing to measure".
   * Guarding only the paired shape — which is what `carriesSides && ...` did —
   * left the harness's own DEFAULT state (A/B off, no rows) enabled, priced and
   * confirmable, and the server answered 400 after the operator had committed.
   * That is precisely the trade ops.sides.ts exists to prevent: "a form that
   * accepts a pair the server rejects turns a configuration mistake into a 400
   * after the operator has committed to a spend."
   *
   * Scoped to `supportsSides` rather than to every harness, because it is only
   * true of this one: a scorecard harness with no env set runs the committed
   * default, which is its normal and most common launch.
   */
  const envEmpty = supportsSides && state.env.length === 0;
  const envGeneralIssues =
    envIncomplete || envEmpty ? [] : envIssues.filter((issue) => issue.path.length < (carriesSides ? 2 : 1));

  // The specs this page would post, so a value is checked exactly where it would
  // be sent: shared selection alone for the harness that carries sides, and
  // selection plus each column's scoring flags otherwise.
  const flagIssues =
    state.selectedHarness === null
      ? []
      : refusedFlagValues(
          state.selectedHarness.harness,
          state.selectedHarness.flags,
          carriesSides
            ? [state.selection]
            : ab
              ? [
                  { ...state.selection, ...state.scoring.reference },
                  { ...state.selection, ...state.scoring.candidate },
                ]
              : [{ ...state.selection, ...state.scoring.reference }],
        );

  const launchBlocked =
    invalidSelectionFlags.length > 0
    || flagIssues.length > 0
    || envIncomplete
    || envEmpty
    || modelOverrideConflict
    || configEnvConflict.length > 0
    || envIssues.length > 0;
  const saveConfigBlocked =
    state.configName.trim() === '' ||
    state.configDescription.trim() === '' ||
    Object.keys(state.models.reference).length === 0;
  const showSaveConfig =
    !ab &&
    state.profile.reference === 'default' &&
    Object.keys(state.models.reference).length > 0;

  const sideProps = {
    agents,
    guidedModels,
    profileDefaults,
    scoringFlags,
    metaFor,
    profiles: state.profiles,
    savedConfigs: state.savedConfigs,
  };

  return (
    <div className="p-4">
      <Frame label={ab ? 'launch a/b' : 'launch'}>
        <div className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2">
              <select
                aria-label="Harness"
                className="bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                value={state.selectedHarness?.harness ?? ''}
                onChange={(e) => handleHarnessChange(e.target.value)}
              >
                {state.harnesses.map((h) => (
                  <option key={h.harness} value={h.harness}>
                    {h.harness}
                  </option>
                ))}
              </select>
              {state.selectedHarness !== null && (
                <span className="text-term-dim">
                  {state.selectedHarness.caseCount} cases · {state.selectedHarness.question}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ab}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      ab: e.target.checked,
                      // Reshape the rows to the new column set, keeping the keys
                      // the operator picked. Turning A/B on copies the single
                      // value to both sides (identical sides are then refused,
                      // which is the correct and visible next step); turning it
                      // off keeps side a's value, because a single run measures
                      // one configuration and a is the one the operator wrote first.
                      env: prev.env.map((row): EnvFlagRow =>
                        e.target.checked
                          ? {
                              key: row.key,
                              values: {
                                a: row.values[SINGLE_COLUMN] ?? row.values.a ?? '',
                                b: row.values[SINGLE_COLUMN] ?? row.values.b ?? '',
                              },
                            }
                          : {
                              key: row.key,
                              values: {
                                [SINGLE_COLUMN]: row.values.a ?? row.values[SINGLE_COLUMN] ?? '',
                              },
                            },
                      ),
                      awaitingConfirmation: false,
                      launchError: null,
                    }))
                  }
                />
                <span>A/B</span>
              </label>
              {carriesSides && (
                <span className="text-term-dim">— one run, both configurations</span>
              )}
            </div>
          </div>

          {carriesSides ? (
            <div className="space-y-3">
              <p className="text-term-dim">
                Both sides run the same models and the same environment, and differ only in the flags
                below. No config is offered here: a saved config would change the models under both
                sides at once, moving both pass rates without changing the difference this run
                measures.
              </p>
              <EnvConfigEditor
                columns={SIDE_COLUMNS}
                columnLabels={SIDE_COLUMN_LABELS}
                flags={envFlags}
                metadataLoaded={envCopyLoaded}
                rows={state.env}
                issueFor={envIssueFor}
                onKeyChange={handleEnvKeyChange}
                onValueChange={handleEnvValueChange}
                onAddRow={handleEnvRowAdd}
                onRemoveRow={handleEnvRowRemove}
              />
            </div>
          ) : ab ? (
            <div className="grid grid-cols-2 gap-4">
              <ConfigColumn
                side="reference"
                heading="A · reference"
                profile={state.profile.reference}
                models={state.models.reference}
                scoring={state.scoring.reference}
                {...sideProps}
                onProfileChange={(profile) =>
                  setState((prev) => ({
                    ...prev,
                    profile: { ...prev.profile, reference: profile },
                    launchError: null,
                  }))
                }
                onModelsChange={(models) =>
                  setState((prev) => ({ ...prev, models: { ...prev.models, reference: models } }))
                }
                onScoringChange={(name, value) => handleScoringChange('reference', name, value)}
              />
              <ConfigColumn
                side="candidate"
                heading="B · candidate"
                profile={state.profile.candidate}
                models={state.models.candidate}
                scoring={state.scoring.candidate}
                {...sideProps}
                onProfileChange={(profile) =>
                  setState((prev) => ({
                    ...prev,
                    profile: { ...prev.profile, candidate: profile },
                    launchError: null,
                  }))
                }
                onModelsChange={(models) =>
                  setState((prev) => ({ ...prev, models: { ...prev.models, candidate: models } }))
                }
                onScoringChange={(name, value) => handleScoringChange('candidate', name, value)}
              />
            </div>
          ) : (
            <ConfigColumn
              side="reference"
              heading={null}
              profile={state.profile.reference}
              models={state.models.reference}
              scoring={state.scoring.reference}
              {...sideProps}
              onProfileChange={(profile) =>
                setState((prev) => ({
                  ...prev,
                  profile: { ...prev.profile, reference: profile },
                  launchError: null,
                }))
              }
              onModelsChange={(models) =>
                setState((prev) => ({ ...prev, models: { ...prev.models, reference: models } }))
              }
              onScoringChange={(name, value) => handleScoringChange('reference', name, value)}
            />
          )}

          {/* Env for every harness. A run carrying sides renders its editor above,
              inside the note that explains why no config is offered there. */}
          {!carriesSides && (
            <EnvConfigEditor
              columns={SINGLE_COLUMNS}
              columnLabels={SINGLE_COLUMN_LABELS}
              flags={envFlags}
              metadataLoaded={envCopyLoaded}
              rows={state.env}
              issueFor={envIssueFor}
              onKeyChange={handleEnvKeyChange}
              onValueChange={handleEnvValueChange}
              onAddRow={handleEnvRowAdd}
              onRemoveRow={handleEnvRowRemove}
            />
          )}

          {modelOverrideConflict && (
            <p className="text-term-red">
              {MODEL_OVERRIDE_KEY} is set here and the per-agent model pickers are also set. The
              pickers write this same variable, so one of the two would be discarded and the run
              would use models you did not choose. Clear one of them.
            </p>
          )}

          {configEnvConflict.length > 0 && (
            <p className="text-term-red">
              Environment is set here and{' '}
              {configEnvConflict
                .map((side) => `${side === 'reference' ? 'A · reference' : 'B · candidate'} runs under the saved config "${state.profile[side]}"`)
                .join(', and ')}
              . A run uses one or the other, never both, so this environment would be dropped and
              the run would measure the config alone. Clear the environment, or switch that column
              back to “default”.
            </p>
          )}

          {unreadConfigKeys.length > 0 && (
            <p className="text-term-yellow">
              Recorded but not read by {harnessId}: {unreadConfigKeys.join(', ')}. This config sets
              them and the run will record them, but this harness's code never reads them, so they
              will not affect the result.
            </p>
          )}

          {scoringDiffers && (
            <p className="text-term-yellow">
              The two sides score differently, so their results are not like-for-like.
            </p>
          )}

          {selectionFlags.length > 0 && (
            <div className="border-t border-term-rule pt-3">
              <p className="text-term-dim mb-2">
                What gets tested{ab ? ' — shared by both sides' : ''}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-4">
                {selectionFlags.map((flag) => (
                  <FlagField
                    key={flag.name}
                    flag={flag}
                    meta={metaFor(flag.name)}
                    value={state.selection[flag.name]}
                    onChange={(value) => handleSelectionChange(flag.name, value)}
                  />
                ))}
              </div>
            </div>
          )}

          {showSaveConfig && !state.savingConfig && (
            <button
              type="button"
              className="px-[2ch] py-[0.5lh] border border-term-rule text-term-dim"
              onClick={() => setState((prev) => ({ ...prev, savingConfig: true, saveError: null }))}
            >
              save as config…
            </button>
          )}
          {state.savingConfig && (
            <div className="space-y-2 border border-term-rule p-2">
              <input
                aria-label="config name"
                type="text"
                placeholder="kebab-case-name"
                className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                value={state.configName}
                onChange={(e) => setState((prev) => ({ ...prev, configName: e.target.value }))}
              />
              <input
                aria-label="config description"
                type="text"
                placeholder="what this config is for"
                className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                value={state.configDescription}
                onChange={(e) => setState((prev) => ({ ...prev, configDescription: e.target.value }))}
              />
              {state.saveError !== null && (
                <p role="alert" className="text-term-red">
                  {state.saveError}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="px-[2ch] py-[0.5lh] bg-term-cyan text-term-bg font-bold disabled:opacity-50"
                  disabled={saveConfigBlocked}
                  onClick={handleSaveConfig}
                >
                  Save config
                </button>
                <button
                  type="button"
                  className="px-[2ch] py-[0.5lh] border border-term-rule"
                  onClick={() => setState((prev) => ({ ...prev, savingConfig: false, saveError: null }))}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-term-rule pt-3 flex items-center justify-between gap-4">
            <div>
              <p>
                <span className="text-term-dim">Workload: </span>
                {cases} {cases === 1 ? 'case' : 'cases'}
                {fullCorpus ? '' : ' (filtered)'} × {runs} runs{passes === 2 ? ' × 2 sides' : ''} ={' '}
                {workload}
              </p>
              {invalidSelectionFlags.length > 0 && (
                <p className="text-term-red">Fix {invalidSelectionFlags.join(', ')} before running.</p>
              )}
              {flagIssues.map((message) => (
                <p key={message} className="text-term-red">
                  {message}
                </p>
              ))}
              {envEmpty && (
                <p className="text-term-red">
                  {carriesSides
                    ? 'Add a flag to both sides before running.'
                    : 'Add a flag before running: a discovery run measures the configuration you set, so with none there is nothing to measure.'}
                </p>
              )}
              {envIncomplete && (
                <p className="text-term-red">
                  {carriesSides
                    ? 'Give every flag a value on both sides before running.'
                    : 'Give every flag a value before running.'}
                </p>
              )}
              {envGeneralIssues.map((issue) => (
                <p key={issue.message} className="text-term-red">
                  {issue.message}
                </p>
              ))}
              {state.launchError !== null && (
                <p role="alert" className="text-term-red">
                  Launch refused: {state.launchError}
                </p>
              )}
              {state.awaitingConfirmation && (
                <p className="text-term-yellow">
                  {destroys
                    ? `Confirm run: this resets ${resets} and spends ${workload} model invocations`
                    : `Confirm full-corpus run: ${workload} model invocations`}
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {state.awaitingConfirmation && (
                <button
                  onClick={() => setState((prev) => ({ ...prev, awaitingConfirmation: false }))}
                  className="px-[2ch] py-[0.5lh] border border-term-rule"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleRun}
                disabled={launchBlocked}
                className={`px-[2ch] py-[0.5lh] font-bold disabled:opacity-50 ${
                  state.awaitingConfirmation
                    ? 'bg-term-green text-term-bg'
                    : 'bg-term-cyan text-term-bg'
                }`}
              >
                {state.awaitingConfirmation
                  ? 'Confirm and Run'
                  : carriesSides
                    ? 'Run both sides'
                    : ab
                      ? 'Run A/B'
                      : 'Run'}
              </button>
            </div>
          </div>
        </div>
      </Frame>
    </div>
  );
}

/**
 * One configuration: the named config it runs under, the model each agent uses,
 * and the flags that change how the run is scored. In A/B two of these sit side
 * by side and only their differences matter.
 */
function ConfigColumn(props: {
  side: Side;
  /** Column title in A/B; null in single mode, where there is nothing to name. */
  heading: string | null;
  profile: string;
  models: Record<string, string>;
  scoring: RunFlags;
  agents: readonly AgentMeta[];
  guidedModels: readonly ModelMeta[];
  profileDefaults: Record<string, string>;
  scoringFlags: readonly HarnessFlag[];
  metaFor: (name: string) => FlagMeta | undefined;
  profiles: readonly ProfileDescriptor[];
  savedConfigs: readonly ConfigProfile[];
  onProfileChange: (profile: string) => void;
  onModelsChange: (models: Record<string, string>) => void;
  onScoringChange: (name: HarnessFlag['name'], value: string | number | boolean | undefined) => void;
}) {
  const {
    side,
    heading,
    profile,
    models,
    scoring,
    agents,
    guidedModels,
    profileDefaults,
    scoringFlags,
    metaFor,
    profiles,
    savedConfigs,
    onProfileChange,
    onModelsChange,
    onScoringChange,
  } = props;
  const overridesAllowed = profile === 'default';
  // The config picker only earns its space once there is something to pick.
  //
  // This gate asks about saved configs, never about the harness's `agents` — and
  // it cannot: a saved config's models reach any harness, including one that
  // declares no overridable agent and therefore gets no model editors. For
  // a comparison run that would have been a live control with nothing on the
  // page explaining it: the config's EVAL_MODEL_OVERRIDES really do change the
  // models inside the discovery graph, under both sides at once. The fix is not
  // a fourth condition here but the absence of this whole column: a run carrying
  // sides renders an EnvConfigEditor instead, and states above it that both
  // sides run the same models and why no config is offered.
  const showProfilePicker = savedConfigs.length > 0 || profiles.length > 1;

  return (
    <div className={heading === null ? 'space-y-3' : 'border border-term-rule p-3 space-y-3'}>
      {heading !== null && <p className="text-term-cyan">{heading}</p>}

      {showProfilePicker && (
        <div>
          <label htmlFor={`${side}-profile`} className="block mb-1 text-term-dim">
            Config
          </label>
          <select
            id={`${side}-profile`}
            className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
            value={profile}
            onChange={(e) => onProfileChange(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
            {savedConfigs.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} (saved)
              </option>
            ))}
          </select>
        </div>
      )}

      {overridesAllowed && agents.length > 0 && (
        <ModelOverrideEditor
          agents={agents}
          models={guidedModels}
          profileDefaults={profileDefaults}
          value={models}
          onChange={onModelsChange}
        />
      )}
      {!overridesAllowed && (
        <p className="text-term-dim">
          Runs as saved.{' '}
          <Link to="/profiles" className="text-term-cyan underline">
            Edit this config
          </Link>
          .
        </p>
      )}

      {scoringFlags.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {scoringFlags.map((flag) => (
            <FlagField
              key={flag.name}
              flag={flag}
              meta={metaFor(flag.name)}
              value={scoring[flag.name]}
              idPrefix={side}
              onChange={(value) => onScoringChange(flag.name, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One flag control: plain-English label, the harness's own bounds, and the
 * default named in the placeholder so an untouched field reads as "unset"
 * rather than empty. The description is a title tooltip — visible on demand,
 * never crowding the grid.
 */
function FlagField(props: {
  flag: HarnessFlag;
  meta: FlagMeta | undefined;
  value: string | number | boolean | undefined;
  idPrefix?: string;
  onChange: (value: string | number | boolean | undefined) => void;
}) {
  const { flag, meta, value, idPrefix, onChange } = props;
  const id = `${idPrefix ?? 'flag'}-${flag.name}`;
  const label = meta?.label ?? flag.cli;
  const title = meta?.description;

  if (flag.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2" title={title}>
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked ? true : undefined)}
        />
        <span>{label}</span>
      </label>
    );
  }

  return (
    <div title={title}>
      <label htmlFor={id} className="block text-term-dim">
        {label}
      </label>
      <input
        id={id}
        type={flag.kind === 'number' ? 'number' : 'text'}
        min={flag.min}
        max={flag.max}
        step={flag.step}
        placeholder={meta?.defaultLabel ?? ''}
        className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
        value={value === undefined ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          onChange(flag.kind === 'number' ? Number(raw) : raw);
        }}
      />
    </div>
  );
}
