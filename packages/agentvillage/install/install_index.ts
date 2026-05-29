/**
 * Index Network backend installer for Hermes.
 *
 *   - Merges `mcp_servers.index` into `$HERMES_HOME/config.yaml`
 *   - Writes `INDEX_API_KEY` to `$HERMES_HOME/.env`
 *   - Installs the digest crons: prepare (`Edge — digest prepare`, 02:00) and
 *     send (`Edge — daily digest`, 08:00) — both host-local
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
  schedule: string;
  /** Prompt file under skills/index-network/prompts/. */
  promptFile: string;
  /** Full Hermes cron name (kept under the CRON_NAME_PREFIX). */
  name: string;
  /** Whether to attach --deliver telegram. */
  deliver: boolean;
}

/**
 * The morning digest runs as two fixed-time dispatches: a prepare pass that
 * composes the brief and stages it on the Kanban board (no delivery), and a
 * send pass that delivers the staged brief.
 */
export const DIGEST_CRON_SPECS: DigestCronSpec[] = [
  { schedule: "0 2 * * *", promptFile: "prepare.md", name: "Edge — digest prepare", deliver: false },
  { schedule: "0 8 * * *", promptFile: "send.md", name: "Edge — daily digest", deliver: true },
];

/** Build the argv for `hermes cron create` from a spec + resolved prompt body. */
export function cronCreateArgs(spec: DigestCronSpec, promptBody: string, home: string): string[] {
  const args = ["cron", "create", spec.schedule, promptBody, "--name", spec.name];
  if (spec.deliver) args.push("--deliver", "telegram");
  args.push("--workdir", home);
  return args;
}

function installCronJobs(env: NodeJS.ProcessEnv): void {
  const home = hermesHome();
  const promptsDir = join(home, "skills/index-network/prompts");

  const bin = hermesBin();
  if (bin === "hermes") {
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
    console.log(`→ installing cron "${spec.name}" (${spec.schedule})`);
    try {
      execFileSync(bin, cronCreateArgs(spec, promptBody, home), {
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
