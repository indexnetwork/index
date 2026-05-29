/**
 * Index Network backend installer for Hermes.
 *
 *   - Merges `mcp_servers.index` into `$HERMES_HOME/config.yaml`
 *   - Writes `INDEX_API_KEY` to `$HERMES_HOME/.env`
 *   - Installs the digest crons: prepare (`Edge — digest prepare`, 02:00) and
 *     send (`Edge — daily digest`, 08:00) — both host-local; times overridable
 *     via --digest-prepare-cron / --digest-send-cron (or DIGEST_PREPARE_CRON /
 *     DIGEST_SEND_CRON)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

import { readFlag } from "./args";
import { upsertEnvVar } from "./env";
import { hermesBin, hermesExecEnv } from "./hermes_cli";
import { CRON_NAME_PREFIX, hermesHome } from "./paths";

const PROD_MCP_URL = "https://protocol.index.network/mcp";
const DEV_MCP_URL = "https://protocol.dev.index.network/mcp";

const IS_DEV = process.argv.slice(2).includes("--dev");
const PROTOCOL_MCP_URL =
  process.env.INDEX_MCP_URL?.trim() || (IS_DEV ? DEV_MCP_URL : PROD_MCP_URL);

function readApiKey(): string {
  const key = readFlag("--index-api-key")?.trim() || process.env.INDEX_API_KEY?.trim();
  if (!key) {
    console.error("error: --index-api-key required (or set INDEX_API_KEY)");
    console.error("usage: bun install/install.ts --index-api-key <KEY> [--dev]");
    process.exit(1);
  }
  return key;
}

function writeMcpServerEntry(apiKey: string): void {
  const configPath = join(hermesHome(), "config.yaml");
  let doc: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    doc = YAML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  }
  const mcpServers = { ...((doc.mcp_servers as Record<string, unknown>) ?? {}) };
  mcpServers.index = {
    url: PROTOCOL_MCP_URL,
    headers: {
      "x-api-key": apiKey,
      "x-index-surface": "telegram",
    },
  };
  doc.mcp_servers = mcpServers;
  writeFileSync(configPath, YAML.stringify(doc));
  console.log("→ wrote mcp_servers.index in config.yaml");
}

function readPersistedEnvVar(key: string): string {
  const envPath = join(hermesHome(), ".env");
  if (!existsSync(envPath)) return "";

  const prefix = `${key}=`;
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((entry) => entry.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : "";
}


function removeEdgeCronJobs(env: NodeJS.ProcessEnv): void {
  const jobsPath = join(hermesHome(), "cron", "jobs.json");
  if (!existsSync(jobsPath)) return;

  let parsed: { jobs?: Array<{ id: string; name: string }> };
  try {
    parsed = JSON.parse(readFileSync(jobsPath, "utf8"));
  } catch {
    return;
  }

  const bin = hermesBin();
  for (const job of parsed.jobs ?? []) {
    if (!job.name.startsWith(CRON_NAME_PREFIX)) continue;
    try {
      execFileSync(bin, ["cron", "remove", job.id], { stdio: "ignore", env });
      console.log(`→ removed cron ${job.name}`);
    } catch {
      console.warn(`  warning: could not remove cron ${job.name}`);
    }
  }
}

export interface DigestCronSpec {
  /** Default cron schedule (overridable at install time). */
  schedule: string;
  /** Prompt file under skills/index-network/prompts/. */
  promptFile: string;
  /** Full Hermes cron name (kept under the CRON_NAME_PREFIX). */
  name: string;
  /** Whether to attach --deliver telegram. */
  deliver: boolean;
  /** CLI flag that overrides `schedule` at install time. */
  overrideFlag: string;
  /** Env var that overrides `schedule` at install time (flag wins). */
  overrideEnv: string;
}

/**
 * The morning digest runs as two fixed-time dispatches: a prepare pass that
 * composes the brief and stages it on the Kanban board (no delivery), and a
 * send pass that delivers the staged brief.
 */
export const DIGEST_CRON_SPECS: DigestCronSpec[] = [
  {
    schedule: "0 2 * * *",
    promptFile: "prepare.md",
    name: "Edge — digest prepare",
    deliver: false,
    overrideFlag: "--digest-prepare-cron",
    overrideEnv: "DIGEST_PREPARE_CRON",
  },
  {
    schedule: "0 8 * * *",
    promptFile: "send.md",
    name: "Edge — daily digest",
    deliver: true,
    overrideFlag: "--digest-send-cron",
    overrideEnv: "DIGEST_SEND_CRON",
  },
];

/** Build the argv for `hermes cron create` from a spec + resolved prompt body. */
export function cronCreateArgs(spec: DigestCronSpec, promptBody: string, home: string): string[] {
  const args = ["cron", "create", spec.schedule, promptBody, "--name", spec.name];
  if (spec.deliver) args.push("--deliver", "telegram");
  args.push("--workdir", home);
  return args;
}

/** True for a standard 5-field cron expression (minute hour day-of-month month day-of-week). */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  return fields.length === 5 && fields.every((f) => /^[\d*,/-]+$/.test(f));
}

/**
 * Resolve a spec's cron schedule, honoring an optional install-time override.
 * Precedence: CLI flag (`<overrideFlag> <expr>`) > env var (`overrideEnv`) > the
 * spec default. An override that is not a valid 5-field cron expression is
 * ignored (with a warning) and the default is used.
 */
export function resolveCronSchedule(
  spec: DigestCronSpec,
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const flagIdx = argv.indexOf(spec.overrideFlag);
  const fromFlag = flagIdx >= 0 ? argv[flagIdx + 1]?.trim() : undefined;
  const override = fromFlag || env[spec.overrideEnv]?.trim();
  if (!override) return spec.schedule;
  if (!isValidCron(override)) {
    console.warn(
      `  warning: ignoring invalid cron override for "${spec.name}" ("${override}") — using default "${spec.schedule}"`,
    );
    return spec.schedule;
  }
  return override;
}

/**
 * Probe whether the Hermes CLI can actually run. `hermesBin()` falls back to the
 * bare name `"hermes"` when it finds no fixed-path binary, but that name still
 * resolves on PATH (the augmented env adds ~/.local/bin etc.). So test by
 * executing `hermes --version` rather than string-comparing the resolved name.
 */
function hermesAvailable(bin: string): boolean {
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore", env: hermesExecEnv() });
    return true;
  } catch {
    return false;
  }
}

function installCronJobs(env: NodeJS.ProcessEnv): void {
  const home = hermesHome();
  const promptsDir = join(home, "skills/index-network/prompts");

  const bin = hermesBin();
  if (!hermesAvailable(bin)) {
    console.warn("  warning: hermes CLI not found — skipping digest crons");
    return;
  }

  removeEdgeCronJobs(env);

  // Ensure the Kanban store exists (idempotent; prepare/send stage tasks on it).
  try {
    execFileSync(bin, ["kanban", "init"], { stdio: "ignore", env: hermesExecEnv() });
  } catch {
    console.warn("  warning: could not run `hermes kanban init` — board may auto-init on first use");
  }

  for (const spec of DIGEST_CRON_SPECS) {
    const promptPath = join(promptsDir, spec.promptFile);
    if (!existsSync(promptPath)) {
      console.error(`error: prompt missing at ${promptPath} — run install.ts first`);
      process.exit(1);
    }
    const promptBody = readFileSync(promptPath, "utf8");
    const schedule = resolveCronSchedule(spec);
    const resolved = { ...spec, schedule };
    const suffix = schedule === spec.schedule ? "" : " [overridden]";
    console.log(`→ installing cron "${spec.name}" (${schedule})${suffix}`);
    try {
      execFileSync(bin, cronCreateArgs(resolved, promptBody, home), {
        stdio: ["ignore", "ignore", "inherit"],
        env: hermesExecEnv(),
      });
    } catch {
      console.warn(`  warning: could not install cron "${spec.name}" — gateway may still run`);
    }
  }
}

export function installIndex(): void {
  const apiKey = readApiKey();
  console.log(
    `→ index network: target=${IS_DEV ? "dev" : "production"} (${PROTOCOL_MCP_URL})`,
  );
  upsertEnvVar("INDEX_API_KEY", apiKey);
  writeMcpServerEntry(apiKey);

  installCronJobs(hermesExecEnv());
}
