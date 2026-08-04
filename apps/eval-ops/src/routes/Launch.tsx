import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { DISCOVERY_AB_ENV_KEYS } from '../../../../packages/protocol/eval/ops/ops.allowlist';
import { flagValueIssues } from '../../../../packages/protocol/eval/ops/ops.flags';
import { REQUIRES_SIDES, SIDES_PER_RUN, abSideIssues } from '../../../../packages/protocol/eval/ops/ops.sides';
import { Frame } from '../components/Frame';
import { ModelOverrideEditor } from '../components/ModelOverrideEditor';
import { SideEnvEditor, type SideEnvRow } from '../components/SideEnvEditor';
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
 * One environment flag as the form holds it for a side-comparison harness: one
 * key, one value per side.
 *
 * Deliberately not two independent per-side records. A flag set on one side and
 * omitted on the other is refused by the server (the omitted side takes the
 * graph's own default, which may equal the other side's value, so the run can
 * measure nothing while the report names a difference), and a form that can
 * express a refused configuration is a form that wastes the operator's time.
 * Here the asymmetric pair does not exist to be built.
 */
interface AbFlagRow {
  /** Empty until the operator picks a flag. */
  key: string;
  a: string;
  b: string;
}

const EMPTY_AB_ROW: AbFlagRow = { key: '', a: '', b: '' };

/** The two configurations as the wire carries them; keyless rows contribute nothing. */
function sidesFromRows(rows: readonly AbFlagRow[]): AbSides {
  const sides: AbSides = { a: {}, b: {} };
  for (const row of rows) {
    if (row.key === '') continue;
    sides.a[row.key] = row.a;
    sides.b[row.key] = row.b;
  }
  return sides;
}

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
  /** The per-side environment configuration, for the harness that compares two. */
  sides: AbFlagRow[];
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
 * allows, while each harness declares its own: discovery-ab caps `--runs` at 10
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
    sides: [],
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
          // A deep link (/launch?harness=…) selects a harness without going
          // through handleHarnessChange, so the harness that needs a per-side
          // configuration gets its first row here too — otherwise it would open
          // on an editor with no rows and no sign of what to do with it.
          sides:
            selected !== null && REQUIRES_SIDES[selected.harness] === true
              ? [{ ...EMPTY_AB_ROW }]
              : prev.sides,
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
    const comparesSides = descriptor !== null && REQUIRES_SIDES[descriptor.harness] === true;
    setState((prev) => ({
      ...prev,
      selectedHarness: descriptor,
      // Model overrides name agents, and flags are per harness: both reset.
      models: { reference: {}, candidate: {} },
      scoring: { reference: EMPTY_FLAGS, candidate: EMPTY_FLAGS },
      selection: EMPTY_FLAGS,
      // One empty row so the harness that requires a configuration opens with the
      // control for it; every other harness cannot express one at all.
      sides: comparesSides ? [{ ...EMPTY_AB_ROW }] : [],
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  /** Picking a flag replaces the row on BOTH sides: a key belongs to the pair. */
  const handleSideKeyChange = useCallback((index: number, key: string) => {
    setState((prev) => ({
      ...prev,
      // A different flag has a different value schema, so no value carries over.
      sides: prev.sides.map((row, i) => (i === index ? { key, a: '', b: '' } : row)),
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  /** The only per-side edit: what this side gives the flag. */
  const handleSideValueChange = useCallback((side: 'a' | 'b', index: number, value: string) => {
    setState((prev) => ({
      ...prev,
      sides: prev.sides.map((row, i) => (i === index ? { ...row, [side]: value } : row)),
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  const handleSideRowAdd = useCallback(() => {
    setState((prev) => ({
      ...prev,
      sides: [...prev.sides, { ...EMPTY_AB_ROW }],
      awaitingConfirmation: false,
      launchError: null,
    }));
  }, []);

  const handleSideRowRemove = useCallback((index: number) => {
    setState((prev) => ({
      ...prev,
      sides: prev.sides.filter((_, i) => i !== index),
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
    sides: sidesFromRows(state.sides),
  });

  const buildSpec = (side: Side): EvalRunSpec => {
    const profile = state.profile[side];
    const models = state.models[side];
    return {
      kind: 'eval',
      harness: state.selectedHarness!.harness,
      profile,
      flags: { ...state.selection, ...state.scoring[side] },
      ...(profile === 'default' && Object.keys(models).length > 0
        ? { overrides: { models, env: {} } }
        : {}),
    };
  };

  const handleRun = () => {
    if (launchBlocked || state.selectedHarness === null) return;

    // What a confirmation is for is the destruction a launch causes, and a
    // harness that carries sides destroys the same thing however few cases are
    // selected: --case narrows what is measured, not what is reset. So the
    // operator confirms every run of one, filtered or not, and the copy names
    // what the DESCRIPTOR says is reset rather than only counting invocations.
    if ((isFullCorpus() || requiresSides) && !state.awaitingConfirmation) {
      setState((prev) => ({ ...prev, awaitingConfirmation: true }));
      return;
    }

    const fail = (error: unknown) =>
      setState((prev) => ({
        ...prev,
        launchError: error instanceof Error ? error.message : String(error),
        awaitingConfirmation: false,
      }));

    if (requiresSides) {
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
    api
      .createConfig({ name, description, models, env: {} })
      .then((created) => {
        setState((prev) => ({
          ...prev,
          savedConfigs: [...prev.savedConfigs, created],
          profile: { ...prev.profile, reference: created.name },
          models: { ...prev.models, reference: {} },
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
   * Whether this harness's run compares two operator-supplied environment
   * configurations. Read from the server's own table, so the form branches on
   * the same fact `RunSpecSchema` and `renderRun` branch on.
   */
  const requiresSides = harnessId !== null && REQUIRES_SIDES[harnessId] === true;

  /** The nine keys this harness can test, with the server's copy for each. */
  const abFlags: readonly EnvFlagMeta[] = useMemo(
    () => (state.metadata?.env ?? []).filter((flag) => DISCOVERY_AB_ENV_KEYS.includes(flag.key)),
    [state.metadata],
  );

  /**
   * Every reason the server would refuse this pair, from the server's own
   * function. Not re-derived here: a form with its own copy of these rules is
   * how a page comes to accept a configuration the launch rejects — or, worse,
   * to accept one the discovery graph silently falls back on.
   */
  const abIssues = useMemo(
    // Only the harness that compares two configurations ever has rows: every
    // other one is left with none by handleHarnessChange, and none of them can
    // add any, so an empty list is "nothing to refuse" rather than "no sides".
    () => (state.sides.length === 0 ? [] : abSideIssues(sidesFromRows(state.sides))),
    [state.sides],
  );

  const abIssueFor = useCallback(
    (side: 'a' | 'b', key: string): string | undefined =>
      abIssues.find((issue) => issue.path[0] === side && issue.path[1] === key)?.message,
    [abIssues],
  );

  // One row list per side, sharing the row's key: what makes an asymmetric pair
  // unbuildable here rather than merely refused.
  const rowsA: SideEnvRow[] = useMemo(
    () => state.sides.map((row) => ({ key: row.key, value: row.a })),
    [state.sides],
  );
  const rowsB: SideEnvRow[] = useMemo(
    () => state.sides.map((row) => ({ key: row.key, value: row.b })),
    [state.sides],
  );

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
   * A/B is this form's own mode — two separate runs, one per column — and the
   * operator's checkbox owns it. For a harness whose single run already carries
   * both configurations it is not a choice at all, so it is pinned on and the
   * checkbox is disabled rather than silently ignored. `state.ab` keeps the
   * operator's own answer untouched underneath, for when they select a
   * scorecard harness again.
   */
  const ab = requiresSides || state.ab;

  // Two independent multipliers, and conflating them is what understated this
  // page by half. SIDES_PER_RUN is how many times ONE run passes over the
  // corpus — 2 for discovery-ab, whether or not any box is ticked, because it
  // evaluates every case under configuration a and configuration b (contract:
  // "5 cases x 10 repetitions x 2 sides"). It is imported from the same module
  // renderRun records the run's workload from, so the number confirmed here and
  // the number stored on the record cannot drift. `launches` is the form's own
  // A/B mode: two runs of a scorecard harness, queued back to back.
  // `?? 1` is not decoration: SIDES_PER_RUN is keyed by the harnesses this build
  // knows, and a server one release ahead can name one it does not. Without the
  // default the workload line reads "= NaN" on a page whose whole job is to say
  // what a run costs.
  const sidesPerRun = harnessId === null ? 1 : (SIDES_PER_RUN[harnessId] ?? 1);
  // What this run DESTROYS, in the harness's own words, because the branch that
  // shows it is `requiresSides` and not a harness name: discovery-ab resets two
  // Neon branches, and a second comparison harness must not inherit that claim
  // from a sentence written here. A harness that names nothing gets no sentence.
  const resets = state.selectedHarness?.resets;
  const launches = requiresSides ? 1 : ab ? 2 : 1;
  const passes = sidesPerRun * launches;
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
  const abIncomplete =
    requiresSides
    && (state.sides.length === 0
      || state.sides.some((row) => row.key === '' || row.a.trim() === '' || row.b.trim() === ''));
  const abGeneralIssues = abIncomplete ? [] : abIssues.filter((issue) => issue.path.length < 2);

  // The specs this page would post, so a value is checked exactly where it would
  // be sent: shared selection alone for the harness that carries sides, and
  // selection plus each column's scoring flags otherwise.
  const flagIssues =
    state.selectedHarness === null
      ? []
      : refusedFlagValues(
          state.selectedHarness.harness,
          state.selectedHarness.flags,
          requiresSides
            ? [state.selection]
            : ab
              ? [
                  { ...state.selection, ...state.scoring.reference },
                  { ...state.selection, ...state.scoring.candidate },
                ]
              : [{ ...state.selection, ...state.scoring.reference }],
        );

  const launchBlocked =
    invalidSelectionFlags.length > 0 || flagIssues.length > 0 || abIncomplete || abIssues.length > 0;
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
                  // Not optional for a harness whose one run is both sides:
                  // offering to turn it off would offer something that cannot
                  // happen. The note beside it says why the control is fixed.
                  disabled={requiresSides}
                  onChange={(e) =>
                    setState((prev) => ({
                      ...prev,
                      ab: e.target.checked,
                      awaitingConfirmation: false,
                      launchError: null,
                    }))
                  }
                />
                <span>A/B</span>
              </label>
              {requiresSides && (
                <span className="text-term-dim">— this harness always runs both sides</span>
              )}
            </div>
          </div>

          {requiresSides ? (
            <div className="space-y-3">
              <p className="text-term-dim">
                Both sides run the same models and the same environment, and differ only in the flags
                below. No config is offered here: a saved config would change the models under both
                sides at once, moving both pass rates without changing the difference this run
                measures.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <SideEnvEditor
                  side="a"
                  heading="A · side a"
                  flags={abFlags}
                  rows={rowsA}
                  issueFor={(key) => abIssueFor('a', key)}
                  onKeyChange={handleSideKeyChange}
                  onValueChange={(index, value) => handleSideValueChange('a', index, value)}
                  onAddRow={handleSideRowAdd}
                  onRemoveRow={handleSideRowRemove}
                />
                <SideEnvEditor
                  side="b"
                  heading="B · side b"
                  flags={abFlags}
                  rows={rowsB}
                  issueFor={(key) => abIssueFor('b', key)}
                  onKeyChange={handleSideKeyChange}
                  onValueChange={(index, value) => handleSideValueChange('b', index, value)}
                  onAddRow={handleSideRowAdd}
                  onRemoveRow={handleSideRowRemove}
                />
              </div>
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
              {abIncomplete && (
                <p className="text-term-red">
                  {state.sides.length === 0
                    ? 'Add a flag to both sides before running.'
                    : 'Give every flag a value on both sides before running.'}
                </p>
              )}
              {abGeneralIssues.map((issue) => (
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
                  {requiresSides
                    ? resets === undefined
                      ? `Confirm run: ${workload} model invocations`
                      : `Confirm run: this resets ${resets} and spends ${workload} model invocations`
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
                  : requiresSides
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
  // discovery-ab that would have been a live control with nothing on the page
  // explaining it: the config's EVAL_MODEL_OVERRIDES really do change the models
  // inside the discovery graph, under both sides at once. The fix is not a
  // fourth condition here but the absence of this whole column: Launch renders
  // SideEnvEditors for a harness that carries sides, and states above them that
  // both sides run the same models and why no config is offered.
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
