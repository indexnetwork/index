import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Frame } from '../components/Frame';
import { ModelOverrideEditor } from '../components/ModelOverrideEditor';
import { api, type AgentMeta, type ConfigMetadata, type ConfigProfile, type EvalRunSpec, type FlagMeta, type HarnessDescriptor, type HarnessFlag, type ModelMeta, type ProfileDescriptor, type RunFlags } from '../api/client';

/**
 * Flags that decide WHICH cases run. Two runs that disagree here are not
 * comparable at all (the comparison refuses on a selection mismatch), so the
 * A/B form shares one control for these between both sides.
 */
const SELECTION_FLAGS = ['runs', 'case', 'rule', 'tier'] as const;

/** A/B side ids. "reference" runs first, "candidate" second. */
type Side = 'reference' | 'candidate';

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
  awaitingConfirmation: boolean;
  savingConfig: boolean;
  configName: string;
  configDescription: string;
  saveError: string | null;
  error: string | null;
  launchError: string | null;
}

const EMPTY_FLAGS: RunFlags = {};

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
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

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

    if (isFullCorpus() && !state.awaitingConfirmation) {
      setState((prev) => ({ ...prev, awaitingConfirmation: true }));
      return;
    }

    const fail = (error: unknown) =>
      setState((prev) => ({
        ...prev,
        launchError: error instanceof Error ? error.message : String(error),
        awaitingConfirmation: false,
      }));

    if (state.ab) {
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

  const harnessId = state.selectedHarness?.harness ?? null;
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
  const workload = cases * runs * (state.ab ? 2 : 1);

  // Scoring differences are legitimate to compare but change what a verdict
  // means, so the form says so instead of presenting the diff as like-for-like.
  const scoringDiffers =
    state.ab && JSON.stringify(state.scoring.reference) !== JSON.stringify(state.scoring.candidate);

  const launchBlocked = invalidSelectionFlags.length > 0;
  const saveConfigBlocked =
    state.configName.trim() === '' ||
    state.configDescription.trim() === '' ||
    Object.keys(state.models.reference).length === 0;
  const showSaveConfig =
    !state.ab &&
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
      <Frame label={state.ab ? 'launch a/b' : 'launch'}>
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
            <label className="flex items-center gap-2 shrink-0">
              <input
                type="checkbox"
                checked={state.ab}
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
          </div>

          {state.ab ? (
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
                What gets tested{state.ab ? ' — shared by both sides' : ''}
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
                {fullCorpus ? '' : ' (filtered)'} × {runs} runs{state.ab ? ' × 2 sides' : ''} ={' '}
                {workload}
              </p>
              {invalidSelectionFlags.length > 0 && (
                <p className="text-term-red">Fix {invalidSelectionFlags.join(', ')} before running.</p>
              )}
              {state.launchError !== null && (
                <p role="alert" className="text-term-red">
                  Launch refused: {state.launchError}
                </p>
              )}
              {state.awaitingConfirmation && (
                <p className="text-term-yellow">
                  Confirm full-corpus run: {workload} model invocations
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
                {state.awaitingConfirmation ? 'Confirm and Run' : state.ab ? 'Run A/B' : 'Run'}
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
