import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Frame } from '../components/Frame';
import { StatusChip } from '../components/StatusChip';
import { api, type RunRecord } from '../api/client';

interface ConfigProfile {
  name: string;
  description: string;
  models: Record<string, string>;
  env: Record<string, string>;
}

interface ProfilesState {
  profiles: ConfigProfile[];
  runs: RunRecord[];
  error: string | null;
}

export function Profiles() {
  const [state, setState] = useState<ProfilesState>({
    profiles: [],
    runs: [],
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    Promise.all([api.profiles(), api.runs()])
      .then(([profiles, runs]) => {
        if (mounted) {
          setState({
            profiles: profiles.profiles as ConfigProfile[],
            runs: runs.runs,
            error: null,
          });
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

  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  if (state.profiles.length === 0) {
    return (
      <div className="p-4">
        <Frame label="profiles">
          <p className="text-term-dim">Loading...</p>
        </Frame>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Frame label="configuration profiles">
        <div className="mb-4">
          <p className="text-term-dim mb-2">
            Profiles are committed files in{' '}
            <code className="text-term-cyan">packages/protocol/eval/ops/profiles/</code>.
          </p>
          <p className="text-term-dim">
            They are edited in the repository, not in the browser, so every configuration change is
            code-reviewed and versioned alongside the harnesses themselves. This prevents
            accidentally comparing runs made under different model or environment settings.
          </p>
        </div>

        <div className="space-y-6">
          {state.profiles.map((profile) => {
            const profileRuns = state.runs.filter(
              (r) => r.spec.kind === 'eval' && r.spec.profile === profile.name,
            );

            return (
              <div key={profile.name} className="border-t border-term-rule pt-4 first:border-0 first:pt-0">
                <h3 className="text-term-cyan text-lg mb-2">{profile.name}</h3>
                <p className="text-term-dim mb-3">{profile.description}</p>

                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-3">
                  <span className="text-term-dim">Model overrides:</span>
                  <span>
                    {Object.keys(profile.models).length === 0 ? (
                      <span className="text-term-dim">none</span>
                    ) : (
                      <ul className="space-y-1">
                        {Object.entries(profile.models).map(([agent, model]) => (
                          <li key={agent}>
                            <code className="text-term-green">{agent}</code> →{' '}
                            <code className="text-term-white">{model}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>

                  <span className="text-term-dim">Environment overrides:</span>
                  <span>
                    {Object.keys(profile.env).length === 0 ? (
                      <span className="text-term-dim">none</span>
                    ) : (
                      <ul className="space-y-1">
                        {Object.entries(profile.env).map(([key, value]) => (
                          <li key={key}>
                            <code className="text-term-green">{key}</code> ={' '}
                            <code className="text-term-white">{value}</code>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>

                  <span className="text-term-dim">Runs:</span>
                  <span>
                    {profileRuns.length === 0 ? (
                      <span className="text-term-dim">none</span>
                    ) : (
                      <div className="space-y-1">
                        {profileRuns.slice(0, 5).map((run) => (
                          <div key={run.id}>
                            <Link to={`/r/${run.id}`} className="text-term-cyan hover:underline">
                              {run.id}
                            </Link>{' '}
                            — <StatusChip status={run.status} /> —{' '}
                            {run.spec.kind === 'eval' && run.spec.harness} —{' '}
                            {new Date(run.createdAt).toLocaleString()}
                          </div>
                        ))}
                        {profileRuns.length > 5 && (
                          <p className="text-term-dim text-xs">
                            +{profileRuns.length - 5} more
                          </p>
                        )}
                      </div>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Frame>
    </div>
  );
}
