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
export const EDGE_SKILL_NAMES = [
  "index-network",
  "edgeos",
  "edge-esmeralda",
  "geo-esmeralda",
] as const;

export const CRON_NAME_PREFIX = "Edge —";
