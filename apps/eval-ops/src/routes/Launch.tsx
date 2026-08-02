import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Frame } from '../components/Frame';
import { cleanOverrides, EMPTY_OVERRIDES, hasOverrides, OverridesEditor, type Overrides } from '../components/OverridesEditor';
import { PROFILE_ENV_ALLOWLIST } from '../../../../packages/protocol/eval/ops/ops.allowlist';
import { api, type ConfigProfile, type EvalRunSpec, type HarnessDescriptor, type HarnessFlag, type ProfileDescriptor, type RunFlags } from '../api/client';

interface LaunchState {
  harnesses: HarnessDescriptor[];
  profiles: ProfileDescriptor[];
  /** Saved (DB) configs, listed after the shipped repo profiles. */
  savedConfigs: ConfigProfile[];
  /** The curated model list for the override dropdowns. */
  models: string[];
  selectedHarness: HarnessDescriptor | null;
  selectedProfile: string;
  /** A/B mode: reference and candidate each carry their own overrides. */
  ab: boolean;
  referenceOverrides: Overrides;
  candidateOverrides: Overrides;
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

export function Launch() {
  const navigate = useNavigate();
  const [state, setState] = useState<LaunchState>({
    harnesses: [],
    profiles: [],
    savedConfigs: [],
    models: [],
    selectedHarness: null,
    selectedProfile: 'default',
    ab: false,
    referenceOverrides: EMPTY_OVERRIDES,
    candidateOverrides: EMPTY_OVERRIDES,
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

    // Saved configs and the curated model list enhance the form but must never
    // break it: both settle independently and failures are swallowed.
    api
      .configs()
      .then((result) => {
        if (!mounted) return;
        const saved = result.saved ?? [];
        setState((prev) => ({ ...prev, savedConfigs: saved }));
      })
      .catch(() => {});
    api
      .configModels()
      .then((result) => {
        if (!mounted) return;
        const models = result.models ?? [];
        setState((prev) => ({ ...prev, models }));
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
      referenceOverrides: EMPTY_OVERRIDES,
      candidateOverrides: EMPTY_OVERRIDES,
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
  const buildSpec = (overrides: Overrides): EvalRunSpec => {
    const cleaned = cleanOverrides(overrides);
    return {
      kind: 'eval',
      harness: state.selectedHarness!.harness,
      profile: state.selectedProfile,
      flags: state.flags,
      ...(state.selectedProfile === 'default' && hasOverrides(cleaned) ? { overrides: cleaned } : {}),
    };
  };

  const handleRun = () => {
    if (invalidSelectionFlags.length > 0) return;

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
      const referenceSpec = buildSpec(state.referenceOverrides);
      const candidateSpec = buildSpec(state.candidateOverrides);
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

    const spec = buildSpec(state.referenceOverrides);

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
    const cleaned = cleanOverrides(state.referenceOverrides);
    const name = state.configName.trim();
    const description = state.configDescription.trim();
    if (name === '' || description === '' || !hasOverrides(cleaned)) return;
    const profile: ConfigProfile = { name, description, models: cleaned.models, env: cleaned.env };
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
          referenceOverrides: EMPTY_OVERRIDES,
          candidateOverrides: EMPTY_OVERRIDES,
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
  const launchBlocked = invalidSelectionFlags.length > 0;
  const agents = state.selectedHarness?.agents ?? [];
  const showSaveConfig =
    overridesAllowed && hasOverrides(cleanOverrides(state.referenceOverrides));

  const editorProps = { agents, models: state.models, envKeys: PROFILE_ENV_ALLOWLIST };

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
            <label htmlFor="profile" className="block mb-1">
              Configuration Profile
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
            {isExperimental && (
              <p className="mt-2 text-term-yellow">
                Experimental — forced to --no-save and never diffed against the committed baseline.
              </p>
            )}
          </div>

          <div>
            <label className="flex items-center gap-2">
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
              <span>A/B — compare two configurations</span>
            </label>
            {state.ab && (
              <p className="text-term-dim mt-1">
                Two runs back to back — reference first, then candidate — with the comparison shown
                when both end.
              </p>
            )}
          </div>

          <details>
            <summary className="cursor-pointer text-term-cyan">overrides (this run only)</summary>
            <div className="mt-2 space-y-3">
              {!overridesAllowed && (
                <p className="text-term-dim">
                  Overrides apply on top of the default configuration. To tweak a saved config,{' '}
                  <Link to="/profiles" className="text-term-cyan underline">
                    edit it on the configs page
                  </Link>
                  .
                </p>
              )}
              {overridesAllowed && state.ab && (
                <div className="space-y-4">
                  <fieldset aria-label="reference" className="border border-term-rule p-2">
                    <legend className="px-[1ch] text-term-dim">reference</legend>
                    <OverridesEditor
                      {...editorProps}
                      value={state.referenceOverrides}
                      onChange={(next) => setState((prev) => ({ ...prev, referenceOverrides: next }))}
                    />
                  </fieldset>
                  <fieldset aria-label="candidate" className="border border-term-rule p-2">
                    <legend className="px-[1ch] text-term-dim">candidate</legend>
                    <OverridesEditor
                      {...editorProps}
                      value={state.candidateOverrides}
                      onChange={(next) => setState((prev) => ({ ...prev, candidateOverrides: next }))}
                    />
                  </fieldset>
                </div>
              )}
              {overridesAllowed && !state.ab && (
                <>
                  <OverridesEditor
                    {...editorProps}
                    value={state.referenceOverrides}
                    onChange={(next) => setState((prev) => ({ ...prev, referenceOverrides: next }))}
                  />
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
                </>
              )}
            </div>
          </details>

          {state.selectedHarness !== null && (
            <div className="space-y-3">
              <h3 className="text-term-cyan">Flags</h3>
              {state.selectedHarness.flags.map((flag) => (
                <FlagInput
                  key={flag.name}
                  flag={flag}
                  value={state.flags[flag.name]}
                  onChange={(value) => handleFlagChange(flag.name, value)}
                />
              ))}
            </div>
          )}

          <div className="border-t border-term-rule pt-4 mt-4">
            <p className="mb-2">
              <span className="text-term-dim">Workload: </span>
              {cases} {cases === 1 ? 'case' : 'cases'}
              {fullCorpus ? '' : ' (filtered)'} × {runs} runs{state.ab ? ' × 2 sides' : ''} = {workload}
            </p>

            {launchBlocked && (
              <p className="mb-2 text-term-red">
                Fix {invalidSelectionFlags.join(', ')} before running.
              </p>
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

function FlagInput({
  flag,
  value,
  onChange,
}: {
  flag: HarnessFlag;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean | undefined) => void;
}) {
  if (flag.kind === 'boolean') {
    return (
      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked || undefined)}
          />
          <span>{flag.cli}</span>
        </label>
      </div>
    );
  }

  if (flag.kind === 'number') {
    return (
      <div>
        <label htmlFor={flag.name} className="block mb-1">
          {flag.cli}
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
      </div>
    );
  }

  // string kind
  const invalid = typeof value === 'string' && value.startsWith('-');
  return (
    <div>
      <label htmlFor={flag.name} className="block mb-1">
        {flag.cli}
      </label>
      <input
        type="text"
        id={flag.name}
        className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
        value={typeof value === 'string' ? value : ''}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
      {invalid && (
        <p className="mt-1 text-term-red text-sm">
          {flag.cli} values may not begin with &apos;-&apos;
        </p>
      )}
    </div>
  );
}
