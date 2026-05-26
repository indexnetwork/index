import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hermesHome } from "./paths";

/** Set or replace `KEY=value` in `~/.hermes/.env` (or `$HERMES_HOME/.env`). */
export function upsertEnvVar(key: string, value: string): void {
  const envPath = join(hermesHome(), ".env");
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n") : [];
  const prefix = `${key}=`;
  const kept = lines.filter((line) => line.length > 0 && !line.startsWith(prefix));
  kept.push(`${key}=${value}`);
  writeFileSync(envPath, `${kept.join("\n")}\n`);
}
