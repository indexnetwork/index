import { useId } from 'react';

export interface Overrides {
  models: Record<string, string>;
  env: Record<string, string>;
}

export const EMPTY_OVERRIDES: Overrides = { models: {}, env: {} };

export function hasOverrides(value: Overrides): boolean {
  return Object.keys(value.models).length > 0 || Object.keys(value.env).length > 0;
}

/**
 * Strips env rows whose value is still blank (a row the user added but never
 * filled in). The record itself is never mutated; submit and save-as-config
 * both go through this so an empty row can never reach the server.
 */
export function cleanOverrides(value: Overrides): Overrides {
  return {
    models: { ...value.models },
    env: Object.fromEntries(
      Object.entries(value.env).filter(([, envValue]) => envValue.trim() !== ''),
    ),
  };
}

interface OverridesEditorProps {
  /** Model-overridable agents the selected harness exercises. */
  agents: readonly string[];
  /** The curated, server-enforced model list. */
  models: readonly string[];
  /** The env keys a profile may set (PROFILE_ENV_ALLOWLIST). */
  envKeys: readonly string[];
  value: Overrides;
  onChange: (next: Overrides) => void;
}

/**
 * Edits one side's ad-hoc overrides: a model dropdown per agent the harness
 * exercises, plus env key/value rows. Pure controlled inputs — the parent owns
 * the value. Mouse-first like the rest of the site: no keyboard handlers.
 */
export function OverridesEditor({ agents, models, envKeys, value, onChange }: OverridesEditorProps) {
  const prefix = useId();

  const setModel = (agent: string, model: string) => {
    const nextModels = { ...value.models };
    if (model === '') {
      delete nextModels[agent];
    } else {
      nextModels[agent] = model;
    }
    onChange({ ...value, models: nextModels });
  };

  const setEnvKey = (oldKey: string, newKey: string) => {
    // Keyed by position: renaming a key keeps the row's value and row order.
    const entries = Object.entries(value.env).map(([key, envValue]) =>
      key === oldKey ? [newKey, envValue] as [string, string] : [key, envValue] as [string, string],
    );
    onChange({ ...value, env: Object.fromEntries(entries) });
  };

  const setEnvValue = (key: string, envValue: string) => {
    onChange({ ...value, env: { ...value.env, [key]: envValue } });
  };

  const removeEnv = (key: string) => {
    const nextEnv = { ...value.env };
    delete nextEnv[key];
    onChange({ ...value, env: nextEnv });
  };

  const addEnv = () => {
    const unused = envKeys.find((key) => !(key in value.env));
    if (unused === undefined) return;
    onChange({ ...value, env: { ...value.env, [unused]: '' } });
  };

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent}>
          <label htmlFor={`${prefix}-model-${agent}`} className="block mb-1 text-term-dim">
            {agent}
          </label>
          <select
            id={`${prefix}-model-${agent}`}
            className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
            value={value.models[agent] ?? ''}
            onChange={(e) => setModel(agent, e.target.value)}
          >
            <option value="">default</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      ))}

      {Object.entries(value.env).map(([key, envValue]) => (
        <div key={key} className="flex items-center gap-2">
          <select
            aria-label={`env key ${key}`}
            className="bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
            value={key}
            onChange={(e) => setEnvKey(key, e.target.value)}
          >
            <option value={key}>{key}</option>
            {envKeys
              .filter((candidate) => candidate !== key && !(candidate in value.env))
              .map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
          </select>
          <input
            type="text"
            aria-label={`env value ${key}`}
            placeholder="value"
            className="flex-1 bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
            value={envValue}
            onChange={(e) => setEnvValue(key, e.target.value)}
          />
          <button
            type="button"
            aria-label={`remove ${key}`}
            className="px-[1ch] py-[0.5lh] border border-term-rule text-term-dim"
            onClick={() => removeEnv(key)}
          >
            ✕
          </button>
        </div>
      ))}

      {envKeys.some((key) => !(key in value.env)) && (
        <button
          type="button"
          className="px-[2ch] py-[0.5lh] border border-term-rule text-term-dim"
          onClick={addEnv}
        >
          add env override
        </button>
      )}
    </div>
  );
}
