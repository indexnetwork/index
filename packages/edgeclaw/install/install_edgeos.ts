/**
 * EdgeOS backend installer.
 *
 * EdgeOS supplies the live event schedule, RSVPs, venues, and attendee
 * directory used by `skills/edge-esmeralda/SKILL.md`. The skill teaches the
 * agent HTTP recipes against `api.edgeos.world` and the citizen portal —
 * recipes that reference `$EDGEOS_API_KEY` and `$EDGEOS_BEARER_TOKEN`. The
 * agent runs `curl` (or equivalent) via OpenClaw's shell tool, which
 * inherits env from the gateway process. So we plumb the two tokens through
 * `env.vars.*` in OpenClaw config; the gateway merges that map into its
 * process env at startup and the agent's subprocesses inherit them.
 *
 * Both tokens are optional from EdgeClaw's perspective. If either is
 * missing, the agent still works for everything else; EdgeOS recipes will
 * just fail at first use and the SKILL.md instructs the agent to ask the
 * user for the missing token inline at that point.
 *
 * Invoked only by the orchestrator (`install.ts`). Reads two optional flags:
 *
 *   - `--edgeos-api-key <eos_live_...>` — personal access token issued at
 *     `/portal/api-keys` in the EdgeOS portal. Required for events, RSVPs,
 *     venues. Lands in `env.vars.EDGEOS_API_KEY`.
 *   - `--edgeos-bearer-token <jwt>` — citizen-portal JWT. Required for the
 *     attendee directory. Lands in `env.vars.EDGEOS_BEARER_TOKEN`.
 */

import { execFileSync } from "node:child_process";

import { readFlag } from "./args";

const FLAG_TO_ENV_VAR: ReadonlyArray<readonly [string, string]> = [
  ["--edgeos-api-key", "EDGEOS_API_KEY"],
  ["--edgeos-bearer-token", "EDGEOS_BEARER_TOKEN"],
];

function setEnvVar(name: string, value: string): void {
  // `openclaw config set env.vars.<NAME> <value>` — writes a literal into
  // openclaw.json so the gateway daemon picks it up on its next start,
  // independent of whether the env var is set when the daemon is restarted.
  // execFileSync (array form) skips the shell so values with spaces, quotes,
  // or other special characters can pass through unescaped. `--strict-json`
  // is omitted because string values do not need JSON quoting in value mode.
  execFileSync(
    "openclaw",
    ["config", "set", `env.vars.${name}`, value],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
}

export function installEdgeos(): void {
  const present: string[] = [];
  const missing: string[] = [];

  for (const [flag, envName] of FLAG_TO_ENV_VAR) {
    const value = readFlag(flag)?.trim();
    if (value) {
      setEnvVar(envName, value);
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

  console.log(`→ edgeos: wired ${present.join(", ")} into env.vars`);
  if (missing.length > 0) {
    console.log(
      `  note: ${missing.join(", ")} not set — recipes that need them will prompt the user at first use`,
    );
  }
}
