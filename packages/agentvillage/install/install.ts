#!/usr/bin/env bun
/**
 * Edge Hermes installer (orchestrator).
 *
 * Installs into Hermes defaults (flat under `$HERMES_HOME`):
 *
 *   - `SOUL.md` → `$HERMES_HOME/SOUL.md` (identity; overwrites generic Hermes soul)
 *   - `AGENTS.md`, `SCHEDULE.md`, `USER.md` → `$HERMES_HOME/`
 *   - Edge skill bundles → `$HERMES_HOME/skills/{index-network,edgeos,edge-esmeralda,geo-esmeralda}/`
 *   - `terminal.cwd` in config.yaml → `$HERMES_HOME`
 *   - Index MCP + morning digest cron (`install_index.ts`)
 *   - Geo CLI runtime note (`install_geo.ts`)
 *
 * Usage (from repo root):
 *   bun install/install.ts --index-api-key <KEY>
 *   bun install/install.ts --index-api-key <KEY> --dev
 *   bun install/install.ts --index-api-key <KEY> --wipe-user
 *   bun install/install.ts --index-api-key <KEY> --no-restart   # containers (gateway starts after)
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { installIndex } from "./install_index";
import { installEdgeos } from "./install_edgeos";
import { installGeo } from "./install_geo";
import { setTerminalCwd } from "./config";
import { hermesBin, hermesExecEnv } from "./hermes_cli";
import {
  EDGE_SKILL_NAMES,
  hermesHome,
  skillsDir,
  targetWorkspace,
} from "./paths";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "../workspace");
const SOURCE_SKILLS = join(SCRIPT_DIR, "../skills");
const TARGET_HOME = targetWorkspace();

function ensureHermesAvailable(): void {
  if (process.argv.includes("--no-restart")) return;

  const bin = hermesBin();
  try {
    execSync(`"${bin}" --version`, { stdio: "ignore", env: hermesExecEnv() });
  } catch {
    console.error("error: `hermes` CLI not found on PATH");
    console.error("       install Hermes first: https://github.com/NousResearch/hermes-agent");
    process.exit(1);
  }
}

function removeLegacyWorkspaceEdge(): void {
  const legacy = join(hermesHome(), "workspace", "edge");
  if (!existsSync(legacy)) return;
  rmSync(legacy, { recursive: true, force: true });
  console.log(`→ removed legacy ${legacy}`);
}

function copySoulFile(): void {
  const sourceSoul = join(SOURCE_WORKSPACE, "SOUL.md");
  const targetSoul = join(hermesHome(), "SOUL.md");
  if (!existsSync(sourceSoul)) return;
  copyFileSync(sourceSoul, targetSoul);
  console.log(`→ wrote SOUL.md to ${targetSoul}`);
}

function copyWorkspaceFiles(wipeUser: boolean): void {
  if (!existsSync(SOURCE_WORKSPACE)) {
    console.error(`error: bundled workspace missing at ${SOURCE_WORKSPACE}`);
    process.exit(1);
  }

  let copied = 0;
  let preservedUserNotes = false;
  for (const entry of readdirSync(SOURCE_WORKSPACE)) {
    if (entry === "SOUL.md") continue;

    const sourcePath = join(SOURCE_WORKSPACE, entry);
    const targetPath = join(TARGET_HOME, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) continue;

    if (!entry.endsWith(".md")) continue;

    if (entry === "USER.md" && !wipeUser && existsSync(targetPath)) {
      preservedUserNotes = true;
      continue;
    }
    copyFileSync(sourcePath, targetPath);
    copied++;
  }

  console.log(`→ staged ${copied} project files into ${TARGET_HOME}`);
  if (preservedUserNotes) {
    console.log("  (USER.md preserved — pass --wipe-user to overwrite it)");
  }

  if (wipeUser) {
    const filesToWipe = [
      join(TARGET_HOME, "MEMORY.md"),
      join(TARGET_HOME, "memory", "edge-state.json"),
    ];
    for (const path of filesToWipe) {
      if (existsSync(path)) {
        rmSync(path, { force: true });
        console.log(`→ removed ${path.replace(TARGET_HOME + "/", "")} (--wipe-user)`);
      }
    }
  }
}

function copyTree(sourceDir: string, targetDir: string): number {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      copied += copyTree(sourcePath, targetPath);
    } else {
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }
  return copied;
}

function copySkillFiles(): void {
  const targetSkillsRoot = skillsDir();
  if (!existsSync(targetSkillsRoot)) mkdirSync(targetSkillsRoot, { recursive: true });

  let copied = 0;
  for (const name of EDGE_SKILL_NAMES) {
    const sourcePath = join(SOURCE_SKILLS, name);
    if (!existsSync(sourcePath)) continue;
    copied += copyTree(sourcePath, join(targetSkillsRoot, name));
  }

  if (copied > 0) {
    console.log(`→ staged ${copied} files into ${targetSkillsRoot}/{${EDGE_SKILL_NAMES.join(",")}}`);
  }
}

function restartGateway(): void {
  console.log("→ restarting gateway");
  try {
    const bin = hermesBin();
    execSync(`"${bin}" gateway restart`, {
      stdio: ["ignore", "ignore", "inherit"],
      env: hermesExecEnv(),
    });
  } catch {
    console.warn("  warning: could not restart gateway — run manually: hermes gateway restart");
  }
}

function main(): void {
  ensureHermesAvailable();

  const wipeUser = process.argv.includes("--wipe-user");

  console.log("Edge Hermes installer");
  console.log("===================");
  console.log("");

  removeLegacyWorkspaceEdge();
  copySoulFile();
  copyWorkspaceFiles(wipeUser);
  copySkillFiles();
  setTerminalCwd();

  installIndex();
  installEdgeos();
  installGeo();

  if (!process.argv.includes("--no-restart")) {
    restartGateway();
  }

  console.log("");
  console.log("✓ installed");
  console.log(`  HERMES_HOME: ${TARGET_HOME}`);
  console.log("");
  console.log("next: message your Telegram bot — gateway uses terminal.cwd above");
}

main();
