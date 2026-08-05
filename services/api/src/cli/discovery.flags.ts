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
 * twenty-six offerable ones. The nine were the result of scanning against a
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
 * Throws when a config names a flag this harness cannot honestly exercise.
 *
 * The refusal is kept — a key the graph never reads is a control that moves
 * nothing, and accepting it would let a run attribute noise to a flag that was
 * never consulted. Only the list it checks against has changed.
 */
export function assertAbEnvConfig(config: AbEnvConfig): void {
  for (const [key, value] of Object.entries(config)) {
    if (!DISCOVERY_ENV_KEYS.includes(key)) {
      throw new Error(`${key} is not readable by the discovery graph; this harness cannot test it`);
    }
    if (value.trim() === '') {
      throw new Error(`${key} has an empty value; unset it instead of blanking it`);
    }
  }
}
