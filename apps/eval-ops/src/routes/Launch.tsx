import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';

import { Frame } from '../components/Frame';
import { api, type HarnessDescriptor, type EvalRunSpec, type RunFlags } from '../api/client';

interface ConfigProfile {
  name: string;
  description: string;
  models: Record<string, string>;
  env: Record<string, string>;
}

interface LaunchState {
  harnesses: HarnessDescriptor[];
  profiles: ConfigProfile[];
  selectedHarness: HarnessDescriptor | null;
  selectedProfile: string;
  flags: RunFlags;
  awaitingConfirmation: boolean;
  error: string | null;
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
            profiles: profiles.profiles as ConfigProfile[],
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
    }));
  };

  const handleProfileChange = (profile: string) => {
    setState((prev) => ({
      ...prev,
      selectedProfile: profile,
      awaitingConfirmation: false,
    }));
  };

  const handleFlagChange = (name: keyof RunFlags, value: unknown) => {
    setState((prev) => ({
      ...prev,
      flags: { ...prev.flags, [name]: value },
      awaitingConfirmation: false,
    }));
  };

  const isFullCorpus = (): boolean => {
    const selectionFlags = ['case', 'rule', 'tier'] as const;
    return !selectionFlags.some((name) => state.flags[name] !== undefined);
  };

  const computeWorkload = (): number => {
    if (state.selectedHarness === null) return 0;
    const runs = state.flags.runs ?? state.selectedHarness.defaultRuns;
    const cases = isFullCorpus() ? state.selectedHarness.caseCount : 1;
    return cases * runs;
  };

  const handleRun = () => {
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
        setState((prev) => ({
          ...prev,
          error: error instanceof Error ? error.message : String(error),
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
  const workload = computeWorkload();

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
              {state.selectedHarness.flags.map((flag: { name: string; cli: string; kind: string }) => (
                <FlagInput
                  key={flag.name}
                  flag={flag}
                  value={state.flags[flag.name as keyof RunFlags]}
                  onChange={(value) => handleFlagChange(flag.name as keyof RunFlags, value)}
                />
              ))}
            </div>
          )}

          <div className="border-t border-term-rule pt-4 mt-4">
            <p className="mb-2">
              <span className="text-term-dim">Workload: </span>
              {state.selectedHarness?.caseCount ?? 0} cases × {state.flags.runs ?? state.selectedHarness?.defaultRuns ?? 0}{' '}
              runs = {workload}
            </p>

            {state.awaitingConfirmation ? (
              <div className="space-y-2">
                <p className="text-term-yellow">
                  Confirm full-corpus run: {workload} model invocations
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleRun}
                    className="px-[2ch] py-[0.5lh] bg-term-green text-term-bg font-bold"
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
                className="px-[2ch] py-[0.5lh] bg-term-cyan text-term-bg font-bold"
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
  flag: { name: string; cli: string; kind: string };
  value: unknown;
  onChange: (value: unknown) => void;
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
          min={1}
        />
      </div>
    );
  }

  // string kind
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
        onChange={(e) => {
          const val = e.target.value === '' ? undefined : e.target.value;
          if (val !== undefined && val.startsWith('-')) {
            return; // Reject values starting with '-' silently
          }
          onChange(val);
        }}
      />
      {typeof value === 'string' && value.startsWith('-') && (
        <p className="mt-1 text-term-red text-sm">Selection flag values may not begin with &apos;-&apos;</p>
      )}
    </div>
  );
}
