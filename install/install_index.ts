/**
 * Index Network backend installer for Hermes.
 *
 *   - Merges `mcp_servers.index` into `$HERMES_HOME/config.yaml`
 *   - Writes `INDEX_API_KEY` to `$HERMES_HOME/.env`
 *   - Installs the morning digest cron (`Edge — daily digest`, 08:00 host-local)
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

function installCronJobs(env: NodeJS.ProcessEnv): void {
  const home = hermesHome();
  const digestPath = join(home, "skills/index-network/prompts/digest.md");
  if (!existsSync(digestPath)) {
    console.error(`error: digest prompt missing at ${digestPath} — run install.ts first`);
    process.exit(1);
  }

  removeEdgeCronJobs(env);

  const digestMessage = readFileSync(digestPath, "utf8");
  console.log("→ installing morning digest cron");

  const deliver = process.env.TELEGRAM_HOME_CHANNEL?.trim() ? "telegram" : "origin";
  if (deliver === "origin") {
    console.log(
      "  note: TELEGRAM_HOME_CHANNEL not set — cron uses --deliver origin; set it in .env for telegram delivery",
    );
  }

  const bin = hermesBin();
  if (bin === "hermes") {
    console.warn("  warning: hermes CLI not found — skipping digest cron");
    return;
  }

  try {
    execFileSync(
      bin,
      [
        "cron",
        "create",
        "0 8 * * *",
        digestMessage,
        "--name",
        "Edge — daily digest",
        "--deliver",
        deliver,
        "--workdir",
        home,
      ],
      { stdio: ["ignore", "ignore", "inherit"], env: hermesExecEnv() },
    );
  } catch {
    console.warn("  warning: could not install digest cron — gateway may still run");
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
