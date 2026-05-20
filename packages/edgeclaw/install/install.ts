#!/usr/bin/env bun
/**
 * EdgeClaw installer (orchestrator).
 *
 * Pre-stages the EdgeClaw workspace and runs each backend installer. Today
 * only Index Network is wired up; EdgeOS and Geo are placeholders that
 * future contributors fill in.
 *
 * EdgeClaw-wide steps in this script:
 *
 *   - Verify `openclaw` is available on PATH.
 *   - Disable Telegram progress-draft "tidepooling" so the streaming-off
 *     setting is loaded on the very first gateway start (not deferred until
 *     the first bootstrap turn drains).
 *   - Copy the workspace markdown bundle (BOOTSTRAP, AGENTS, SOUL, USER,
 *     IDENTITY, TOOLS, HEARTBEAT, COMMUNITY) into `~/.openclaw/workspace/`.
 *   - Copy backend skill bundles from `skills/` into
 *     `~/.openclaw/workspace/skills/` so OpenClaw registers them as
 *     workspace skills.
 *   - Call each backend installer in `install_<backend>.ts`.
 *   - Bind any `EdgeClaw — *` cron jobs to the user's Telegram chat once a
 *     session exists, so digest / ambient deliveries route correctly.
 *   - Restart the gateway so all config changes and cron jobs take effect.
 *
 * Anything the agent should *do at runtime* (greet the user, create their
 * profile, send the welcome message body) stays in
 * skills/index-network/bootstrap.md / skills/index-network/prompts/welcome.md —
 * the installer does not impersonate the agent.
 *
 * Re-running the installer is the supported way to bind cron deliveries to
 * the user's Telegram chat once they've sent their first message. By
 * default, `USER.md` is preserved on re-install — it holds the user's
 * lived notes populated during `BOOTSTRAP.md`, and overwriting it with the
 * blank template would silently erase those notes. Pass `--wipe-user` to
 * overwrite `USER.md` and delete the agent-curated `MEMORY.md` so the next
 * session re-onboards from scratch. (Mirrors `reset.ts --wipe-user`.)
 *
 * Usage:
 *   bun install.ts <API_KEY>
 *   bun install.ts <API_KEY> --wipe-user
 *   API_KEY=... bun install.ts
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { installIndex } from "./install_index";
import { installEdgeos } from "./install_edgeos";
import { installGeo } from "./install_geo";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "../workspace");
const SOURCE_SKILLS = join(SCRIPT_DIR, "../skills");
const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");
const TARGET_SKILLS = join(TARGET_WORKSPACE, "skills");

function ensureOpenclawAvailable(): void {
  try {
    execSync("openclaw --version", { stdio: "ignore" });
  } catch {
    console.error("error: `openclaw` CLI not found on PATH");
    console.error("       install OpenClaw first: https://openclaw.dev");
    process.exit(1);
  }
}

function disableTelegramTidepooling(): void {
  console.log("→ disabling telegram progress-draft tidepooling");
  execSync("openclaw config set channels.telegram.streaming.mode off", {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function copyWorkspaceFiles(wipeUser: boolean): void {
  if (!existsSync(SOURCE_WORKSPACE)) {
    console.error(`error: bundled workspace missing at ${SOURCE_WORKSPACE}`);
    process.exit(1);
  }

  if (!existsSync(TARGET_WORKSPACE)) {
    mkdirSync(TARGET_WORKSPACE, { recursive: true });
  }

  let copied = 0;
  let preservedUserNotes = false;
  for (const entry of readdirSync(SOURCE_WORKSPACE)) {
    const sourcePath = join(SOURCE_WORKSPACE, entry);
    const targetPath = join(TARGET_WORKSPACE, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      if (!existsSync(targetPath)) mkdirSync(targetPath, { recursive: true });
      for (const inner of readdirSync(sourcePath)) {
        if (!inner.endsWith(".md")) continue;
        copyFileSync(join(sourcePath, inner), join(targetPath, inner));
        copied++;
      }
    } else if (entry.endsWith(".md")) {
      // USER.md holds the user's lived notes populated by BOOTSTRAP.md.
      // Re-running the installer (to bind cron deliveries) must not erase
      // those notes — preserve unless --wipe-user is set. Mirrors reset.ts.
      if (entry === "USER.md" && !wipeUser && existsSync(targetPath)) {
        preservedUserNotes = true;
        continue;
      }
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }

  console.log(`→ staged ${copied} workspace files into ${TARGET_WORKSPACE}`);
  if (preservedUserNotes) {
    console.log("  (USER.md preserved — pass --wipe-user to overwrite it)");
  }

  // MEMORY.md is agent-curated at runtime (not shipped in source), so it can't
  // be "reset to template" like USER.md — it's deleted instead. Without this,
  // the agent's long-term memories survive `--wipe-user` and keep biasing the
  // re-onboarding session toward the prior user identity.
  //
  // workspace-state.json holds OpenClaw's `bootstrapSeededAt` /
  // `setupCompletedAt` markers — its presence is what OpenClaw uses to skip
  // BOOTSTRAP.md injection on subsequent sessions. Deleting it makes OpenClaw
  // treat the workspace as fresh on the next session, so BOOTSTRAP.md (which
  // we re-staged above) is injected into the prompt and the onboarding ritual
  // re-runs.
  if (wipeUser) {
    const memoryFile = join(TARGET_WORKSPACE, "MEMORY.md");
    if (existsSync(memoryFile)) {
      rmSync(memoryFile, { force: true });
      console.log("→ removed MEMORY.md (--wipe-user)");
    }
    const workspaceStateFile = join(
      TARGET_WORKSPACE,
      ".openclaw",
      "workspace-state.json",
    );
    if (existsSync(workspaceStateFile)) {
      rmSync(workspaceStateFile, { force: true });
      console.log("→ removed workspace-state.json (--wipe-user)");
    }
  }
}

function copyMarkdownTree(sourceDir: string, targetDir: string): number {
  if (!existsSync(sourceDir)) return 0;
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

  let copied = 0;
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      copied += copyMarkdownTree(sourcePath, targetPath);
    } else if (entry.endsWith(".md")) {
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }
  return copied;
}

function copySkillFiles(): void {
  const copied = copyMarkdownTree(SOURCE_SKILLS, TARGET_SKILLS);
  if (copied > 0) {
    console.log(`→ staged ${copied} skill files into ${TARGET_SKILLS}`);
  }
}

/**
 * Reads `~/.openclaw/agents/main/sessions/sessions.json` and returns the
 * most-recently-updated Telegram-bound session, or `null` if the user has
 * not yet messaged the agent on Telegram. Used to bind cron deliveries to
 * the user's actual chat instead of `--channel last`, which fails for cron
 * jobs because they run in fresh isolated sessions with no `lastTo`.
 */
function findTelegramSession(): { sessionKey: string; to: string } | null {
  const sessionsPath = join(
    homedir(),
    ".openclaw",
    "agents",
    "main",
    "sessions",
    "sessions.json",
  );
  if (!existsSync(sessionsPath)) return null;
  let map: Record<
    string,
    {
      origin?: { provider?: string; to?: string };
      lastChannel?: string;
      lastTo?: string;
      updatedAt?: number;
    }
  >;
  try {
    map = JSON.parse(readFileSync(sessionsPath, "utf-8"));
  } catch {
    return null;
  }
  // Telegram bot delivery needs a numeric chatId — `telegram:<digits>`.
  // Reject sessions whose `to` is the username form (`telegram:@handle`),
  // a group placeholder (`telegram:@telegram`), or has no concrete `lastTo`.
  // OpenClaw can register multiple Telegram sessions per peer (one per
  // surface form); without this filter the most-recent entry can be a
  // username-shaped session that never resolves to a real Bot API chat.
  const TELEGRAM_NUMERIC = /^telegram:-?\d+$/;
  const candidates = Object.entries(map)
    .filter(([key, val]) => {
      if (!key.startsWith("agent:main:telegram:direct:")) return false;
      const to = val.lastTo ?? val.origin?.to ?? "";
      return TELEGRAM_NUMERIC.test(to);
    })
    .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const top = candidates[0];
  if (!top) return null;
  const to = top[1].lastTo ?? top[1].origin?.to ?? "";
  return { sessionKey: top[0], to };
}

function bindCronsToTelegram(
  session: { sessionKey: string; to: string },
  env: NodeJS.ProcessEnv,
): void {
  console.log(`→ binding crons to ${session.to}`);
  let raw: string;
  try {
    raw = execSync("openclaw cron list --json", { encoding: "utf8", env });
  } catch {
    console.warn("  warning: could not list crons to bind delivery");
    return;
  }
  const parsed = JSON.parse(raw) as { jobs?: Array<{ id: string; name: string }> };
  for (const job of parsed.jobs ?? []) {
    if (!job.name.startsWith("EdgeClaw")) continue;
    execSync(
      `openclaw cron edit ${job.id} --session-key ${session.sessionKey} --channel telegram --to ${session.to}`,
      { stdio: ["ignore", "ignore", "inherit"], env },
    );
  }
}

function restartGateway(): void {
  console.log("→ restarting gateway");
  try {
    execSync("openclaw gateway restart", { stdio: ["ignore", "ignore", "inherit"] });
  } catch {
    console.warn("  warning: could not restart gateway — run manually: openclaw gateway restart");
  }
}

function main(): void {
  ensureOpenclawAvailable();

  const wipeUser = process.argv.includes("--wipe-user");

  console.log("EdgeClaw installer");
  console.log("==================");
  console.log("");

  disableTelegramTidepooling();
  copyWorkspaceFiles(wipeUser);
  copySkillFiles();

  installIndex();
  installEdgeos();
  installGeo();

  const npmBin = `${process.env.HOME}/.npm/bin`;
  const localBin = `${process.env.HOME}/.local/bin`;
  const env = { ...process.env, PATH: `${npmBin}:${localBin}:${process.env.PATH}` };
  const session = findTelegramSession();
  if (session) {
    bindCronsToTelegram(session, env);
  }
  restartGateway();

  console.log("");
  console.log("✓ installed");
  console.log("");
  if (session) {
    console.log("crons are bound to your Telegram chat — digest, ambient passes will deliver.");
  } else {
    console.log("next:");
    console.log("  1. send any message to your agent on Telegram");
    console.log("  2. re-run `bun install.ts <key>` to bind cron deliveries to that chat");
  }
}

main();
