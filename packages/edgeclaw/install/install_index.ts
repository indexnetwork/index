/**
 * Index Network backend installer.
 *
 * Wires the Index Network protocol into OpenClaw:
 *
 *   - Writes `mcp.servers.index` to the protocol URL with the user's API key.
 *   - Installs three cron jobs: daily digest (08:00), ambient discovery
 *     afternoon (14:00), ambient discovery evening (20:00) — all host-local.
 *     Each pass is selective — max 3 direct + 3 introducer opportunities per
 *     dispatch, gated on the same quality bar.
 *
 * Invoked only by the orchestrator (`install.ts`) — not a standalone
 * entrypoint. The orchestrator reads `<API_KEY>` and `--dev` from
 * `process.argv` and this module reads the same args.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const PROD_MCP_URL = "https://protocol.index.network/mcp";
const DEV_MCP_URL = "https://protocol.dev.index.network/mcp";

const FLAGS = process.argv.slice(2).filter((a) => a.startsWith("--"));
const POSITIONALS = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const IS_DEV = FLAGS.includes("--dev");
const PROTOCOL_MCP_URL =
  process.env.INDEX_MCP_URL?.trim() || (IS_DEV ? DEV_MCP_URL : PROD_MCP_URL);

function readApiKey(): string {
  const fromArg = POSITIONALS[0]?.trim();
  const fromEnv = process.env.API_KEY?.trim() ?? process.env.INDEX_API_KEY?.trim();
  const key = fromArg || fromEnv;
  if (!key) {
    console.error("error: API_KEY required");
    console.error("usage: bun install.ts <API_KEY> [--dev]");
    console.error("       API_KEY=<key> bun install.ts [--dev]");
    process.exit(1);
  }
  return key;
}

function writeMcpServerEntry(apiKey: string): void {
  const mcpEntry = JSON.stringify({
    url: PROTOCOL_MCP_URL,
    transport: "streamable-http",
    headers: {
      "x-api-key": apiKey,
      "x-index-surface": "telegram",
    },
  });
  console.log("→ writing mcp.servers.index");
  execSync(`openclaw config set mcp.servers.index '${mcpEntry}' --strict-json`, {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function installCronJobs(): void {
  const npmBin = `${process.env.HOME}/.npm/bin`;
  const localBin = `${process.env.HOME}/.local/bin`;
  const env = { ...process.env, PATH: `${npmBin}:${localBin}:${process.env.PATH}` };
  const workspaceDir = join(homedir(), ".openclaw", "workspace");

  // Remove existing EdgeClaw cron jobs before re-adding to stay idempotent.
  try {
    const raw = execSync("openclaw cron list --json", { encoding: "utf8", env });
    const parsed = JSON.parse(raw) as { jobs?: Array<{ id: string; name: string }> };
    for (const job of parsed.jobs ?? []) {
      if (job.name.startsWith("EdgeClaw")) {
        execSync(`openclaw cron remove ${job.id}`, { stdio: "ignore", env });
      }
    }
  } catch {
    // Gateway may be mid-restart; proceed and let cron add handle any conflicts.
  }

  console.log("→ installing cron jobs");

  // `--no-deliver` disables the runner's announce fallback. The agent must use
  // the `message` tool to deliver visible content; anything the agent says as
  // its final assistant text stays internal. This eliminates the entire class
  // of NO_REPLY-token-leak bugs (textNO_REPLY, JSON envelopes, partial tokens)
  // because there is no fallback channel for malformed silent tokens to bypass.
  // The `--channel`/`--to` binding still resolves the `message` tool's target
  // and is patched in by the orchestrator's `bindCronsToTelegram` once a
  // Telegram session exists.
  execSync(
    `openclaw cron add \
      --name "EdgeClaw — daily digest" \
      --cron "0 8 * * *" \
      --session isolated \
      --light-context \
      --no-deliver \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/digest.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );

  execSync(
    `openclaw cron add \
      --name "EdgeClaw — ambient discovery (afternoon)" \
      --cron "0 14 * * *" \
      --session isolated \
      --light-context \
      --no-deliver \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/ambient.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );

  execSync(
    `openclaw cron add \
      --name "EdgeClaw — ambient discovery (evening)" \
      --cron "0 20 * * *" \
      --session isolated \
      --light-context \
      --no-deliver \
      --channel last \
      --message "$(cat ${workspaceDir}/prompts/ambient.md)"`,
    { stdio: ["ignore", "ignore", "inherit"], env, shell: "/bin/sh" },
  );
}

export function installIndex(): void {
  const apiKey = readApiKey();
  console.log(
    `→ index network: target=${IS_DEV ? "dev" : "production"} (${PROTOCOL_MCP_URL})`,
  );
  writeMcpServerEntry(apiKey);
  installCronJobs();
}
