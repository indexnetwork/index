/**
 * Index Network backend installer.
 *
 * Wires the Index Network protocol into OpenClaw:
 *
 *   - Writes `mcp.servers.index` to the protocol URL with the user's API key.
 *   - Installs the morning-digest cron (08:00 host-local). The afternoon
 *     (14:00) and evening (20:00) ambient passes are opt-in via the schedule
 *     sub-dialog in `workspace/SCHEDULE.md`. Each pass is selective — max 3
 *     direct + 3 introducer opportunities per dispatch, quality-gated.
 *
 * Invoked only by the orchestrator (`install.ts`) — not a standalone
 * entrypoint. Reads `--index-api-key <value>` and `--dev` from
 * `process.argv` and `INDEX_MCP_URL` from env for the MCP URL override.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync, execFileSync } from "node:child_process";

import { readFlag } from "./args";

const PROD_MCP_URL = "https://protocol.index.network/mcp";
const DEV_MCP_URL = "https://protocol.dev.index.network/mcp";

const IS_DEV = process.argv.slice(2).includes("--dev");
const PROTOCOL_MCP_URL =
  process.env.INDEX_MCP_URL?.trim() || (IS_DEV ? DEV_MCP_URL : PROD_MCP_URL);

function readApiKey(): string {
  const key = readFlag("--index-api-key")?.trim();
  if (!key) {
    console.error("error: --index-api-key required");
    console.error("usage: bun install/install.ts --index-api-key <KEY> [--dev]");
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
    const raw = execFileSync("openclaw", ["cron", "list", "--json"], { encoding: "utf8", env });
    const parsed = JSON.parse(raw) as { jobs?: Array<{ id: string; name: string }> };
    for (const job of parsed.jobs ?? []) {
      if (job.name.startsWith("EdgeClaw")) {
        execFileSync("openclaw", ["cron", "remove", job.id], { stdio: "ignore", env });
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
  //
  // Default install adds only the morning digest. The afternoon and evening
  // ambient passes are opt-in — the user enables them through the schedule
  // sub-dialog (`workspace/SCHEDULE.md`), which calls `openclaw cron add`
  // with the same shape against the prompts in `skills/index-network/prompts/`.
  //
  // The message body is read in Node and passed as a literal argv element via
  // `execFileSync` (array form). The shell never sees the value, so anything
  // inside the prompt (backticks, $vars, quotes, semicolons) passes through
  // unmolested — no escaping, no command-substitution surprises.
  const digestMessage = readFileSync(
    join(workspaceDir, "skills/index-network/prompts/digest.md"),
    "utf8",
  );
  execFileSync(
    "openclaw",
    [
      "cron", "add",
      "--name", "EdgeClaw — daily digest",
      "--cron", "0 8 * * *",
      "--session", "isolated",
      "--light-context",
      "--no-deliver",
      "--channel", "last",
      "--message", digestMessage,
    ],
    { stdio: ["ignore", "ignore", "inherit"], env },
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
