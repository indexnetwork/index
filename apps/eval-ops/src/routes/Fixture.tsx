import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Frame } from '../components/Frame';
import { api, type FixtureStatus } from '../api/client';

/**
 * Client-side defense-in-depth: removes credentials from any string that might contain them.
 * The server already scrubs credentials, but this ensures they never reach the DOM even if
 * the server's scrubbing somehow fails or is bypassed.
 */
function scrubCredentials(text: string): string {
  return text
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, '$1')
    .replace(/\b(password|pgpassword)=[^\s&"']+/gi, '$1=');
}

interface FixtureState {
  status: FixtureStatus | null;
  loadError: string | null;
  resetError: string | null;
  armed: boolean;
  confirmInput: string;
  personasInput: string;
  resetting: boolean;
}

export function Fixture() {
  const navigate = useNavigate();
  const [state, setState] = useState<FixtureState>({
    status: null,
    loadError: null,
    resetError: null,
    armed: false,
    confirmInput: '',
    personasInput: '',
    resetting: false,
  });

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const status = await api.fixture();
        if (mounted) {
          setState((prev) => ({
            ...prev,
            status,
            loadError: null,
            personasInput: String(status.allowed ? status.maxPersonas : 50),
          }));
        }
      } catch (error) {
        if (mounted) {
          setState((prev) => ({
            ...prev,
            loadError: error instanceof Error ? error.message : String(error),
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
    if (state.confirmInput !== state.status.target.databaseName) return;

    const { maxPersonas } = state.status;
    const personas = parseInt(state.personasInput, 10);
    if (isNaN(personas) || personas < 0 || personas > maxPersonas) {
      setState((prev) => ({
        ...prev,
        resetError: `Personas must be a number between 0 and ${maxPersonas}`,
      }));
      return;
    }

    setState((prev) => ({ ...prev, resetting: true, resetError: null }));
    try {
      const run = await api.reset({
        confirmDatabaseName: state.confirmInput,
        personas,
      });
      // Navigate to the run detail page to show the live log
      navigate(`/r/${run.id}`);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        resetting: false,
        resetError: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  if (state.loadError !== null) {
    return (
      <div className="p-4">
        <Frame label="error">
          <p className="text-term-red">{state.loadError}</p>
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
              Fixture control is unavailable until this server's DATABASE_URL names a dedicated disposable database.
            </p>
          </div>
        </Frame>
      </div>
    );
  }

  const { target, maxPersonas, appliesMigrationsOnReset, seedApiKeysPath, personaCount, personaEmails, tables, countsError } =
    state.status;

  const confirmMatches =
    state.confirmInput.length > 0 && state.confirmInput === target.databaseName;

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
                  <span className="font-mono text-sm">{scrubCredentials(target.redactedUrl)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-term-rule pt-4">
            <h3 className="text-term-dim mb-2">Current State</h3>
            <div className="space-y-1 ml-4">
              {countsError !== null ? (
                <div className="flex gap-4">
                  <span className="text-term-yellow">{scrubCredentials(countsError)}</span>
                </div>
              ) : (
                <>
                  <div className="flex gap-4">
                    <span className="text-term-dim w-32">personas:</span>
                    <span>
                      {personaCount === null ? 'unknown' : personaCount} of {maxPersonas}
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
            <h3 className="text-term-dim mb-2">Seed Output</h3>
            <div className="space-y-1 ml-4">
              <div className="flex gap-4">
                <span className="text-term-dim w-32">API keys file:</span>
                <span className="font-mono text-sm">{seedApiKeysPath}</span>
              </div>
              <div className="mt-2">
                <Frame label="">
                  <p className="text-term-dim text-sm">
                    The seed step (db:seed) writes persona API keys to this file in the repository root.
                  </p>
                </Frame>
              </div>
            </div>
          </div>

          <div className="border-t border-term-rule pt-4">
            <h3 className="text-term-dim mb-2">Reset Behavior</h3>
            <div className="ml-4 space-y-1">
              <div className="flex gap-4">
                <span className="text-term-dim w-32">migrations:</span>
                <span>{appliesMigrationsOnReset ? 'applied on every reset' : 'not applied'}</span>
              </div>
              <div className="mt-2">
                <Frame label="">
                  <p className="text-term-dim text-sm">
                    <span className="text-term-yellow">Note:</span> Seeding enqueues enrichment and HyDE
                    indexing jobs through Redis. A fully indexed fixture also requires the API workers
                    and provider credentials to be running; this page reports what was enqueued, not what
                    has been indexed.
                  </p>
                </Frame>
              </div>
              <div className="mt-2">
                <Frame label="">
                  <p className="text-term-dim text-sm">
                    <span className="text-term-yellow">Guard caveat:</span> This page reports that the
                    target is allowed based on DATABASE_URL. The reset operation performs an additional
                    check that .env.test and DATABASE_URL agree (the migrate step reads .env.test
                    directly). A divergence will refuse the reset with a 409. A reset is also refused while
                    any run is queued or running.
                  </p>
                </Frame>
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
              <Frame label="">
                <p className="text-term-red font-bold mb-2">⚠ Destructive Operation</p>
                <p className="text-term-dim text-sm">
                  This will flush all data from {target.databaseName}, apply migrations, and reseed
                  with test personas. This operation cannot be undone.
                </p>
              </Frame>

              {state.resetError && (
                <Frame label="error">
                  <p className="text-term-red">{state.resetError}</p>
                </Frame>
              )}

              <div>
                <label htmlFor="persona-count" className="block text-term-dim mb-1">
                  Personas to seed (0–{maxPersonas}):
                </label>
                <input
                  id="persona-count"
                  type="text"
                  value={state.personasInput}
                  onChange={(e) => setState((prev) => ({ ...prev, personasInput: e.target.value }))}
                  className="px-2 py-1 bg-term-bg border border-term-rule font-mono w-24"
                  placeholder={String(maxPersonas)}
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
                    setState((prev) => ({ ...prev, armed: false, confirmInput: '', resetError: null }))
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
