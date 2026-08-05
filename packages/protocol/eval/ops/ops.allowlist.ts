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
 * A copy, and deliberately so — after both directions of a real import were
 * tried and refused by the toolchain:
 *
 * - This module cannot import the engine's `AB_FLAGS`
 *   (services/api/src/cli/discovery-ab.flags.ts): that module imports node:fs to
 *   derive its list from a scan of the graph's import closure, and this one is
 *   imported by the browser app, so the Vite bundle would break.
 * - The engine cannot import this list either. A relative import from
 *   services/api/src is `TS6059: not under rootDir` (services/api/tsconfig.json
 *   sets `rootDir: ./src`), and `@indexnetwork/protocol/eval/ops/ops.allowlist`
 *   resolves at neither type-check nor runtime, because the package exports
 *   exactly one entry, its built root. Publishing a subpath for eval/ops would
 *   make an eval-only module part of a versioned SDK contract that explicitly
 *   excludes deep imports (STABILITY.md), and would not even work for an
 *   installed consumer, since the published files are dist alone.
 *
 * So the list is a copy with two guards, one from each side, and neither is a
 * source-text substring match on the values themselves: eval/ops/tests/argv.spec.ts
 * parses the engine's `Object.freeze([...])` literal and compares the sets, and
 * services/api/src/cli/tests/discovery-ab.flags.spec.ts — a spec file, which
 * tsconfig excludes and which may therefore import across — compares the two
 * lists as real imported values. A key added, removed or renamed on either side
 * fails both.
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
