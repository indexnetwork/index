#!/usr/bin/env bun
/**
 * Edge Hermes reset script.
 *
 * Tears down Edge installer artifacts under `$HERMES_HOME` without
 * removing unrelated Hermes skills (apple, github, etc.).
 *
 * Usage:
 *   bun install/reset.ts
 *   bun install/reset.ts --wipe-user
 */

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import YAML from "yaml";

import {
  CRON_NAME_PREFIX,
  EDGE_SKILL_NAMES,
  hermesHome,
  skillsDir,
  targetWorkspace,
} from "./paths";

const TARGET_HOME = targetWorkspace();

const PROJECT_FILES = ["AGENTS.md", "SCHEDULE.md"];

function ensureHermesAvailable(): void {
  try {
    execFileSync("hermes", ["--version"], { stdio: "ignore" });
  } catch {
    console.error("error: `hermes` CLI not found on PATH");
    process.exit(1);
  }
}

function removeLegacyWorkspaceEdge(): void {
  const legacy = join(hermesHome(), "workspace", "edge");
  if (!existsSync(legacy)) return;
  rmSync(legacy, { recursive: true, force: true });
  console.log(`→ removed legacy ${legacy}`);
}

function removeCronJobs(): void {
  const jobsPath = join(hermesHome(), "cron", "jobs.json");
  if (!existsSync(jobsPath)) {
    console.log("→ no cron jobs file found, skipping");
    return;
  }

  let parsed: { jobs?: Array<{ id: string; name: string }> };
  try {
    parsed = JSON.parse(readFileSync(jobsPath, "utf8"));
  } catch {
    console.log("→ could not read cron jobs, skipping");
    return;
  }

  const edgeJobs = (parsed.jobs ?? []).filter((j) => j.name.startsWith(CRON_NAME_PREFIX));
  if (edgeJobs.length === 0) {
    console.log("→ no Edge cron jobs found");
    return;
  }

  for (const job of edgeJobs) {
    try {
      execFileSync("hermes", ["cron", "remove", job.id], { stdio: "ignore" });
      console.log(`→ removed cron job: ${job.name}`);
    } catch {
      console.warn(`  warning: could not remove job ${job.id} (${job.name})`);
    }
  }
}

function removeIndexMcpEntry(): void {
  const configPath = join(hermesHome(), "config.yaml");
  if (!existsSync(configPath)) return;

  let doc: Record<string, unknown>;
  try {
    doc = YAML.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  } catch {
    console.warn("  warning: could not parse config.yaml, skipping mcp_servers.index removal");
    return;
  }

  const mcpServers = doc.mcp_servers as Record<string, unknown> | undefined;
  if (!mcpServers?.index) {
    console.log("→ mcp_servers.index not set, skipping");
    return;
  }

  delete mcpServers.index;
  if (Object.keys(mcpServers).length === 0) delete doc.mcp_servers;
  writeFileSync(configPath, YAML.stringify(doc));
  console.log("→ removed mcp_servers.index from config.yaml");
}

function removeSoulFile(): void {
  const soulPath = join(hermesHome(), "SOUL.md");
  if (!existsSync(soulPath)) return;
  rmSync(soulPath, { force: true });
  console.log(`→ removed ${soulPath} (Hermes will re-seed default on next start)`);
}

function removeEdgeSkills(): void {
  const root = skillsDir();
  let removed = 0;
  for (const name of EDGE_SKILL_NAMES) {
    const target = join(root, name);
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    removed++;
  }
  if (removed > 0) {
    console.log(`→ removed ${removed} Edge skill bundle(s) from ${root}`);
  }
}

function removeProjectFiles(wipeUser: boolean): void {
  const toRemove = wipeUser ? [...PROJECT_FILES, "USER.md", "MEMORY.md"] : PROJECT_FILES;
  let removed = 0;

  for (const entry of toRemove) {
    const target = join(TARGET_HOME, entry);
    if (!existsSync(target)) continue;
    const stat = statSync(target);
    rmSync(target, { recursive: stat.isDirectory(), force: true });
    removed++;
  }

  if (wipeUser) {
    const memoryDir = join(TARGET_HOME, "memory");
    if (existsSync(memoryDir)) {
      rmSync(memoryDir, { recursive: true, force: true });
      removed++;
      console.log("→ removed memory/");
    }
  }

  console.log(`→ removed ${removed} project file(s) from ${TARGET_HOME}`);
  if (!wipeUser && existsSync(join(TARGET_HOME, "USER.md"))) {
    console.log("  (USER.md preserved — pass --wipe-user to also remove it)");
  }
}

function restartGateway(): void {
  try {
    execFileSync("hermes", ["gateway", "restart"], { stdio: ["ignore", "ignore", "inherit"] });
    console.log("→ gateway restarted");
  } catch {
    console.warn("  warning: could not restart gateway — run: hermes gateway restart");
  }
}

function main(): void {
  const wipeUser = process.argv.includes("--wipe-user");

  console.log("Edge Hermes reset");
  console.log("=================");
  console.log("");

  ensureHermesAvailable();
  removeLegacyWorkspaceEdge();
  removeCronJobs();
  removeIndexMcpEntry();
  removeSoulFile();
  removeEdgeSkills();
  removeProjectFiles(wipeUser);
  restartGateway();

  console.log("");
  console.log("✓ reset complete");
  console.log("");
  console.log("next:");
  console.log("  re-install: bun install/install.ts --index-api-key <KEY>");
}

main();
