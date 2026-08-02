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
