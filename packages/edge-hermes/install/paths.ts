import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Hermes data root (`HERMES_HOME` or `~/.hermes`). */
export function hermesHome(): string {
  return process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
}

/** Edge project context + memory — flat under `$HERMES_HOME` (Hermes default layout). */
export function targetWorkspace(): string {
  return hermesHome();
}

export function skillsDir(): string {
  return join(hermesHome(), "skills");
}

/** Skill bundles shipped by this repo (installed into `$HERMES_HOME/skills/<name>/`). */
export const EDGE_SKILL_NAMES = ["index-network", "edgeos", "edge-esmeralda"] as const;

/** Returns the cron name prefix for a given agent display name. */
export function cronDisplayPrefix(name: string): string {
  return `${name} —`;
}

/**
 * Reads the agent display name from `IDENTITY.md` in `home`.
 * Parses the `Display name:` field and returns the value, or `"Edge"` if missing/empty.
 */
export function readIdentityName(home: string): string {
  const identityPath = join(home, "IDENTITY.md");
  if (!existsSync(identityPath)) return "Edge";
  const content = readFileSync(identityPath, "utf8");
  for (const line of content.split("\n")) {
    const match = line.match(/^Display name:\s*(.+)/);
    if (match) {
      const value = match[1].trim();
      return value || "Edge";
    }
  }
  return "Edge";
}
