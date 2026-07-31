import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Frame } from '../components/Frame';
import { api, type FixtureStatus } from '../api/client';

interface FixtureState {
  status: FixtureStatus | null;
  error: string | null;
  armed: boolean;
  confirmInput: string;
  personas: number;
  resetting: boolean;
}

export function Fixture() {
  const navigate = useNavigate();
  const [state, setState] = useState<FixtureState>({
    status: null,
    error: null,
    armed: false,
    confirmInput: '',
    personas: 50,
    resetting: false,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const status = await api.fixture();
        if (mounted) {
          setState((prev) => ({ ...prev, status, error: null }));
        }
      } catch (error) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    }

    void load();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleReset() {
    if (!state.status || !state.status.allowed) return;

    setState((prev) => ({ ...prev, resetting: true, error: null }));
    try {
      const run = await api.reset({
        confirmDatabaseName: state.confirmInput,
        personas: state.personas,
      });
      // Navigate to the run detail page to show the live log
      navigate(`/r/${run.id}`);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        resetting: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  if (state.error !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.error}</p>
        </Frame>
      </div>
    );
  }

  if (state.status === null) {
    return (
      <div className="p-4">
        <p className="text-term-dim">Loading...</p>
      </div>
    );
  }

  if (!state.status.allowed) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-term-blue hover:underline">
            ← overview
          </Link>
        </div>

        <Frame label="fixture">
          <div className="space-y-4">
            <div>
              <p className="text-term-red font-bold mb-2">Access Denied</p>
              <p className="text-term-dim">{state.status.reason}</p>
            </div>
            <p className="text-term-dim text-sm">
              Fixture control is unavailable until DATABASE_URL in .env.test points to a
              dedicated disposable database with migrations applied.
            </p>
          </div>
        </Frame>
      </div>
    );
  }

  const { target, maxPersonas, appliesMigrationsOnReset, personaCount, personaEmails, tables, countsError } =
    state.status;

  const confirmMatches = state.confirmInput === target.databaseName;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <Link to="/" className="text-term-blue hover:underline">
          ← overview
        </Link>
      </div>

      <Frame label="fixture">
        <div className="space-y-4">
          <div>
            <h3 className="text-term-dim mb-2">Target Database</h3>
            <div className="space-y-1 ml-4">
              <div className="flex gap-4">
                <span className="text-term-dim w-32">database:</span>
                <span className="font-mono">{target.databaseName}</span>
              </div>
              <div className="flex gap-4">
                <span className="text-term-dim w-32">host:</span>
                <span className="font-mono text-sm">{target.host}</span>
              </div>
              {target.redactedUrl && (
                <div className="flex gap-4">
                  <span className="text-term-dim w-32">url:</span>
                  <span className="font-mono text-sm">{target.redactedUrl}</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-term-rule pt-4">
            <h3 className="text-term-dim mb-2">Current State</h3>
            <div className="space-y-1 ml-4">
              {countsError !== null ? (
                <div className="flex gap-4">
                  <span className="text-term-yellow">{countsError}</span>
                </div>
              ) : (
                <>
                  <div className="flex gap-4">
                    <span className="text-term-dim w-32">personas:</span>
                    <span>
                      {personaCount ?? 0} of {maxPersonas}
                    </span>
                  </div>
                  {personaEmails && personaEmails.length > 0 && (
                    <div className="flex gap-4">
                      <span className="text-term-dim w-32">emails:</span>
                      <div className="flex-1 font-mono text-sm space-y-0.5">
                        {personaEmails.map((email: string) => (
                          <div key={email}>{email}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {tables && (
                    <div className="flex gap-4">
                      <span className="text-term-dim w-32">table rows:</span>
                      <div className="space-y-0.5">
                        {Object.entries(tables).map(([table, count]) => (
                          <div key={table}>
                            <span className="text-term-dim">{table}:</span> {count}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="border-t border-term-rule pt-4">
            <h3 className="text-term-dim mb-2">Reset Behavior</h3>
            <div className="ml-4 space-y-1">
              <div className="flex gap-4">
                <span className="text-term-dim w-32">migrations:</span>
                <span>{appliesMigrationsOnReset ? 'applied on every reset' : 'not applied'}</span>
              </div>
              <div className="mt-2 p-3 bg-term-bg border border-term-rule">
                <p className="text-term-dim text-sm">
                  <span className="text-term-yellow">Note:</span> Seeding enqueues enrichment and HyDE
                  indexing jobs through Redis. A fully indexed fixture also requires the API workers
                  and provider credentials to be running; this page reports what was enqueued, not what
                  has been indexed.
                </p>
              </div>
              <div className="mt-2 p-3 bg-term-bg border border-term-rule">
                <p className="text-term-dim text-sm">
                  <span className="text-term-yellow">Guard caveat:</span> This page reports that the
                  target is allowed based on DATABASE_URL. The reset operation performs an additional
                  check that .env.test and DATABASE_URL agree (the migrate step reads .env.test
                  directly). A divergence will refuse the reset with a 409.
                </p>
              </div>
            </div>
          </div>

          {!state.armed ? (
            <div className="border-t border-term-rule pt-4">
              <button
                onClick={() => setState((prev) => ({ ...prev, armed: true }))}
                className="px-4 py-2 bg-term-panel border border-term-rule text-term-red hover:bg-term-bg"
              >
                Reset
              </button>
            </div>
          ) : (
            <div className="border-t border-term-rule pt-4 space-y-3">
              <div className="p-3 bg-term-bg border border-term-rule">
                <p className="text-term-red font-bold mb-2">⚠ Destructive Operation</p>
                <p className="text-term-dim text-sm">
                  This will flush all data from {target.databaseName}, apply migrations, and reseed
                  with test personas. This operation cannot be undone.
                </p>
              </div>

              <div>
                <label htmlFor="persona-count" className="block text-term-dim mb-1">
                  Personas to seed (0–{maxPersonas}):
                </label>
                <input
                  id="persona-count"
                  type="number"
                  min="0"
                  max={maxPersonas}
                  value={state.personas}
                  onChange={(e) => {
                    const value = parseInt(e.target.value, 10);
                    if (!isNaN(value) && value >= 0 && value <= maxPersonas) {
                      setState((prev) => ({ ...prev, personas: value }));
                    }
                  }}
                  className="px-2 py-1 bg-term-bg border border-term-rule font-mono w-24"
                />
              </div>

              <div>
                <label htmlFor="confirm-input" className="block text-term-dim mb-1">
                  Type the database name to confirm:
                </label>
                <input
                  id="confirm-input"
                  type="text"
                  value={state.confirmInput}
                  onChange={(e) => setState((prev) => ({ ...prev, confirmInput: e.target.value }))}
                  className="px-2 py-1 bg-term-bg border border-term-rule font-mono"
                  placeholder={target.databaseName}
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  disabled={!confirmMatches || state.resetting}
                  className="px-4 py-2 bg-term-panel border border-term-rule text-term-red hover:bg-term-bg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {state.resetting ? 'Launching reset...' : 'Confirm reset'}
                </button>
                <button
                  onClick={() =>
                    setState((prev) => ({ ...prev, armed: false, confirmInput: '', error: null }))
                  }
                  disabled={state.resetting}
                  className="px-4 py-2 bg-term-panel border border-term-rule hover:bg-term-bg disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </Frame>
    </div>
  );
}
