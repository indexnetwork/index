import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Frame } from '../components/Frame';
import { GuidedEnvEditor, envRowsToOverrides, type EnvOverrideRow } from '../components/GuidedEnvEditor';
import { ModelOverrideEditor } from '../components/ModelOverrideEditor';
import { api, type AgentMeta, type ConfigMetadata, type ConfigProfile, type EnvFlagMeta, type EvalRunSpec, type HarnessDescriptor, type HarnessFlag, type ModelMeta, type ProfileDescriptor, type RunFlags } from '../api/client';

/** One side's ad-hoc overrides: model choices plus guided env-flag rows. */
interface SideOverrides {
  models: Record<string, string>;
  envRows: EnvOverrideRow[];
  /** GuidedEnvEditor's verdict on envRows; empty rows are valid. */
  envValid: boolean;
}

const EMPTY_SIDE: SideOverrides = { models: {}, envRows: [], envValid: true };

interface LaunchState {
  harnesses: HarnessDescriptor[];
  profiles: ProfileDescriptor[];
  /** Saved (DB) configs, listed after the shipped repo profiles. */
  savedConfigs: ConfigProfile[];
  /** Guided-editing metadata; null when the endpoint cannot be reached. */
  metadata: ConfigMetadata | null;
  selectedHarness: HarnessDescriptor | null;
  selectedProfile: string;
  /** A/B mode: each side picks its own profile and carries its own overrides. */
  ab: boolean;
  referenceProfile: string;
  candidateProfile: string;
  referenceOverrides: SideOverrides;
  candidateOverrides: SideOverrides;
  flags: RunFlags;
  awaitingConfirmation: boolean;
  /** The "save as config…" inline form. */
  savingConfig: boolean;
  configName: string;
  configDescription: string;
  saveError: string | null;
  /** A failure loading the registry or the profiles: nothing can be launched. */
  error: string | null;
  /** A rejected launch. Rendered inline so the entered flags survive. */
  launchError: string | null;
}

/**
 * Plain-English presentation for the runner knobs, keyed by flag name. Every
 * explanation is grounded in the harness/runner code — see the eval shared
 * runner, baseline comparison, and matching harness sources. Unknown flags
 * fall back to their CLI spelling with no explanation.
 */
const FLAG_COPY: Readonly<Record<string, { label: string; help: string }>> = {
  runs: {
    label: 'Runs per case',
    help: 'How many times every case is executed; 3 lets flaky behavior show up.',
  },
  case: {
    label: 'Case filter',
    help: 'Only run cases whose id contains this text.',
  },
  rule: {
    label: 'Rule filter',
    help: 'Only run cases whose scoring rule contains this text.',
  },
  tier: {
    label: 'Tier filter',
    help: 'Only run cases from this corpus tier.',
  },
  alpha: {
    label: 'Significance level',
    help: 'How strict the regression test against the baseline is — smaller is stricter (default 0.05).',
  },
  attemptTimeoutMs: {
    label: 'Attempt timeout (ms)',
    help: 'Cancel a single model attempt after this many milliseconds.',
  },
  noJudge: {
    label: 'Skip the judge model',
    help: 'Every judgment auto-passes — fast and free, but scores say nothing about judgment quality.',
  },
  strictEvidence: {
    label: 'Strict evidence',
    help: 'Fail the run when any requested case run is incomplete, instead of recording partial evidence.',
  },
};

export function Launch() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<LaunchState>({
    harnesses: [],
    profiles: [],
    savedConfigs: [],
    metadata: null,
    selectedHarness: null,
    // The configs page links here as /launch?profile=<name>.
    selectedProfile: searchParams.get('profile') ?? 'default',
    ab: false,
    referenceProfile: 'default',
    candidateProfile: 'default',
    referenceOverrides: EMPTY_SIDE,
    candidateOverrides: EMPTY_SIDE,
    flags: {},
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

    Promise.all([api.harnesses(), api.profiles()])
      .then(([harnesses, profiles]) => {
        if (mounted) {
          const firstHarness = harnesses.harnesses[0] ?? null;
          setState((prev) => ({
            ...prev,
            harnesses: harnesses.harnesses,
            profiles: profiles.profiles,
            selectedHarness: firstHarness,
          }));
        }
      })
      .catch((error) => {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

    // Saved configs enhance the form but must never break it: failures are swallowed.
    api
      .configs()
      .then((result) => {
        if (!mounted) return;
        const saved = result.saved ?? [];
        setState((prev) => ({ ...prev, savedConfigs: saved }));
      })
      .catch(() => {});
    // Guided-editing metadata (flag descriptions, agent roles, model blurbs).
    // Without it the guided sections hide; the plain form keeps working.
    api
      .configMetadata()
      .then((result) => {
        if (!mounted) return;
        const metadata: ConfigMetadata = {
          env: result.env ?? [],
          models: result.models ?? [],
          harnessAgents: result.harnessAgents ?? {},
        };
        setState((prev) => ({ ...prev, metadata }));
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const handleHarnessChange = (harness: string) => {
    const descriptor = state.harnesses.find((h) => h.harness === harness) ?? null;
    setState((prev) => ({
      ...prev,
      selectedHarness: descriptor,
      flags: {},
      // Overrides name agents; a different harness exercises different agents.
      referenceOverrides: EMPTY_SIDE,
      candidateOverrides: EMPTY_SIDE,
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  const handleProfileChange = (profile: string) => {
    setState((prev) => ({
      ...prev,
      selectedProfile: profile,
      awaitingConfirmation: false,
      launchError: null,
    }));
  };

  const handleFlagChange = (name: HarnessFlag['name'], value: string | number | boolean | undefined) => {
    setState((prev) => {
      const flags: RunFlags = { ...prev.flags };
      if (value === undefined) {
        delete flags[name];
      } else {
        // Discriminated assignment preserves the key/value type relation that a
        // computed-key Object.assign would defeat.
        switch (name) {
          case 'runs':
            flags.runs = value as number;
            break;
          case 'tier':
            flags.tier = value as number;
            break;
          case 'alpha':
            flags.alpha = value as number;
            break;
          case 'attemptTimeoutMs':
            flags.attemptTimeoutMs = value as number;
            break;
          case 'case':
            flags.case = value as string;
            break;
          case 'rule':
            flags.rule = value as string;
            break;
          case 'noJudge':
            flags.noJudge = value as boolean;
            break;
          case 'strictEvidence':
            flags.strictEvidence = value as boolean;
            break;
        }
      }
      return { ...prev, flags, awaitingConfirmation: false, launchError: null };
    });
  };

  const isFullCorpus = (): boolean => {
    const selectionFlags = ['case', 'rule', 'tier'] as const;
    return !selectionFlags.some((name) => state.flags[name] !== undefined);
  };

  /**
   * A selection value beginning with "-" would arrive at the harness's parser
   * looking like a flag. The server rejects it (SelectionValueSchema); the form
   * says so and refuses to submit rather than silently discarding the keystroke.
   */
  const invalidSelectionFlags = (Object.entries(state.flags) as [string, unknown][])
    .filter(([, value]) => typeof value === 'string' && value.startsWith('-'))
    .map(([name]) => state.selectedHarness?.flags.find((flag) => flag.name === name)?.cli ?? `--${name}`);

  /**
   * Overrides are only expressible on top of the default configuration — the
   * server refuses a named profile combined with overrides, so the form never
   * offers the combination.
   */
  const buildSpec = (profile: string, side: SideOverrides): EvalRunSpec => {
    const env = envRowsToOverrides(side.envRows);
    const hasModels = Object.keys(side.models).length > 0;
    const hasEnv = Object.keys(env).length > 0;
    return {
      kind: 'eval',
      harness: state.selectedHarness!.harness,
      profile,
      flags: state.flags,
      ...(profile === 'default' && (hasModels || hasEnv)
        ? { overrides: { models: side.models, env } }
        : {}),
    };
  };

  const handleRun = () => {
    if (launchBlocked) return;

    if (isFullCorpus() && !state.awaitingConfirmation) {
      setState((prev) => ({ ...prev, awaitingConfirmation: true }));
      return;
    }

    if (state.selectedHarness === null) {
      setState((prev) => ({ ...prev, error: 'No harness selected' }));
      return;
    }

    if (state.ab) {
      // Reference first, candidate second: they serialise through the run
      // queue, which keeps the comparison fair on one machine.
      const referenceSpec = buildSpec(state.referenceProfile, state.referenceOverrides);
      const candidateSpec = buildSpec(state.candidateProfile, state.candidateOverrides);
      api
        .launch(referenceSpec)
        .then((reference) =>
          api.launch(candidateSpec).then((candidate) => ({ reference, candidate })),
        )
        .then(({ reference, candidate }) => {
          navigate(`/compare?referenceRun=${reference.id}&subjectRun=${candidate.id}`);
        })
        .catch((error) => {
          setState((prev) => ({
            ...prev,
            launchError: error instanceof Error ? error.message : String(error),
            awaitingConfirmation: false,
          }));
        });
      return;
    }

    const spec = buildSpec(state.selectedProfile, state.referenceOverrides);

    api
      .launch(spec)
      .then((record) => {
        navigate(`/r/${record.id}`);
      })
      .catch((error) => {
        // The form stays mounted: every entered flag survives a rejected launch.
        setState((prev) => ({
          ...prev,
          launchError: error instanceof Error ? error.message : String(error),
          awaitingConfirmation: false,
        }));
      });
  };

  const handleSaveConfig = () => {
    const name = state.configName.trim();
    const description = state.configDescription.trim();
    const env = envRowsToOverrides(state.referenceOverrides.envRows);
    const hasValues = Object.keys(state.referenceOverrides.models).length > 0 || Object.keys(env).length > 0;
    if (name === '' || description === '' || !hasValues) return;
    const profile: ConfigProfile = { name, description, models: state.referenceOverrides.models, env };
    api
      .createConfig(profile)
      .then((created) => {
        setState((prev) => ({
          ...prev,
          savedConfigs: [...prev.savedConfigs, created],
          selectedProfile: created.name,
          savingConfig: false,
          configName: '',
          configDescription: '',
          saveError: null,
          // The overrides now live in the saved config; the editors reset.
          referenceOverrides: EMPTY_SIDE,
          candidateOverrides: EMPTY_SIDE,
        }));
      })
      .catch((error) => {
        setState((prev) => ({
          ...prev,
          saveError: error instanceof Error ? error.message : String(error),
        }));
      });
  };

  const handleCancelConfirmation = () => {
    setState((prev) => ({ ...prev, awaitingConfirmation: false }));
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

  const isExperimental = state.selectedProfile !== 'default';
  const overridesAllowed = state.selectedProfile === 'default';
  const fullCorpus = isFullCorpus();
  const runs = state.flags.runs ?? state.selectedHarness?.defaultRuns ?? 0;
  // The same first factor renderRun uses: a narrowed selection runs exactly one case.
  const cases = state.selectedHarness === null ? 0 : fullCorpus ? state.selectedHarness.caseCount : 1;
  const workload = cases * runs * (state.ab ? 2 : 1);

  // Guided-editing inputs derived from the metadata (empty when unavailable).
  const harnessId = state.selectedHarness?.harness ?? null;
  const agents: readonly AgentMeta[] =
    harnessId === null ? [] : (state.metadata?.harnessAgents[harnessId] ?? []);
  const guidedModels: readonly ModelMeta[] = state.metadata?.models ?? [];
  const envFlags: readonly EnvFlagMeta[] = state.metadata?.env ?? [];
  // The default option in each model dropdown names what the default profile assigns.
  const profileDefaults = state.profiles.find((p) => p.name === 'default')?.models ?? {};

  // Only visible env editors participate in validity; hidden ones cannot block.
  const envValidity = (profile: string, side: SideOverrides): boolean =>
    profile === 'default' && envFlags.length > 0 ? side.envValid : true;
  const envInputValid = state.ab
    ? envValidity(state.referenceProfile, state.referenceOverrides) &&
      envValidity(state.candidateProfile, state.candidateOverrides)
    : envValidity(state.selectedProfile, state.referenceOverrides);

  const launchBlocked = invalidSelectionFlags.length > 0 || !envInputValid;
  const singleEnv = envRowsToOverrides(state.referenceOverrides.envRows);
  const showSaveConfig =
    overridesAllowed &&
    (Object.keys(state.referenceOverrides.models).length > 0 || Object.keys(singleEnv).length > 0);

  const sideProps = {
    agents,
    guidedModels,
    profileDefaults,
    envFlags,
    profiles: state.profiles,
    savedConfigs: state.savedConfigs,
  };

  return (
    <div className="p-4">
      <Frame label={state.ab ? 'launch a/b run' : 'launch run'}>
        <div className="space-y-4">
          <div>
            <label htmlFor="harness" className="block mb-1">
              Harness
            </label>
            <select
              id="harness"
              className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
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
              <p className="text-term-dim mt-1">
                {state.selectedHarness.question} {state.selectedHarness.detail}
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={state.ab}
                onChange={(e) => {
                  const ab = e.target.checked;
                  setState((prev) => ({
                    ...prev,
                    ab,
                    // The single-mode profile is the reference side's starting point.
                    referenceProfile: ab ? prev.selectedProfile : prev.referenceProfile,
                    awaitingConfirmation: false,
                    launchError: null,
                  }));
                }}
              />
              <span>A/B — compare two configurations</span>
            </label>
            {state.ab && (
              <p className="text-term-dim mt-1">
                Two runs back to back — reference first, then candidate — with the comparison shown
                when both end.
              </p>
            )}
          </div>

          {!state.ab && (
            <div className="space-y-3">
              <h3 className="text-term-cyan">What controls this run</h3>
              <div>
                <label htmlFor="profile" className="block mb-1">
                  Configuration profile
                </label>
                <select
                  id="profile"
                  className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                  value={state.selectedProfile}
                  onChange={(e) => handleProfileChange(e.target.value)}
                >
                  {state.profiles.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} — {p.description}
                    </option>
                  ))}
                  {state.savedConfigs.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} (saved) — {p.description}
                    </option>
                  ))}
                </select>
                <p className="text-term-dim mt-1">The named configuration this run executes under.</p>
                {isExperimental && (
                  <p className="mt-2 text-term-yellow">
                    Experimental — forced to --no-save and never diffed against the committed baseline.
                  </p>
                )}
              </div>

              {overridesAllowed && agents.length > 0 && (
                <ModelOverrideEditor
                  agents={agents}
                  models={guidedModels}
                  profileDefaults={profileDefaults}
                  value={state.referenceOverrides.models}
                  onChange={(models) =>
                    setState((prev) => ({
                      ...prev,
                      referenceOverrides: { ...prev.referenceOverrides, models },
                    }))
                  }
                />
              )}
              {!overridesAllowed && (
                <p className="text-term-dim">
                  Overrides apply on top of the default configuration. To tweak a saved config,{' '}
                  <Link to="/profiles" className="text-term-cyan underline">
                    edit it on the configs page
                  </Link>
                  .
                </p>
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
                  <div>
                    <label htmlFor="config-name" className="block mb-1 text-term-dim">
                      config name
                    </label>
                    <input
                      id="config-name"
                      type="text"
                      placeholder="kebab-case-name"
                      className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                      value={state.configName}
                      onChange={(e) => setState((prev) => ({ ...prev, configName: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label htmlFor="config-description" className="block mb-1 text-term-dim">
                      config description
                    </label>
                    <input
                      id="config-description"
                      type="text"
                      placeholder="what this config is for"
                      className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                      value={state.configDescription}
                      onChange={(e) =>
                        setState((prev) => ({ ...prev, configDescription: e.target.value }))
                      }
                    />
                  </div>
                  {state.saveError !== null && (
                    <p role="alert" className="text-term-red">
                      {state.saveError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="px-[2ch] py-[0.5lh] bg-term-cyan text-term-bg font-bold disabled:opacity-50"
                      disabled={state.configName.trim() === '' || state.configDescription.trim() === ''}
                      onClick={handleSaveConfig}
                    >
                      Save config
                    </button>
                    <button
                      type="button"
                      className="px-[2ch] py-[0.5lh] border border-term-rule"
                      onClick={() =>
                        setState((prev) => ({ ...prev, savingConfig: false, saveError: null }))
                      }
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {state.ab && (
            <div className="space-y-4">
              <AbSide
                side="reference"
                profile={state.referenceProfile}
                overrides={state.referenceOverrides}
                {...sideProps}
                onProfileChange={(profile) =>
                  setState((prev) => ({
                    ...prev,
                    referenceProfile: profile,
                    awaitingConfirmation: false,
                    launchError: null,
                  }))
                }
                onOverridesChange={(next) =>
                  setState((prev) => ({ ...prev, referenceOverrides: next }))
                }
              />
              <AbSide
                side="candidate"
                profile={state.candidateProfile}
                overrides={state.candidateOverrides}
                {...sideProps}
                onProfileChange={(profile) =>
                  setState((prev) => ({
                    ...prev,
                    candidateProfile: profile,
                    awaitingConfirmation: false,
                    launchError: null,
                  }))
                }
                onOverridesChange={(next) =>
                  setState((prev) => ({ ...prev, candidateOverrides: next }))
                }
              />
            </div>
          )}

          {state.selectedHarness !== null && (
            <details>
              <summary className="cursor-pointer text-term-cyan">Advanced options</summary>
              <div className="mt-2 space-y-3">
                {state.selectedHarness.flags.map((flag) => (
                  <FlagInput
                    key={flag.name}
                    flag={flag}
                    value={state.flags[flag.name]}
                    onChange={(value) => handleFlagChange(flag.name, value)}
                  />
                ))}
              </div>
            </details>
          )}

          {!state.ab && overridesAllowed && envFlags.length > 0 && (
            <details>
              <summary className="cursor-pointer text-term-cyan">
                Advanced: live-pipeline flags
              </summary>
              <div className="mt-2 space-y-3">
                <p className="text-term-dim">
                  These flags tune the live discovery and negotiation services. This scorecard
                  harness does not read them — they are recorded with the run for staging work.
                </p>
                <GuidedEnvEditor
                  flags={envFlags}
                  rows={state.referenceOverrides.envRows}
                  onChange={(envRows, envValid) =>
                    setState((prev) => ({
                      ...prev,
                      referenceOverrides: { ...prev.referenceOverrides, envRows, envValid },
                    }))
                  }
                />
              </div>
            </details>
          )}

          <div className="border-t border-term-rule pt-4 mt-4">
            <p className="mb-2">
              <span className="text-term-dim">Workload: </span>
              {cases} {cases === 1 ? 'case' : 'cases'}
              {fullCorpus ? '' : ' (filtered)'} × {runs} runs{state.ab ? ' × 2 sides' : ''} = {workload}
            </p>

            {invalidSelectionFlags.length > 0 && (
              <p className="mb-2 text-term-red">
                Fix {invalidSelectionFlags.join(', ')} before running.
              </p>
            )}

            {!envInputValid && (
              <p className="mb-2 text-term-red">Resolve the invalid flag value above to launch.</p>
            )}

            {state.launchError !== null && (
              <p role="alert" className="mb-2 text-term-red">
                Launch refused: {state.launchError}
              </p>
            )}

            {state.awaitingConfirmation ? (
              <div className="space-y-2">
                <p className="text-term-yellow">
                  Confirm full-corpus run: {workload} model invocations
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRun}
                    disabled={launchBlocked}
                    className="px-[2ch] py-[0.5lh] bg-term-green text-term-bg font-bold disabled:opacity-50"
                  >
                    Confirm and Run
                  </button>
                  <button
                    onClick={handleCancelConfirmation}
                    className="px-[2ch] py-[0.5lh] border border-term-rule"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleRun}
                disabled={launchBlocked}
                className="px-[2ch] py-[0.5lh] bg-term-cyan text-term-bg font-bold disabled:opacity-50"
              >
                Run
              </button>
            )}
          </div>
        </div>
      </Frame>
    </div>
  );
}

/**
 * One side of an A/B launch: its own profile select (repo profiles, then saved
 * configs), its own model editor, and its own live-pipeline env disclosure.
 * Overrides are only expressible on top of the default configuration — the
 * server refuses a named profile combined with overrides — so a named profile
 * replaces the editors with the configs-page pointer.
 */
function AbSide({
  side,
  profile,
  overrides,
  agents,
  guidedModels,
  profileDefaults,
  envFlags,
  profiles,
  savedConfigs,
  onProfileChange,
  onOverridesChange,
}: {
  side: 'reference' | 'candidate';
  profile: string;
  overrides: SideOverrides;
  agents: readonly AgentMeta[];
  guidedModels: readonly ModelMeta[];
  profileDefaults: Record<string, string>;
  envFlags: readonly EnvFlagMeta[];
  profiles: ProfileDescriptor[];
  savedConfigs: ConfigProfile[];
  onProfileChange: (profile: string) => void;
  onOverridesChange: (next: SideOverrides) => void;
}) {
  return (
    <fieldset aria-label={side} className="border border-term-rule p-2 space-y-3">
      <legend className="px-[1ch] text-term-dim">{side}</legend>
      <div>
        <label htmlFor={`${side}-profile`} className="block mb-1">
          profile
        </label>
        <select
          id={`${side}-profile`}
          className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
          value={profile}
          onChange={(e) => onProfileChange(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} — {p.description}
            </option>
          ))}
          {savedConfigs.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name} (saved) — {p.description}
            </option>
          ))}
        </select>
      </div>
      {profile !== 'default' && (
        <p className="text-term-yellow">
          Experimental — forced to --no-save and never diffed against the committed baseline.
        </p>
      )}
      {profile === 'default' ? (
        <>
          {agents.length > 0 && (
            <ModelOverrideEditor
              agents={agents}
              models={guidedModels}
              profileDefaults={profileDefaults}
              value={overrides.models}
              onChange={(models) => onOverridesChange({ ...overrides, models })}
            />
          )}
          {envFlags.length > 0 && (
            <details>
              <summary className="cursor-pointer text-term-cyan">
                Advanced: live-pipeline flags
              </summary>
              <div className="mt-2 space-y-3">
                <p className="text-term-dim">
                  These flags tune the live discovery and negotiation services. This scorecard
                  harness does not read them — they are recorded with the run for staging work.
                </p>
                <GuidedEnvEditor
                  flags={envFlags}
                  rows={overrides.envRows}
                  onChange={(envRows, envValid) => onOverridesChange({ ...overrides, envRows, envValid })}
                />
              </div>
            </details>
          )}
        </>
      ) : (
        <p className="text-term-dim">
          Overrides apply on top of the default configuration. To tweak a saved config,{' '}
          <Link to="/profiles" className="text-term-cyan underline">
            edit it on the configs page
          </Link>
          .
        </p>
      )}
    </fieldset>
  );
}

function FlagInput({
  flag,
  value,
  onChange,
}: {
  flag: HarnessFlag;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean | undefined) => void;
}) {
  const copy = FLAG_COPY[flag.name];
  const label = copy?.label ?? flag.cli;

  if (flag.kind === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked || undefined)}
          />
          <span>{label}</span>
        </label>
        {copy !== undefined && <p className="mt-1 text-term-dim">{copy.help}</p>}
      </div>
    );
  }

  if (flag.kind === 'number') {
    return (
      <div>
        <label htmlFor={flag.name} className="block mb-1">
          {label}
        </label>
        <input
          type="number"
          id={flag.name}
          className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            const num = e.target.value === '' ? undefined : Number(e.target.value);
            onChange(num);
          }}
          min={flag.min}
          max={flag.max}
          step={flag.step}
        />
        {copy !== undefined && (
          <p className="mt-1 text-term-dim">
            {copy.help} <span className="text-term-dim">({flag.cli})</span>
          </p>
        )}
      </div>
    );
  }

  // string kind
  const invalid = typeof value === 'string' && value.startsWith('-');
  return (
    <div>
      <label htmlFor={flag.name} className="block mb-1">
        {label}
      </label>
      <input
        type="text"
        id={flag.name}
        className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
        value={typeof value === 'string' ? value : ''}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
      {copy !== undefined && (
        <p className="mt-1 text-term-dim">
          {copy.help} <span className="text-term-dim">({flag.cli})</span>
        </p>
      )}
      {invalid && (
        <p className="mt-1 text-term-red text-sm">
          {flag.cli} values may not begin with &apos;-&apos;
        </p>
      )}
    </div>
  );
}
