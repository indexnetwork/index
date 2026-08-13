#!/usr/bin/env node
/**
 * Index CLI — thin dispatcher that parses arguments, authenticates,
 * and delegates to the appropriate command handler module.
 *
 * Each command lives in its own `*.command.ts` file following the
 * `handleX(client, ...)` pattern.
 */

import { spawn } from "node:child_process";
import packageJson from "../package.json" with { type: "json" };

import { parseArgs } from "./args.parser";
import { CredentialStore } from "./auth.store";
import { ApiClient } from "./api.client";
import { handleLogin } from "./login.command";
import { handleLogout } from "./logout.command";
import { handleProfile } from "./profile.command";
import { handleIntent } from "./intent.command";
import { handleOpportunity } from "./opportunity.command";
import { handleNegotiation } from "./negotiation.command";
import { handleNetwork } from "./network.command";
import { handleConversation } from "./conversation.command";
import { handleContact } from "./contact.command";
import { handleScrape } from "./scrape.command";
import { handleSync } from "./sync.command";
import { handleOnboarding } from "./onboarding.command";
import * as output from "./output";

const DEFAULT_API_URL = "https://protocol.index.network";
const DEFAULT_APP_URL = "https://index.network";
const VERSION = packageJson.version;

/** Unicode box-drawing (rounded), same style as Honcho CLI. */
const BOX = { tl: "\u256d", tr: "\u256e", bl: "\u2570", br: "\u256f", h: "\u2500", v: "\u2502" } as const;

function visualLen(s: string): number {
  return output.stripAnsi(s).length;
}

function padVisual(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - visualLen(s)));
}

/**
 * Print a bordered panel with a title in the top edge.
 *
 * @param title - Short label embedded after `╭─`
 * @param rows - Inner lines (no border chars); each should start with a leading space for alignment.
 */
function panel(title: string, rows: string[]): void {
  const innerW = Math.max(
    52,
    title.length + 4,
    ...rows.map((r) => visualLen(r)),
  );
  const dashRun = Math.max(1, innerW - title.length - 3);
  const innerTop = `${BOX.h} ${title} ${BOX.h.repeat(dashRun)}`;
  console.log(`${output.GRAY}${BOX.tl}${innerTop}${BOX.tr}${output.RESET}`);
  for (const row of rows) {
    console.log(`${output.GRAY}${BOX.v}${output.RESET}${padVisual(row, innerW)}${output.GRAY}${BOX.v}${output.RESET}`);
  }
  console.log(`${output.GRAY}${BOX.bl}${BOX.h.repeat(innerW)}${BOX.br}${output.RESET}\n`);
}

function helpRowDim(leftW: number, left: string, right: string): string {
  const pad = Math.max(0, leftW - left.length);
  return ` ${output.GRAY}${left}${" ".repeat(pad)} ${right}${output.RESET}`;
}

function helpRowCmd(leftW: number, left: string, right: string): string {
  const pad = Math.max(0, leftW - left.length);
  return ` ${output.BOLD}${output.CYAN}${left}${output.RESET}${" ".repeat(pad)} ${right}`;
}

function helpRowCont(leftW: number, right: string): string {
  return ` ${" ".repeat(leftW)} ${right}`;
}

/** Print grouped help (rounded panels). */
function renderHelp(): void {
  const gsLefts = [
    "index login",
    "index logout",
    'index intent create "..."',
    "index negotiation list",
    "index opportunity list",
  ];
  const gsLW = Math.max(...gsLefts.map((s) => s.length));

  const formsLefts = [
    'index conversation "message"',
    "index conversation --session <id>",
    "index sync --json",
    "index profile create",
    "index profile update",
    "index intent list",
    "index negotiation list",
    "index opportunity list",
  ];
  const formsLW = Math.max(...formsLefts.map((s) => s.length));

  const cmdLefts = [
    "pattern",
    "example",
    "intent",
    "negotiation",
    "opportunity",
    "profile",
    "conversation",
    "network",
    "contact",
    "scrape",
    "sync",
    "onboarding",
  ];
  const cmdLW = Math.max(...cmdLefts.map((s) => s.length));

  const optLefts = [
    "--api-url <url>",
    "--app-url <url>",
    "--session <id>",
    "--archived",
    "--status <status>",
    "--limit <n>",
    "--since <date>",
    "--json",
    "--name <name>",
    "--gmail",
    "--objective <text>",
    "--linkedin <url>",
    "--github <url>",
    "--twitter <url>",
    "--title <text>",
    "--details <text>",
    "--help",
    "--version",
  ];
  const optLW = Math.max(...optLefts.map((s) => s.length));

  console.log();
  console.log(
    `  ${output.BOLD}${output.CYAN}I N D E X${output.RESET}  ${output.GRAY}cli${output.RESET}`,
  );
  console.log(`  ${output.GRAY}v${VERSION}${output.RESET}\n`);

  panel("getting started", [
    helpRowCmd(gsLW, "index login", "authenticate via browser"),
    helpRowCmd(gsLW, "index logout", "clear stored session"),
    helpRowCmd(gsLW, 'index intent create "..."', "describe what you're looking for"),
    helpRowCmd(gsLW, "index negotiation list", "see agent debates in progress"),
    helpRowCmd(gsLW, "index opportunity list", "see what was found for you"),
  ]);

  panel("common forms", [
    helpRowCmd(formsLW, 'index conversation "message"', "send a one-shot agent message"),
    helpRowCmd(formsLW, "index conversation --session <id>", "resume an agent chat session"),
    helpRowCmd(formsLW, "index sync --json", "print synced context as JSON"),
    "",
    helpRowCmd(formsLW, "index profile create", "use social URL flags"),
    helpRowCmd(formsLW, "index profile update", "use action text or --details"),
    helpRowCmd(formsLW, "index intent list", "supports --archived and --limit"),
    helpRowCmd(formsLW, "index negotiation list", "supports --since and --limit"),
    helpRowCmd(formsLW, "index opportunity list", "supports --status and --limit"),
  ]);

  panel("commands", [
    helpRowDim(cmdLW, "pattern", "index <command> [args] [options]"),
    helpRowDim(cmdLW, "example", 'index intent create "looking for a CTO"'),
    "",
    helpRowCmd(cmdLW, "intent", "list · show · create · update · archive"),
    helpRowCont(cmdLW, "link · unlink · links"),
    helpRowCmd(cmdLW, "negotiation", "list · show"),
    "",
    helpRowCmd(cmdLW, "profile", "show · sync · search · create · update"),
    helpRowCmd(cmdLW, "conversation", "sessions · list · with · show · send · stream"),
    helpRowCmd(cmdLW, "network", "list · create · show · update · delete"),
    helpRowCont(cmdLW, "join · leave · invite"),
    helpRowCmd(cmdLW, "contact", "list · add · remove · import"),
    "",
    helpRowCmd(cmdLW, "scrape", "extract content from a URL"),
    helpRowCmd(cmdLW, "sync", "download your context locally"),
    helpRowCmd(cmdLW, "onboarding", "finish account setup"),
  ]);

  panel("options", [
    helpRowDim(optLW, "--api-url <url>", "override API server URL"),
    helpRowDim(optLW, "--app-url <url>", "override app URL for login"),
    helpRowDim(optLW, "--session <id>", "resume a chat session"),
    helpRowDim(optLW, "--archived", "include archived signals"),
    helpRowDim(optLW, "--status <status>", "filter opportunities by status"),
    helpRowDim(optLW, "--limit <n>", "limit number of results"),
    helpRowDim(optLW, "--since <date>", "filter by ISO date or duration"),
    helpRowDim(optLW, "--json", "output raw JSON"),
    helpRowDim(optLW, "--name <name>", "name for contact add"),
    helpRowDim(optLW, "--gmail", "import contacts from Gmail"),
    helpRowDim(optLW, "--objective <text>", "objective for scrape command"),
    helpRowDim(optLW, "--linkedin <url>", "LinkedIn URL for profile create"),
    helpRowDim(optLW, "--github <url>", "GitHub URL for profile create"),
    helpRowDim(optLW, "--twitter <url>", "Twitter URL for profile create"),
    helpRowDim(optLW, "--title <text>", "title for network update"),
    helpRowDim(optLW, "--details <text>", "details for profile update"),
    helpRowDim(optLW, "--help", "show help for any command"),
    helpRowDim(optLW, "--version", "show version"),
  ]);
}

// ── Auth helper ──────────────────────────────────────────────────────

/**
 * Load stored auth and return an API client, or exit with an error.
 *
 * @param apiUrlOverride - Optional API URL override from --api-url flag.
 * @returns Authenticated API client.
 */
async function requireAuth(apiUrlOverride?: string): Promise<ApiClient> {
  const store = new CredentialStore();
  const creds = await store.load();

  if (!creds) {
    output.error("Not logged in. Run `index login` first.", 1);
    process.exit(1); // TypeScript needs this for never return
  }

  const apiUrl = apiUrlOverride ?? creds.apiUrl;
  return new ApiClient(apiUrl, creds.token);
}

// ── Login / Logout ──────────────────────────────────────────────────

/**
 * Handle the login command via the browser handshake.
 */
async function runLogin(apiUrlOverride?: string, appUrlOverride?: string): Promise<void> {
  const store = new CredentialStore();
  const apiUrl = apiUrlOverride ?? DEFAULT_API_URL;
  const appUrl = appUrlOverride ?? DEFAULT_APP_URL;

  // Browser flow: opens /cli-auth which exchanges existing session or starts OAuth
  output.info(`Authenticating with ${apiUrl}...`);

  const { authUrl, callbackPromise } = await handleLogin(apiUrl, appUrl, store);

  output.info("Opening browser for authentication...");
  output.dim(`If the browser does not open, visit:\n  ${authUrl}\n`);

  try {
    let opener: string | null;
    switch (process.platform) {
      case "darwin":
        opener = "open";
        break;
      case "linux":
        opener = "xdg-open";
        break;
      default:
        opener = null;
    }

    if (opener) {
      // Fire-and-forget: detach and ignore I/O so the browser launcher
      // doesn't tie up the CLI. Async failures surface on the error event.
      const child = spawn(opener, [authUrl], { stdio: "ignore", detached: true });
      child.on("error", () => {
        // Browser open failed — user can copy the URL manually.
      });
      child.unref();
    }
  } catch {
    // Browser open failed — user can copy the URL manually.
  }

  output.dim("Waiting for authentication callback...");
  const result = await callbackPromise;

  if (result.success) {
    try {
      const creds = await store.load();
      if (creds) {
        const client = new ApiClient(creds.apiUrl, creds.token);
        const user = await client.getMe();
        output.success(`Logged in as ${user.name} (${user.email})`);
      }
    } catch {
      output.success("Login successful! Token stored.");
    }
    if (result.warning) output.warn(result.warning);
  } else {
    output.error(result.error ?? "Login failed.", 1);
  }
}

/**
 * Handle the logout command, revoking an exact CLI API key when possible.
 */
async function runLogout(): Promise<void> {
  const result = await handleLogout(new CredentialStore());
  if (result.success) {
    output.success(result.message);
    return;
  }
  output.warn(result.warning);
  process.exitCode = 1;
}

// ── Main dispatcher ─────────────────────────────────────────────────

/**
 * Main CLI entry point — parses args, authenticates when needed,
 * and dispatches to the appropriate command handler.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Commands that don't require authentication
  switch (args.command) {
    case "help":
      renderHelp();
      return;
    case "version":
      console.log(VERSION);
      return;
    case "unknown":
      output.error(`Unknown command: ${args.unknown}`, 1);
      return;
    case "login":
      await runLogin(args.apiUrl, args.appUrl);
      return;
    case "logout":
      await runLogout();
      return;
  }

  // All remaining commands require authentication
  const client = await requireAuth(args.apiUrl);

  switch (args.command) {
    case "profile":
      await handleProfile(
        client,
        args.subcommand,
        args.subcommand === "search" || args.subcommand === "update"
          ? (args.positionals ?? [])
          : (args.userId ? [args.userId] : []),
        {
          json: args.json,
          linkedin: args.linkedin,
          github: args.github,
          twitter: args.twitter,
          details: args.details,
        },
      );
      return;
    case "intent":
      await handleIntent(client, args.subcommand, {
        intentId: args.intentId,
        intentContent: args.intentContent,
        archived: args.archived,
        limit: args.limit,
        json: args.json,
        targetId: args.targetId,
      });
      return;
    case "opportunity":
      await handleOpportunity(client, args.subcommand, {
        targetId: args.targetId,
        status: args.status,
        limit: args.limit,
        json: args.json,
        positionals: args.positionals,
        acknowledgeUptake: args.acknowledgeUptake,
      });
      return;
    case "negotiation":
      await handleNegotiation(client, args.subcommand, {
        targetId: args.targetId,
        limit: args.limit,
        since: args.since,
        json: args.json,
      });
      return;
    case "network":
      await handleNetwork(client, args.subcommand, args.positionals ?? [], {
        prompt: args.prompt,
        title: args.title,
        json: args.json,
      });
      return;
    case "conversation":
      await handleConversation(client, args.subcommand, args.positionals ?? [], {
        limit: args.limit,
        sessionId: args.sessionId,
        message: args.message,
        json: args.json,
      });
      return;
    case "contact":
      await handleContact(client, args.subcommand, args.positionals ?? [], {
        json: args.json,
        name: args.name,
        gmail: args.gmail,
      });
      return;
    case "scrape":
      await handleScrape(client, args.positionals ?? [], {
        json: args.json,
        objective: args.objective,
      });
      return;
    case "onboarding":
      await handleOnboarding(client, args.subcommand, { json: args.json });
      return;
    case "sync":
      await handleSync(client, { json: args.json });
      return;
  }
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  output.error(err instanceof Error ? err.message : String(err), 1);
});
