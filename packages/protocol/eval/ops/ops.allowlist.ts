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
// The only import this module may take: ops.envcatalog.ts is generated, has no
// runtime dependencies of its own, and is browser-safe for the same reason this
// file is. The scanner that produces it (ops.envscan.ts) uses node:fs and must
// never appear in this chain.
import { HARNESS_ENV_KEYS } from "./ops.envcatalog.js";

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
 * Verified against the 64-key candidate universe: this matches ten
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
 * The environment keys a discovery side may set: exactly what the discovery
 * graph reads, derived rather than listed.
 *
 * This was a hand-written list of nine. The graph reads twenty-six offerable
 * keys, and the nine were what a scan against a sixteen-key allowlist could
 * return — the list was the limit, not the code. Anything outside it was
 * refused with "is not readable by the discovery graph", which for
 * `NEGOTIATOR_STANCE` and eighteen others was false.
 *
 * Now it is one line off the generated catalogue, so there is nothing left to
 * keep in sync on this side of the boundary. Both modules are dependency-free
 * and browser-safe, so this import costs the Vite bundle nothing.
 *
 * The engine keeps its own copy (services/api/src/cli/discovery.flags.ts)
 * because it genuinely cannot import either module: a relative import from
 * services/api/src is `TS6059: not under rootDir`, and
 * `@indexnetwork/protocol/eval/ops/...` resolves at neither type-check nor
 * runtime, since the package exports exactly one entry, its built root.
 * discovery.flags.spec.ts — a spec file, which tsconfig excludes and which may
 * therefore import across — asserts that copy equals this value exactly.
 */
export const DISCOVERY_ENV_KEYS: readonly string[] = HARNESS_ENV_KEYS.discovery;
