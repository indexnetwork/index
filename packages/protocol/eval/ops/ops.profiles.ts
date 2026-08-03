import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { HARNESS_REGISTRY } from "./ops.registry.js";

export const DEFAULT_PROFILE_NAME = "default";

// The allowlist lives in ops.allowlist.ts (dependency-free) so the browser app
// can import it without dragging node:fs/crypto into the Vite bundle. Re-exported
// here so existing server-side imports keep working.
export { PROFILE_ENV_ALLOWLIST } from "./ops.allowlist.js";
import { PROFILE_ENV_ALLOWLIST } from "./ops.allowlist.js";

// Guided-editing metadata is likewise dependency-free (ops.metadata.ts) so the
// browser app imports it directly; re-exported here for server-side consumers.
export { ENV_FLAG_METADATA, HARNESS_AGENT_METADATA, MODEL_METADATA } from "./ops.metadata.js";
export type { AgentMeta, EnvFlagMeta, ModelMeta } from "./ops.metadata.js";
import { ENV_FLAG_METADATA } from "./ops.metadata.js";

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

/**
 * The only models a client may select. Live spend on a shared URL with no
 * actor attribution yet: free-text slugs stay out until attribution exists.
 * Repo profiles are code-reviewed and exempt.
 */
export const ALLOWED_CONFIG_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1-mini",
] as const;

/** Agent keys any scorecard harness can actually exercise (from the registry). */
function overridableAgents(): ReadonlySet<string> {
  return new Set(Object.values(HARNESS_REGISTRY).flatMap((d) => d.agents));
}

/**
 * Validates env override values against the flag schemas in ENV_FLAG_METADATA.
 * Returns human-readable issues; empty means valid. Allowlist membership is
 * checked separately by validateConfigOverrides — unknown keys are skipped
 * here so each problem is reported exactly once.
 */
export function validateProfileEnv(env: Record<string, string>): string[] {
  const issues: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    const meta = ENV_FLAG_METADATA.find((flag) => flag.key === key);
    if (meta === undefined) continue;
    switch (meta.kind) {
      case "enum":
      case "boolean":
        if (!meta.values?.includes(value)) {
          const expected = meta.values?.join(", ") ?? "(no values defined)";
          issues.push(`env ${key} value "${value}" is not valid. Expected one of: ${expected}`);
        }
        break;
      case "integer":
        // Non-negative digits only, mirroring optionalInt in services/api/src/startup.env.ts.
        if (!/^\d+$/.test(value)) {
          issues.push(`env ${key} value "${value}" is not a valid integer`);
        }
        break;
      case "number":
        if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
          issues.push(`env ${key} value "${value}" must be a positive number`);
        }
        break;
      case "string":
        break;
    }
  }
  return issues;
}

/**
 * Validates client-originated overrides. Returns human-readable issues;
 * empty means valid. Used by the config routes and the launch path — never
 * by the repo profile loader, whose files are code-reviewed.
 */
export function validateConfigOverrides(overrides: {
  models: Record<string, string>;
  env: Record<string, string>;
}): string[] {
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
    if (!PROFILE_ENV_ALLOWLIST.includes(key)) {
      issues.push(`env key ${key} is not in PROFILE_ENV_ALLOWLIST`);
    }
  }
  issues.push(...validateProfileEnv(overrides.env));
  return issues;
}

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
