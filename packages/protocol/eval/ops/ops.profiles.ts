import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { HARNESS_REGISTRY } from "./ops.registry.js";
import type { OpsHarness } from "./ops.types.js";

export const DEFAULT_PROFILE_NAME = "default";

// The allowlist lives in ops.allowlist.ts (dependency-free) so the browser app
// can import it without dragging node:fs/crypto into the Vite bundle. Re-exported
// here so existing server-side imports keep working.
export { ENV_SECRET_KEYS, isCredentialEnvKey, PROFILE_ENV_ALLOWLIST } from "./ops.allowlist.js";
import { isCredentialEnvKey, PROFILE_ENV_ALLOWLIST } from "./ops.allowlist.js";

// The derived per-harness catalogue: what a harness can actually read, as
// opposed to what the hand-written allowlist happens to name.
import { HARNESS_ENV_KEYS } from "./ops.envcatalog.js";
import { harnessesReading, readableEnv, unreadEnvKeys } from "./ops.envreach.js";

// Guided-editing metadata is likewise dependency-free (ops.metadata.ts) so the
// browser app imports it directly; re-exported here for server-side consumers.
export { ALLOWED_CONFIG_MODEL_IDS, ENV_FLAG_METADATA, FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA, envFlagValueIssue, envValueIssueForKey } from "./ops.metadata.js";
export type { AgentMeta, EnvFlagMeta, FlagMeta, ModelMapBounds, ModelMeta } from "./ops.metadata.js";
import { ALLOWED_CONFIG_MODEL_IDS, envValueIssueForKey, modelMapBounds } from "./ops.metadata.js";

export const ConfigProfileSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "profile names are lowercase kebab-case"),
    description: z.string().min(1),
    models: z.record(z.string().min(1)),
    env: z.record(z.string()),
  })
  .strict();

export type ConfigProfile = z.infer<typeof ConfigProfileSchema>;

export interface ResolvedProfile {
  profile: ConfigProfile;
  /** Stable hash of the overrides only (not the description). */
  fingerprint: string;
  /** True for every profile other than `default`. */
  experimental: boolean;
  /** Environment to inject into the child process. */
  env: Record<string, string>;
}

/** Loads and validates every profile in a directory. Throws on the first invalid file. */
export async function loadProfiles(dir: string): Promise<ConfigProfile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const profiles: ConfigProfile[] = [];
  for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith(".json")).sort((a, b) => a.name.localeCompare(b.name))) {
    const parsed = ConfigProfileSchema.safeParse(await Bun.file(path.join(dir, entry.name)).json());
    if (!parsed.success) {
      throw new Error(`Invalid profile ${entry.name}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    const profile = parsed.data;
    const expectedFile = `${profile.name}.json`;
    if (entry.name !== expectedFile) {
      throw new Error(`Profile file ${entry.name} declares name "${profile.name}" (mismatch); rename it to ${expectedFile}`);
    }
    // Repo profiles are checked against the same boundary as every other
    // configured key, not the narrower PROFILE_ENV_ALLOWLIST.
    //
    // The narrow list was the last surviving instance of "the list is the limit,
    // not the code" — the defect this branch exists to remove. It contains none
    // of CHAT_MODEL, NEGOTIATOR_STANCE, EVAL_MODEL_OVERRIDES or the OpenRouter
    // set, so a committed, code-reviewed profile could not set a key that a
    // config saved from a browser can. The reviewed artefact was the more
    // restricted one, which is backwards.
    //
    // Credentials stay refused here as everywhere else: `isCredentialEnvKey` is
    // the same predicate the request boundary uses, so a committed profile
    // cannot hold a provider key or a connection string either.
    for (const key of Object.keys(profile.env)) {
      if (isCredentialEnvKey(key)) {
        throw new Error(`Profile ${profile.name} sets ${key}, which is a credential and may never be set by a profile`);
      }
      if (!CONFIGURABLE_ENV_KEYS.has(key)) {
        throw new Error(
          `Profile ${profile.name} sets ${key}, which is not offered by any harness `
          + `and is not a configurable protocol flag`,
        );
      }
    }
    if (profile.name === DEFAULT_PROFILE_NAME
      && (Object.keys(profile.models).length > 0 || Object.keys(profile.env).length > 0)) {
      throw new Error(`The default profile must not declare any override`);
    }
    profiles.push(profile);
  }
  return profiles;
}

/** Resolves a profile into the environment to inject plus its experimental status. */
export function resolveProfile(profile: ConfigProfile): ResolvedProfile {
  const env: Record<string, string> = { ...profile.env };
  if (Object.keys(profile.models).length > 0) {
    env.EVAL_MODEL_OVERRIDES = JSON.stringify(sortedRecord(profile.models));
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ models: sortedRecord(profile.models), env: sortedRecord(profile.env) }))
    .digest("hex");
  return { profile, fingerprint, experimental: profile.name !== DEFAULT_PROFILE_NAME, env };
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The only models a client may select.
 *
 * Defined in ops.metadata.ts and re-exported here under its original name. The
 * model-valued env flags (CHAT_MODEL, SMARTEST_VERIFIER_MODEL,
 * OPENROUTER_FALLBACK_MODEL) must state these as their accepted values, and
 * that module is the dependency-free one the browser bundle can import, while
 * this one pulls in node:fs. One list, two names, no drift.
 */
export const ALLOWED_CONFIG_MODELS = ALLOWED_CONFIG_MODEL_IDS;

/** Agent keys any scorecard harness can actually exercise (from the registry). */
function overridableAgents(): ReadonlySet<string> {
  return new Set(Object.values(HARNESS_REGISTRY).flatMap((d) => d.agents));
}

/**
 * Validates env override values against the flag schemas in ENV_FLAG_METADATA.
 * Returns human-readable issues; empty means valid. Allowlist membership is
 * checked separately by validateConfigOverrides — unknown keys are skipped
 * here so each problem is reported exactly once.
 *
 * The per-value rule itself lives in ops.metadata.ts (`envFlagValueIssue`), not
 * here: ops.argv.ts validates the two sides of an A/B run with the same rule
 * and cannot import this module (node:fs, node:crypto — the browser bundle
 * imports ops.argv.ts's neighbours). Two validators would be two answers to
 * "is this value real".
 */
export function validateProfileEnv(env: Record<string, string>): string[] {
  const issues: string[] = [];
  const bounds = modelMapBounds();
  for (const [key, value] of Object.entries(env)) {
    const problem = envValueIssueForKey(key, value, bounds);
    if (problem !== null) issues.push(`env ${key} value "${value}" ${problem}`);
  }
  return issues;
}


/**
 * Validates client-originated overrides. Returns human-readable issues;
 * empty means valid. Used by the config routes and the launch path — never
 * by the repo profile loader, whose files are code-reviewed.
 *
 * `harness` narrows the env boundary from "any harness reads this" to "THIS
 * harness reads this", and passing it is what distinguishes an ad-hoc override
 * from a saved config. See {@link unreadEnvKeys} for why the two differ.
 * Omitting it keeps the union — the Configs page saves a config without
 * choosing a harness to run it under, so it has no harness to check against.
 */
export function validateConfigOverrides(
  overrides: {
    models: Record<string, string>;
    env: Record<string, string>;
  },
  harness?: OpsHarness,
): string[] {
  const issues: string[] = [];
  const agents = overridableAgents();
  for (const [agent, model] of Object.entries(overrides.models)) {
    if (!agents.has(agent)) {
      issues.push(`Unknown agent "${agent}". Overridable agents: ${[...agents].sort().join(", ")}`);
    } else if (!(ALLOWED_CONFIG_MODELS as readonly string[]).includes(model)) {
      issues.push(`Model "${model}" is not selectable. Allowed: ${ALLOWED_CONFIG_MODELS.join(", ")}`);
    }
  }
  for (const key of Object.keys(overrides.env)) {
    // A credential is refused by name, and before the membership check, so the
    // message says why rather than "not offered by any harness". The second of
    // the two independent guards the spec requires: the generator excludes
    // these from every catalogue, and this refuses them at the boundary even if
    // the generator were wrong.
    if (isCredentialEnvKey(key)) {
      issues.push(`env key ${key} is a credential and can never be set from a request`);
      continue;
    }
    if (!CONFIGURABLE_ENV_KEYS.has(key)) {
      // Not "is not read by any harness": CONFIGURABLE_ENV_KEYS is the union of
      // every harness catalogue AND PROFILE_ENV_ALLOWLIST, so the seven flags no
      // harness reads (IND-630) pass this very check. Saying "no harness reads
      // it" would describe a boundary this is not, and would be false of the
      // keys it lets through — spec §6 is precisely that those are accepted and
      // reported rather than refused.
      issues.push(`env key ${key} is not offered by any harness and is not a configurable protocol flag`);
      continue;
    }
    // Named a harness, and this key is not in ITS catalogue. Refused rather than
    // recorded, because an ad-hoc override was typed for THIS run: accepting it
    // would write a value onto the run record and the artifact that the harness
    // provably never reads, which is the inert-flag lie the whole branch exists
    // to remove. A saved config carrying the same key is a different case and is
    // NOT refused — see unreadEnvKeys.
    if (harness !== undefined && !HARNESS_ENV_KEYS[harness].includes(key)) {
      issues.push(
        `env key ${key} is not read by the ${harness} harness, so setting it here would record a value nothing acts on. `
        + `Harnesses that read it: ${harnessesReading(key).join(", ") || "none"}`,
      );
    }
  }
  issues.push(...validateProfileEnv(overrides.env));
  return issues;
}

// Both moved to ops.envreach.ts so the browser app can ask the same two
// questions: this module imports node:crypto and node:fs/promises and can never
// enter the Vite bundle. Re-exported under their original names, so every
// server-side import site is unchanged.
export { harnessesReading, readableEnv, unreadEnvKeys };

/**
 * Every key any harness can read, plus the catalogued flags no harness reaches.
 *
 * A saved config is harness-agnostic (spec §6): it may legitimately carry a key
 * the harness selected today does not read, because it is shared with one that
 * does. So membership here is the union, and "this harness will not read it" is
 * reported at launch as recorded-but-not-read rather than refused here.
 *
 * PROFILE_ENV_ALLOWLIST is still in the union because it describes flags the
 * live services read — the seven no harness reaches (IND-630) can still be
 * recorded on a config without lying about who reads them.
 */
const CONFIGURABLE_ENV_KEYS: ReadonlySet<string> = new Set([
  ...Object.values(HARNESS_ENV_KEYS).flat(),
  ...PROFILE_ENV_ALLOWLIST,
]);

/**
 * Resolves ad-hoc launch overrides through the same path as a named profile,
 * so fingerprints match a saved config with the same payload. The synthetic
 * profile is named "default" (renderRun asserts the resolved name matches the
 * requested one) but is always experimental: ad-hoc runs never save.
 */
export function resolveAdHoc(overrides: {
  models: Record<string, string>;
  env: Record<string, string>;
}): ResolvedProfile {
  const resolved = resolveProfile({ name: DEFAULT_PROFILE_NAME, description: "ad-hoc overrides", ...overrides });
  return { ...resolved, experimental: true };
}
