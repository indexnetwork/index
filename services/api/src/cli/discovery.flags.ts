/**
 * GENERATED LIST — regenerate with:
 *   cd packages/protocol && bun ./eval/ops/ops.envcatalog.build.ts
 *
 * The environment flags this harness may offer: those the discovery graph
 * actually reads, derived by walking the graph's own transitive import closure
 * and collecting `process.env` reads.
 *
 * DISCOVERY_ENV_KEYS below is a verbatim copy of `HARNESS_ENV_KEYS.discovery`
 * in packages/protocol/eval/ops/ops.envcatalog.ts. It is copied rather than
 * imported because services/api sets `rootDir: ./src`, so importing a protocol
 * source file from production code is TS6059, and @indexnetwork/protocol
 * exports only its built `dist` entry point. A spec file may reach across, and
 * discovery.flags.spec.ts asserts this copy equals the catalogue exactly — so
 * the duplication cannot drift silently, which is the only thing that made a
 * hand-kept list dangerous.
 *
 * The previous version of this file pinned nine keys by hand. The graph reads
 * twenty-eight offerable ones. The nine were the result of scanning against a
 * sixteen-key hand-written allowlist: the list was the limit, not the code, so
 * `NEGOTIATOR_STANCE` and eighteen others were refused by a message asserting
 * the graph could not read them — which was false. The list is now derived and
 * the code answers.
 *
 * Credentials are absent by construction: the generator drops any key
 * `isCredentialEnvKey` matches, so no configuration reaching this harness can
 * repoint it at another provider account or endpoint.
 */

export const DISCOVERY_ENV_KEYS: readonly string[] = Object.freeze([
  'CHAT_MODEL',
  'CHAT_REASONING_EFFORT',
  'DISCOVERY_ALLOWED_TYPES',
  'DISCOVERY_CONTEXT_TO_INTENT',
  'DISCOVERY_EVALUATOR_MIN_SCORE',
  'DISCOVERY_MIN_SIMILARITY',
  'DISCOVERY_PROFILE_SOURCE',
  'DISCOVERY_REJECTION_COOLDOWN_DAYS',
  'DISCOVERY_SOURCE_PREMISE_LIMIT',
  'EVAL_MODEL_OVERRIDES',
  'HYDE_FRAME_CONSTRAINTS_ENABLED',
  'NEGOTIATION_ASK_USER_ENABLED',
  'NEGOTIATION_ASK_USER_WINDOW_MS',
  'NEGOTIATION_CONSULTATION_POLICY_MODE',
  'NEGOTIATION_DEADLOCK_SHIFT_ENABLED',
  'NEGOTIATION_DEADLOCK_THRESHOLD',
  'NEGOTIATION_INCLUDE_OTHER_INTENTS',
  'NEGOTIATION_MAX_TURNS_AMBIENT',
  'NEGOTIATION_MAX_TURNS_CHAT',
  'NEGOTIATION_PROTOCOL_VERSION',
  'NEGOTIATION_SCREEN_MODE',
  'NEGOTIATOR_STANCE',
  'NEGOTIATOR_TURN_TIMEOUT_MS',
  'OPENROUTER_FALLBACK_MODEL',
  'OPENROUTER_MAX_RETRIES',
  'OPENROUTER_REQUEST_TIMEOUT_MS',
  'OPENROUTER_RUNNABLE_MAX_ATTEMPTS',
  'RUN_OPPORTUNITY_EVAL_IN_PARALLEL',
]);

export type AbEnvConfig = Readonly<Record<string, string>>;

/**
 * Credentials, refused separately from unreadable keys because the reason
 * differs and the operator acts on it differently.
 *
 * The discovery graph genuinely reads OPENROUTER_API_KEY and
 * OPENROUTER_BASE_URL — they are absent from the catalogue because they are
 * credentials, not because they are inert. Telling an operator the graph cannot
 * read them would be false, and would send someone hunting for a code path that
 * is right there.
 */
const CREDENTIAL_KEYS: readonly string[] = Object.freeze([
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
]);

/**
 * What each offered flag's own read site accepts, mirrored from
 * ENV_FLAG_METADATA in packages/protocol/eval/ops/ops.metadata.ts.
 *
 * Needed because an unrecognised value does not fail at the read site — it
 * falls back. `DISCOVERY_PROFILE_SOURCE=user-context` (hyphen) warns once and
 * runs `premise`, so without this check a run would measure the default while
 * its artifact recorded the value the operator typed.
 */
interface EnvValueRule {
  kind: 'enum' | 'boolean' | 'csv-enum' | 'integer' | 'number' | 'decimal-range' | 'string' | 'json-model-map';
  values?: readonly string[];
  min?: number;
  max?: number;
}

/**
 * Exported for discovery.flags.spec.ts, which cross-checks every field of every
 * shared key against ENV_FLAG_METADATA. A sampled cross-check missed an entire
 * missing field (`max`) once; an exhaustive one needs to see the rules.
 */
export const ENV_VALUE_RULES: Readonly<Record<string, EnvValueRule>> = Object.freeze({
  CHAT_MODEL: { kind: 'enum', values: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4.5', 'openai/gpt-4.1-mini'] },
  CHAT_REASONING_EFFORT: { kind: 'enum', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
  DISCOVERY_ALLOWED_TYPES: { kind: 'csv-enum', values: ['intent', 'profile'] },
  DISCOVERY_CONTEXT_TO_INTENT: { kind: 'enum', values: ['0', '1'] },
  DISCOVERY_EVALUATOR_MIN_SCORE: { kind: 'decimal-range', min: 0, max: 100 },
  DISCOVERY_MIN_SIMILARITY: { kind: 'decimal-range', min: 0, max: 1 },
  DISCOVERY_PROFILE_SOURCE: { kind: 'enum', values: ['premise', 'user_context'] },
  DISCOVERY_REJECTION_COOLDOWN_DAYS: { kind: 'number' },
  DISCOVERY_SOURCE_PREMISE_LIMIT: { kind: 'integer' },
  EVAL_MODEL_OVERRIDES: { kind: 'json-model-map' },
  HYDE_FRAME_CONSTRAINTS_ENABLED: { kind: 'boolean', values: ['true', 'false'] },
  NEGOTIATION_ASK_USER_ENABLED: { kind: 'boolean', values: ['true', 'false'] },
  NEGOTIATION_ASK_USER_WINDOW_MS: { kind: 'integer', min: 1 },
  NEGOTIATION_CONSULTATION_POLICY_MODE: { kind: 'enum', values: ['off', 'shadow', 'on'] },
  NEGOTIATION_DEADLOCK_SHIFT_ENABLED: { kind: 'boolean', values: ['true', 'false'] },
  NEGOTIATION_DEADLOCK_THRESHOLD: { kind: 'integer', min: 2 },
  NEGOTIATION_INCLUDE_OTHER_INTENTS: { kind: 'enum', values: ['true', 'false'] },
  NEGOTIATION_MAX_TURNS_AMBIENT: { kind: 'integer', min: 1 },
  NEGOTIATION_MAX_TURNS_CHAT: { kind: 'integer', min: 1 },
  NEGOTIATION_PROTOCOL_VERSION: { kind: 'enum', values: ['v1', 'v2'] },
  NEGOTIATION_SCREEN_MODE: { kind: 'enum', values: ['off', 'shadow', 'enforce'] },
  NEGOTIATOR_STANCE: { kind: 'enum', values: ['advocate', 'evaluator', 'skeptic'] },
  NEGOTIATOR_TURN_TIMEOUT_MS: { kind: 'integer', min: 1, max: 9007199254740991 },
  OPENROUTER_FALLBACK_MODEL: { kind: 'enum', values: ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'google/gemini-3-pro-preview', 'anthropic/claude-sonnet-4', 'anthropic/claude-haiku-4.5', 'openai/gpt-4.1-mini', 'none', 'off'] },
  OPENROUTER_MAX_RETRIES: { kind: 'integer', min: 0 },
  OPENROUTER_REQUEST_TIMEOUT_MS: { kind: 'integer', min: 1 },
  OPENROUTER_RUNNABLE_MAX_ATTEMPTS: { kind: 'integer', min: 1 },
  RUN_OPPORTUNITY_EVAL_IN_PARALLEL: { kind: 'boolean', values: ['true', 'false'] },
});

/** The problem with `value` for this flag, or null when the graph will honour it. */
export function discoveryEnvValueIssue(key: string, value: string): string | null {
  const rule = ENV_VALUE_RULES[key];
  if (rule === undefined) return null;
  switch (rule.kind) {
    case 'enum':
    case 'boolean':
      return rule.values?.includes(value) === true
        ? null
        : `must be one of: ${rule.values?.join(', ') ?? '(no values defined)'}`;
    case 'csv-enum': {
      const allowed = rule.values ?? [];
      const tokens = value.split(',').map((token) => token.trim().toLowerCase()).filter((token) => token !== '');
      const legal = tokens.length > 0 && tokens.every((token) => allowed.includes(token));
      return legal ? null : `must be a comma-separated list of: ${allowed.join(', ') || '(no values defined)'}`;
    }
    case 'integer':
      if (!/^\d+$/.test(value)) return 'must be an integer';
      if (rule.min !== undefined && Number(value) < rule.min) return `must be an integer of at least ${rule.min}`;
      if (rule.max !== undefined && Number(value) > rule.max) return `must be an integer of at most ${rule.max}`;
      return null;
    case 'number': {
      // Mirrors ops.metadata.ts: the read sites parse with Number.parseFloat,
      // which returns NaN for '0x10' where Number() returns 16, and which
      // discards a trailing tail ('7abc' -> 7). Validating with Number() let
      // '0x10' through as sixteen days while the graph fell back to its 7-day
      // default, so the artifact named a difference that never ran.
      const trimmed = value.trim();
      if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return 'must be a positive number in decimal notation';
      const parsed = Number.parseFloat(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) return 'must be a positive number';
      if (rule.min !== undefined && parsed < rule.min) return `must be at least ${rule.min}`;
      if (rule.max !== undefined && parsed > rule.max) return `must be at most ${rule.max}`;
      return null;
    }
    case 'decimal-range': {
      const trimmed = value.trim();
      if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed)) return 'must be a non-negative decimal without exponent notation';
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return 'must be a finite decimal';
      if (rule.min !== undefined && parsed < rule.min) return `must be at least ${rule.min}`;
      if (rule.max !== undefined && parsed > rule.max) return `must be at most ${rule.max}`;
      return null;
    }
    case 'json-model-map':
      // Deliberately not validated here. The site's rule for this flag is not
      // 'parseable JSON' but 'names a reviewed model and a known agent', and the
      // reviewed-model list lives in the ops registry, which this package cannot
      // import (services/api sets rootDir ./src). Duplicating that list here is
      // the drift this whole module exists to prevent, and a stale copy would
      // refuse a model the site had just approved. A malformed value still fails
      // at the read site rather than being silently ignored — readModelOverrides
      // throws — so the failure is loud either way.
      return null;
    case 'string':
      return null;
  }
}

/**
 * Throws when a config names a flag this harness cannot honestly exercise, or
 * gives one a value the graph will not honour.
 *
 * The refusal is kept — a key the graph never reads is a control that moves
 * nothing, and accepting it would let a run attribute noise to a flag that was
 * never consulted. Only the list it checks against has changed.
 */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (CREDENTIAL_KEYS.includes(key)) {
      throw new Error(
        `${key} is a credential and is never configurable from a run; the discovery graph does read it, `
        + 'but letting a run set it would repoint the run at another provider account or endpoint',
      );
    }
    if (!DISCOVERY_ENV_KEYS.includes(key)) {
      throw new Error(`${key} is not readable by the discovery graph; this harness cannot test it`);
    }
    if (value.trim() === '') {
      throw new Error(`${key} has an empty value; unset it instead of blanking it`);
    }
    const issue = discoveryEnvValueIssue(key, value);
    if (issue !== null) {
      throw new Error(
        `${key}=${value} ${issue}. The graph does not refuse a value it does not recognise, it falls back `
        + 'to its default, so this run would measure the default and record the value you typed',
      );
    }
  }
}
