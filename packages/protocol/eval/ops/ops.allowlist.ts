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
/**
 * Credentials, never offerable and never settable from a request. One repoints
 * a run at another provider account and the other at another endpoint, so
 * either turns an environment override into a way to bill someone else or to
 * exfiltrate a corpus.
 *
 * Both are reachable from every harness — that is why excluding them cannot be
 * left to the scan. They are dropped at catalogue generation
 * (ops.envcatalog.build.ts, which re-exports this list) *and* refused at the
 * request boundary in validateConfigOverrides, because a bug in one guard
 * should not be enough to publish a credential field into a browser form.
 *
 * Lives here, with the other dependency-free lists, because both guards need
 * it and one of them sits in a module the browser bundle imports.
 */
export const ENV_SECRET_KEYS: readonly string[] = Object.freeze([
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
]);

/**
 * Names that make a key a credential regardless of whether anyone listed it.
 *
 * `ENV_SECRET_KEYS` above is an exact-match list of two, and that was the whole
 * guard until a review ran the real generator against a fake protocol root whose
 * entry points read `OPENROUTER_API_KEY_2`, `ANTHROPIC_API_KEY`, `DATABASE_URL`
 * and `NEON_API_KEY`. All four appeared in all five harness catalogues, and the
 * catalogue is now the request boundary — `validateConfigOverrides` asks it
 * whether a browser may set a key. Nothing leaks today, because none of the four
 * is in a real harness closure, but `DATABASE_URL` and `NEON_API_KEY` are read
 * one import away from the discovery harness runner
 * (services/api/src/cli/discovery-env-matrix.neon.ts). A two-name denylist that
 * has to be updated *before* the code that reads a new credential is written is
 * a guard that fails open by construction.
 *
 * So the rule inverts: a key is a credential unless its name shows it is not.
 * A new secret named the way secrets are named is refused the moment it appears,
 * by a rule nobody has to remember to update.
 *
 * `_URL` is in the list because an endpoint origin is the same risk class as a
 * key: `OPENROUTER_BASE_URL` repoints a run at another provider, `DATABASE_URL`
 * at another corpus. Exfiltration does not require a password.
 *
 * Bare `KEY` is matched exactly, not as a suffix, because `KEY` alone is a key
 * and `_KEY$` would miss it. It reaches the candidate universe today only
 * because the superset scan reads comments — `ops.envscan.ts` documents
 * `process.env.KEY` as the form it recognises — but a rule that depends on a
 * name never becoming real is not a rule.
 *
 * The credential words match as whole underscore-separated *segments* anywhere
 * in the name, not only at the end. Anchoring to the end was tried first and
 * the tests caught it: `OPENROUTER_API_KEY_2` — the review's own example of a
 * second provider account — ends in `_2` and slipped straight through. A
 * numbered or suffixed credential is still a credential, and `..._KEY_BACKUP`
 * or `..._TOKEN_OLD` are exactly the names a second one acquires.
 *
 * Verified against the 64-key candidate universe: this matches nine
 * (API_URL, DATABASE_URL, EVAL_OPS_UI_URL, KEY, NEON_API_KEY,
 * OPENROUTER_API_KEY, OPENROUTER_BASE_URL, SOME_KEY, TEST_EVAL_SECRET,
 * WEB_APP_URL) and *zero* of the 27 keys any harness offers, which is why
 * CREDENTIAL_SHAPE_EXCEPTIONS below is empty. `CHAT_MODEL`,
 * `EVAL_MODEL_OVERRIDES` and `SMARTEST_VERIFIER_MODEL` name models, not
 * endpoints, and are deliberately untouched by every pattern here.
 */
const CREDENTIAL_NAME_PATTERN = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|URL|URI|DSN|AUTH)(?:_|$)/;

/**
 * Keys whose names match {@link CREDENTIAL_NAME_PATTERN} but which are provably
 * not credentials, and may therefore be offered.
 *
 * Empty, and that is a measured fact rather than an oversight: no key in any
 * harness catalogue matches the pattern (envcatalog.spec.ts asserts it). An
 * entry here needs a comment saying why the name lies — that it names no
 * account, endpoint or corpus — because every entry is a hole in a guard that
 * otherwise needs no maintenance.
 */
const CREDENTIAL_SHAPE_EXCEPTIONS: readonly string[] = Object.freeze([]);

/**
 * Whether `key` must never be settable from a request.
 *
 * True for anything on {@link ENV_SECRET_KEYS} or shaped like a credential and
 * not explicitly excepted. Used by the generator (to keep such keys out of every
 * catalogue) and by `validateConfigOverrides` (to refuse them at the boundary
 * even if a generator bug published one), so the two guards cannot disagree
 * about what a credential is.
 */
export function isCredentialEnvKey(key: string): boolean {
  if (ENV_SECRET_KEYS.includes(key)) return true;
  if (CREDENTIAL_SHAPE_EXCEPTIONS.includes(key)) return false;
  return CREDENTIAL_NAME_PATTERN.test(key);
}

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
 * The environment keys a discovery side may set: the nine the discovery
 * graph actually reads.
 *
 * A copy, and deliberately so — after both directions of a real import were
 * tried and refused by the toolchain:
 *
 * - This module cannot import the engine's `AB_FLAGS`
 *   (services/api/src/cli/discovery.flags.ts): that module imports node:fs to
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
 * services/api/src/cli/tests/discovery.flags.spec.ts — a spec file, which
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
export const DISCOVERY_ENV_KEYS: readonly string[] = Object.freeze([
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
