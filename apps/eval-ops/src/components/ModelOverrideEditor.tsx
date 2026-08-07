import { useCallback, useId, useMemo } from 'react';

import type { AgentMeta, ModelMeta } from '../api/client';

/**
 * Model a scorecard agent runs on when neither the profile nor an override
 * says otherwise (src/shared/agent/model.config.ts — every scorecard agent
 * defaults to it, per MODEL_METADATA's blurb).
 */
export const FALLBACK_DEFAULT_MODEL_ID = 'google/gemini-2.5-flash';

interface ModelOverrideEditorProps {
  /** Agents to offer, with plain-English labels and roles. */
  agents: readonly AgentMeta[];
  /** The curated, server-enforced model list. */
  models: readonly ModelMeta[];
  /** Agent id → model id the currently selected profile assigns (may omit agents). */
  profileDefaults: Record<string, string>;
  /** Agent id → overridden model id; an absent agent runs the profile default. */
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

/**
 * One dropdown per agent: the default choice names the model the active
 * profile would use, and every other choice is a curated model with its
 * blurb. Fully controlled — the parent owns the models map.
 */
export function ModelOverrideEditor({
  agents,
  models,
  profileDefaults,
  value,
  onChange,
}: ModelOverrideEditorProps) {
  const prefix = useId();
  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);

  const defaultLabelFor = useCallback(
    (agentId: string): string => {
      const id = profileDefaults[agentId] ?? FALLBACK_DEFAULT_MODEL_ID;
      return modelById.get(id)?.label ?? id;
    },
    [profileDefaults, modelById],
  );

  const setModel = useCallback(
    (agentId: string, modelId: string) => {
      const next = { ...value };
      if (modelId === '') {
        delete next[agentId];
      } else {
        next[agentId] = modelId;
      }
      onChange(next);
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3">
      {agents.map((agent) => (
        <div key={agent.id}>
          <label htmlFor={`${prefix}-model-${agent.id}`} className="block mb-1">
            {agent.label}
          </label>
          <select
            id={`${prefix}-model-${agent.id}`}
            aria-label={`model for ${agent.label}`}
            className="w-full bg-term-bg border border-term-rule px-[1ch] py-[0.5lh]"
            value={value[agent.id] ?? ''}
            onChange={(e) => setModel(agent.id, e.target.value)}
          >
            <option value="">profile default ({defaultLabelFor(agent.id)})</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label} — {model.blurb}
              </option>
            ))}
          </select>
          <p className="mt-1 text-term-dim">{agent.role}</p>
        </div>
      ))}
    </div>
  );
}
