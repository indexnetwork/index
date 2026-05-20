#!/usr/bin/env bun
/**
 * EdgeClaw reset script.
 *
 * Tears down everything EdgeClaw installed, leaving the underlying OpenClaw
 * setup (Telegram bot token, OpenRouter key, gateway config) untouched.
 * After this runs, re-install with `bun install.ts <API_KEY>`.
 *
 * What gets removed:
 *   - All cron jobs whose name starts with "EdgeClaw"
 *   - `mcp.servers.index` config entry
 *   - `channels.telegram.streaming.mode` override (restores gateway default)
 *   - All workspace files staged by the installer (AGENTS.md, SOUL.md, etc.)
 *     Preserves USER.md and the agent-curated MEMORY.md by default — pass
 *     --wipe-user to also remove them.
 *
 * What is NOT touched:
 *   - Telegram bot token and channel config
 *   - OpenRouter API key and model config
 *   - Gateway port, auth token, and bind settings
 *   - Sessions, memory logs, and other OpenClaw state
 *
 * Usage:
 *   bun reset.ts
 *   bun reset.ts --wipe-user    # also removes USER.md and MEMORY.md
 */

import { existsSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");

const CRON_NAME_PREFIX = "EdgeClaw";

const WORKSPACE_FILES = [
  "AGENTS.md",
  "BOOTSTRAP.md",
  "COMMUNITY.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "skills",
];

function ensureOpenclawAvailable(): void {
  try {
    execSync("openclaw --version", { stdio: "ignore" });
  } catch {
    console.error("error: `openclaw` CLI not found on PATH");
    process.exit(1);
  }
}

function removeCronJobs(): void {
  let jobs: Array<{ id: string; name: string }> = [];
  try {
    const raw = execSync("openclaw cron list --json", { encoding: "utf8" });
    const parsed = JSON.parse(raw) as { jobs?: Array<{ id: string; name: string }> };
    jobs = parsed.jobs ?? [];
  } catch {
    console.log("→ could not list cron jobs (gateway may be down), skipping");
    return;
  }

  const edgeClawJobs = jobs.filter((j) => j.name.startsWith(CRON_NAME_PREFIX));
  if (edgeClawJobs.length === 0) {
    console.log("→ no EdgeClaw cron jobs found");
    return;
  }

  for (const job of edgeClawJobs) {
    try {
      execSync(`openclaw cron remove ${job.id}`, { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`→ removed cron job: ${job.name}`);
    } catch {
      console.warn(`  warning: could not remove job ${job.id} (${job.name})`);
    }
  }
}

function unpatchOpenclawConfig(): void {
  try {
    execSync("openclaw config unset mcp.servers.index", { stdio: "ignore" });
    console.log("→ removed mcp.servers.index");
  } catch {
    console.log("→ mcp.servers.index not set, skipping");
  }

  try {
    execSync("openclaw config unset channels.telegram.streaming.mode", { stdio: "ignore" });
    console.log("→ removed channels.telegram.streaming.mode override");
  } catch {
    // Not set — fine.
  }
}

function removeWorkspaceFiles(wipeUser: boolean): void {
  if (!existsSync(TARGET_WORKSPACE)) {
    console.log("→ workspace directory not found, skipping");
    return;
  }

  const toRemove = wipeUser
    ? [...WORKSPACE_FILES, "USER.md", "MEMORY.md"]
    : WORKSPACE_FILES;
  let removed = 0;

  for (const entry of toRemove) {
    const target = join(TARGET_WORKSPACE, entry);
    if (!existsSync(target)) continue;
    const stat = statSync(target);
    rmSync(target, { recursive: stat.isDirectory(), force: true });
    removed++;
  }

  // Clean up memory directory only if explicitly wiping (it may have user notes)
  if (wipeUser) {
    const memoryDir = join(TARGET_WORKSPACE, "memory");
    if (existsSync(memoryDir)) {
      rmSync(memoryDir, { recursive: true, force: true });
      removed++;
      console.log("→ removed workspace/memory/");
    }
    // workspace-state.json holds OpenClaw's bootstrapSeededAt / setupCompletedAt
    // markers — its presence is what OpenClaw uses to skip BOOTSTRAP.md
    // injection on subsequent sessions. Removing it makes OpenClaw treat the
    // workspace as fresh on next session and re-inject the bootstrap ritual.
    const openclawStateDir = join(TARGET_WORKSPACE, ".openclaw");
    if (existsSync(openclawStateDir)) {
      rmSync(openclawStateDir, { recursive: true, force: true });
      removed++;
      console.log("→ removed workspace/.openclaw/");
    }
  }

  console.log(`→ removed ${removed} workspace entries from ${TARGET_WORKSPACE}`);
  if (!wipeUser && existsSync(join(TARGET_WORKSPACE, "USER.md"))) {
    console.log("  (USER.md preserved — pass --wipe-user to also remove it)");
  }
}

function restartGateway(): void {
  try {
    execSync("openclaw gateway restart", { stdio: ["ignore", "ignore", "inherit"] });
    console.log("→ gateway restarted");
  } catch {
    console.warn("  warning: could not restart gateway — restart manually with: openclaw gateway restart");
  }
}

function main(): void {
  const wipeUser = process.argv.includes("--wipe-user");

  console.log("EdgeClaw reset");
  console.log("==============");
  console.log("");

  ensureOpenclawAvailable();
  removeCronJobs();
  unpatchOpenclawConfig();
  removeWorkspaceFiles(wipeUser);
  restartGateway();

  console.log("");
  console.log("✓ reset complete");
  console.log("");
  console.log("next:");
  console.log("  re-install: bun install.ts <API_KEY>");
}

main();
