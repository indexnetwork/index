/**
 * EdgeOS backend installer — writes tokens to `$HERMES_HOME/.env`.
 */

import { readFlag } from "./args";
import { upsertEnvVar } from "./env";

const FLAG_TO_ENV_VAR: ReadonlyArray<readonly [string, string]> = [
  ["--edgeos-api-key", "EDGEOS_API_KEY"],
  ["--edgeos-bearer-token", "EDGEOS_BEARER_TOKEN"],
];

export function installEdgeos(): void {
  const present: string[] = [];
  const missing: string[] = [];

  for (const [flag, envName] of FLAG_TO_ENV_VAR) {
    const value = readFlag(flag)?.trim() || process.env[envName]?.trim();
    if (value) {
      upsertEnvVar(envName, value);
      present.push(envName);
    } else {
      missing.push(envName);
    }
  }

  if (present.length === 0) {
    console.log(
      "→ edgeos: no tokens provided; live EdgeOS recipes will prompt the user at first use",
    );
    return;
  }

  console.log(`→ edgeos: wired ${present.join(", ")} into .env`);
  if (missing.length > 0) {
    console.log(
      `  note: ${missing.join(", ")} not set — recipes that need them will prompt the user at first use`,
    );
  }
}
