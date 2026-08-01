import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const DEFAULT_PROFILE_NAME = "default";

/**
 * Environment variables a profile is permitted to set. Everything here is a
 * protocol feature flag read live from process.env. Credentials, connection
 * strings and NODE_ENV are deliberately absent: a profile must never be able to
 * repoint a run at another database or provider account.
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

const ConfigProfileSchema = z
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
    for (const key of Object.keys(profile.env)) {
      if (!PROFILE_ENV_ALLOWLIST.includes(key)) {
        throw new Error(`Profile ${profile.name} sets ${key}, which is not in PROFILE_ENV_ALLOWLIST`);
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
