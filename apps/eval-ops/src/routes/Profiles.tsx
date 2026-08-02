import { useEffect, useState } from 'react';
import { Link } from 'react-router';

import { Frame } from '../components/Frame';
import { StatusChip } from '../components/StatusChip';
import { cleanOverrides, OverridesEditor, type Overrides } from '../components/OverridesEditor';
import { PROFILE_ENV_ALLOWLIST } from '../../../../packages/protocol/eval/ops/ops.allowlist';
import { api, type ConfigProfile, type RunRecord } from '../api/client';

interface ProfilesState {
  /** Shipped repo profiles: committed, code-reviewed, read-only here. */
  repo: ConfigProfile[];
  /** Saved configs: created in the browser, stored in the eval-ops database. */
  saved: ConfigProfile[];
  runs: RunRecord[];
  /**
   * Union of every harness's overridable agents. A saved config is
   * harness-agnostic — it can be selected for any harness — so the edit
   * editor offers every agent any harness exercises, not one harness's set.
   */
  agents: string[];
  /** The curated model list for the edit editor's dropdowns. */
  models: string[];
  loaded: boolean;
  /** Name of the config currently being edited, or null. */
  editing: string | null;
  editDescription: string;
  editOverrides: Overrides;
  editError: string | null;
  /** Name of the config awaiting delete confirmation, or null. */
  confirmingDelete: string | null;
  deleteError: string | null;
  error: string | null;
}

export function Profiles() {
  const [state, setState] = useState<ProfilesState>({
    repo: [],
    saved: [],
    runs: [],
    agents: [],
    models: [],
    loaded: false,
    editing: null,
    editDescription: '',
    editOverrides: { models: {}, env: {} },
    editError: null,
    confirmingDelete: null,
    deleteError: null,
    error: null,
  });

  useEffect(() => {
    let mounted = true;

    Promise.all([api.configs(), api.runs()])
      .then(([configs, runs]) => {
        if (!mounted) return;
        // Tests stub fetch naïvely: never trust the payload's shape, and never
        // compute derived values inside a setState updater.
        const repo = configs.repo ?? [];
        const saved = configs.saved ?? [];
        const runList = runs.runs ?? [];
        setState((prev) => ({ ...prev, repo, saved, runs: runList, loaded: true, error: null }));
      })
      .catch((error) => {
        if (!mounted) return;
        setState((prev) => ({
          ...prev,
          loaded: true,
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    // Agents and curated models only enhance the edit form; a failure here must
    // not take the page down, so both settle independently.
    api
      .harnesses()
      .then((result) => {
        if (!mounted) return;
        const agents = [
          ...new Set((result.harnesses ?? []).flatMap((h) => h.agents ?? [])),
        ].sort();
        setState((prev) => ({ ...prev, agents }));
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

  const runsFor = (name: string): RunRecord[] =>
    state.runs.filter((r) => r.spec.kind === 'eval' && r.spec.profile === name);

  const startEdit = (config: ConfigProfile) => {
    setState((prev) => ({
      ...prev,
      editing: config.name,
      editDescription: config.description,
      editOverrides: { models: { ...config.models }, env: { ...config.env } },
      editError: null,
      confirmingDelete: null,
      deleteError: null,
    }));
  };

  const handleSaveEdit = (name: string) => {
    const description = state.editDescription.trim();
    if (description === '') return;
    const cleaned = cleanOverrides(state.editOverrides);
    api
      .updateConfig(name, { description, models: cleaned.models, env: cleaned.env })
      .then((updated) => {
        setState((prev) => ({
          ...prev,
          saved: prev.saved.map((config) => (config.name === name ? updated : config)),
          editing: null,
          editError: null,
        }));
      })
      .catch((error) => {
        setState((prev) => ({
          ...prev,
          editError: error instanceof Error ? error.message : String(error),
        }));
      });
  };

  const handleDelete = (name: string) => {
    api
      .deleteConfig(name)
      .then(() => {
        setState((prev) => ({
          ...prev,
          saved: prev.saved.filter((config) => config.name !== name),
          confirmingDelete: null,
          deleteError: null,
        }));
      })
      .catch((error) => {
        setState((prev) => ({
          ...prev,
          deleteError: error instanceof Error ? error.message : String(error),
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

  if (!state.loaded) {
    return (
      <div className="p-4">
        <Frame label="configs">
          <p className="text-term-dim">Loading...</p>
        </Frame>
      </div>
    );
  }

  // When the harness list has not arrived, the edit editor still shows the
  // agents the config already overrides rather than hiding them.
  const editAgents =
    state.agents.length > 0 ? state.agents : Object.keys(state.editOverrides.models);

  return (
    <div className="p-4 space-y-4">
      <Frame label="configs">
        <div className="mb-4">
          <p className="text-term-dim mb-2">
            A configuration is a set of model and environment overrides a run launches under.
          </p>
          <p className="text-term-dim">
            <span className="text-term-fg">Saved configs</span> are created and edited here and
            stored in the eval-ops database. <span className="text-term-fg">Shipped profiles</span>{' '}
            are committed in{' '}
            <code className="text-term-cyan">packages/protocol/eval/ops/profiles/</code> — edited in
            the repository, not the browser, so the baseline configuration stays code-reviewed.
          </p>
        </div>

        <h2 className="text-term-cyan mb-3">saved configs</h2>
        {state.saved.length === 0 ? (
          <p className="text-term-dim mb-6">
            None yet — set overrides on the{' '}
            <Link to="/launch" className="text-term-cyan hover:underline">
              launch page
            </Link>{' '}
            and choose “save as config…”.
          </p>
        ) : (
          <div className="space-y-6 mb-6">
            {state.saved.map((config) => (
              <section
                key={config.name}
                aria-label={`config ${config.name}`}
                className="border-t border-term-rule pt-4 first:border-0 first:pt-0"
              >
                <div className="flex items-baseline gap-3 mb-2">
                  <h3 className="text-term-cyan text-lg">{config.name}</h3>
                  <Link
                    to={`/launch?profile=${config.name}`}
                    className="text-term-cyan hover:underline text-sm"
                  >
                    launch →
                  </Link>
                  {state.editing !== config.name && state.confirmingDelete !== config.name && (
                    <>
                      <button
                        type="button"
                        className="text-term-dim hover:underline text-sm"
                        onClick={() => startEdit(config)}
                      >
                        edit
                      </button>
                      <button
                        type="button"
                        className="text-term-red hover:underline text-sm"
                        onClick={() =>
                          setState((prev) => ({
                            ...prev,
                            confirmingDelete: config.name,
                            deleteError: null,
                            editing: null,
                          }))
                        }
                      >
                        delete
                      </button>
                    </>
                  )}
                </div>

                {state.confirmingDelete === config.name && (
                  <div className="mb-3">
                    <p className="text-term-yellow mb-2">delete {config.name}?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-[2ch] py-[0.5lh] bg-term-red text-term-bg font-bold"
                        onClick={() => handleDelete(config.name)}
                      >
                        yes
                      </button>
                      <button
                        type="button"
                        className="px-[2ch] py-[0.5lh] border border-term-rule"
                        onClick={() =>
                          setState((prev) => ({ ...prev, confirmingDelete: null, deleteError: null }))
                        }
                      >
                        no
                      </button>
                    </div>
                    {state.deleteError !== null && (
                      <p role="alert" className="mt-2 text-term-red">
                        {state.deleteError}
                      </p>
                    )}
                  </div>
                )}

                {state.editing === config.name ? (
                  <div className="space-y-3 border border-term-rule p-2 mb-3">
                    <div>
                      <label htmlFor="edit-description" className="block mb-1 text-term-dim">
                        description
                      </label>
                      <input
                        id="edit-description"
                        type="text"
                        className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
                        value={state.editDescription}
                        onChange={(e) =>
                          setState((prev) => ({ ...prev, editDescription: e.target.value }))
                        }
                      />
                    </div>
                    <OverridesEditor
                      agents={editAgents}
                      models={state.models}
                      envKeys={PROFILE_ENV_ALLOWLIST}
                      value={state.editOverrides}
                      onChange={(next) => setState((prev) => ({ ...prev, editOverrides: next }))}
                    />
                    {state.editError !== null && (
                      <p role="alert" className="text-term-red">
                        {state.editError}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-[2ch] py-[0.5lh] bg-term-cyan text-term-bg font-bold disabled:opacity-50"
                        disabled={state.editDescription.trim() === ''}
                        onClick={() => handleSaveEdit(config.name)}
                      >
                        save changes
                      </button>
                      <button
                        type="button"
                        className="px-[2ch] py-[0.5lh] border border-term-rule"
                        onClick={() =>
                          setState((prev) => ({ ...prev, editing: null, editError: null }))
                        }
                      >
                        cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <ConfigDetail config={config} runs={runsFor(config.name)} />
                )}
              </section>
            ))}
          </div>
        )}

        <h2 className="text-term-cyan mb-3">shipped profiles</h2>
        <div className="space-y-6">
          {state.repo.map((profile) => (
            <section
              key={profile.name}
              aria-label={`config ${profile.name}`}
              className="border-t border-term-rule pt-4 first:border-0 first:pt-0 text-term-dim"
            >
              <div className="flex items-baseline gap-3 mb-2">
                <h3 className="text-term-cyan text-lg">{profile.name}</h3>
                <span className="text-term-dim text-sm">shipped</span>
                <Link
                  to={`/launch?profile=${profile.name}`}
                  className="text-term-cyan hover:underline text-sm"
                >
                  launch →
                </Link>
              </div>
              <ConfigDetail config={profile} runs={runsFor(profile.name)} />
            </section>
          ))}
        </div>
      </Frame>
    </div>
  );
}

/** The read-only display of one configuration: description, overrides, runs. */
function ConfigDetail({ config, runs }: { config: ConfigProfile; runs: RunRecord[] }) {
  return (
    <>
      <p className="text-term-dim mb-3">{config.description}</p>
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm mb-3">
        <span className="text-term-dim">Model overrides:</span>
        <span>
          {Object.keys(config.models).length === 0 ? (
            <span className="text-term-dim">none</span>
          ) : (
            <ul className="space-y-1">
              {Object.entries(config.models).map(([agent, model]) => (
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
          {Object.keys(config.env).length === 0 ? (
            <span className="text-term-dim">none</span>
          ) : (
            <ul className="space-y-1">
              {Object.entries(config.env).map(([key, value]) => (
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
          {runs.length === 0 ? (
            <span className="text-term-dim">none</span>
          ) : (
            <div className="space-y-1">
              {runs.slice(0, 5).map((run) => (
                <div key={run.id}>
                  <Link to={`/r/${run.id}`} className="text-term-cyan hover:underline">
                    {run.id}
                  </Link>{' '}
                  — <StatusChip status={run.status} /> —{' '}
                  {run.spec.kind === 'eval' && run.spec.harness} —{' '}
                  {new Date(run.createdAt).toLocaleString()}
                </div>
              ))}
              {runs.length > 5 && (
                <p className="text-term-dim text-xs">+{runs.length - 5} more</p>
              )}
            </div>
          )}
        </span>
      </div>
    </>
  );
}
