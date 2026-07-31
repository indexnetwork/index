import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { Frame } from '../components/Frame';
import { api, type EvalRunSpec, type HarnessDescriptor, type HarnessFlag, type ProfileDescriptor, type RunFlags } from '../api/client';

interface LaunchState {
  harnesses: HarnessDescriptor[];
  profiles: ProfileDescriptor[];
  selectedHarness: HarnessDescriptor | null;
  selectedProfile: string;
  flags: RunFlags;
  awaitingConfirmation: boolean;
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
    selectedHarness: null,
    selectedProfile: 'default',
    flags: {},
    awaitingConfirmation: false,
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

    const spec: EvalRunSpec = {
      kind: 'eval',
      harness: state.selectedHarness.harness,
      profile: state.selectedProfile,
      flags: state.flags,
    };

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
  const fullCorpus = isFullCorpus();
  const runs = state.flags.runs ?? state.selectedHarness?.defaultRuns ?? 0;
  // The same first factor renderRun uses: a narrowed selection runs exactly one case.
  const cases = state.selectedHarness === null ? 0 : fullCorpus ? state.selectedHarness.caseCount : 1;
  const workload = cases * runs;
  const launchBlocked = invalidSelectionFlags.length > 0;

  return (
    <div className="p-4">
      <Frame label="launch run">
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
            </select>
            {isExperimental && (
              <p className="mt-2 text-term-yellow">
                Experimental — forced to --no-save and never diffed against the committed baseline.
              </p>
            )}
          </div>

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
              {fullCorpus ? '' : ' (filtered)'} × {runs} runs = {workload}
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
