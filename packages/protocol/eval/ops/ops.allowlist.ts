/**
 * Environment variables a profile or ad-hoc override is permitted to set.
 * Everything here is a protocol feature flag read live from process.env.
 * Credentials, connection strings and NODE_ENV are deliberately absent: an
 * override must never be able to repoint a run at another database or
 * provider account.
 *
 * Lives in its own module (not ops.profiles.ts) so the browser app can import
 * it: ops.profiles.ts pulls in node:fs and node:crypto, which the Vite bundle
 * cannot. This module must stay dependency-free.
 */
export const PROFILE_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  "DISCOVERY_ALLOWED_TYPES",
  "DISCOVERY_PROFILE_SOURCE",
  "DISCOVERY_CONTEXT_TO_INTENT",
  "DISCOVERY_REJECTION_COOLDOWN_DAYS",
  "DISCOVERY_SOURCE_PREMISE_LIMIT",
  "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
  "INTRODUCER_DISCOVERY_ENABLED",
  "NEGOTIATION_INCLUDE_OTHER_INTENTS",
  "NEGOTIATION_MAX_TURNS_CHAT",
  "NEGOTIATION_MAX_TURNS_AMBIENT",
  "NEGOTIATION_EVIDENCE_QUESTIONS_MODE",
  "OUTCOME_QUESTIONS_MODE",
  "POOL_QUESTIONS_MINING",
  "POOL_QUESTIONS_MODE",
  "POOL_QUESTIONS_PUSH",
  "POOL_QUESTIONS_RANKING",
]);

/**
 * The environment keys a discovery-ab side may set: the nine the discovery
 * graph actually reads.
 *
 * A copy, and deliberately so. The engine's list is `AB_FLAGS`
 * (services/api/src/cli/discovery-ab.flags.ts), which is derived from a scan of
 * the graph's import closure — but that module imports node:fs, and this one is
 * imported by the browser app, so importing it here would break the Vite
 * bundle. The copy is therefore pinned against the engine's source text in
 * eval/ops/tests/argv.spec.ts: a key added, removed or renamed there fails that
 * test rather than drifting.
 *
 * Drift matters more here than for a normal allowlist, because the engine does
 * not reject an unreadable key at the CLI boundary — `parseAbRunArgs` scans for
 * the flags it knows — and `buildAbPlan` only refuses it after the harness has
 * loaded its eval modules. A key this list wrongly offers is an operator
 * configuring a control that either fails late or moves nothing.
 *
 * Every key is also in PROFILE_ENV_ALLOWLIST above, so ENV_FLAG_METADATA can
 * describe all nine to the launch form.
 */
export const DISCOVERY_AB_ENV_KEYS: readonly string[] = Object.freeze([
  "DISCOVERY_ALLOWED_TYPES",
  "DISCOVERY_CONTEXT_TO_INTENT",
  "DISCOVERY_PROFILE_SOURCE",
  "DISCOVERY_REJECTION_COOLDOWN_DAYS",
  "DISCOVERY_SOURCE_PREMISE_LIMIT",
  "NEGOTIATION_INCLUDE_OTHER_INTENTS",
  "NEGOTIATION_MAX_TURNS_AMBIENT",
  "NEGOTIATION_MAX_TURNS_CHAT",
  "RUN_OPPORTUNITY_EVAL_IN_PARALLEL",
]);
