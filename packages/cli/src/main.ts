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
import { ApiClient, ApiError } from "./api.client";
import { handleLogin } from "./login.command";
import { handleLogout } from "./logout.command";
import { handleProfile } from "./profile.command";
import { handleIntent } from "./intent.command";
import { handleOpportunity } from "./opportunity.command";
import { handleNegotiation } from "./negotiation.command";
import { handleNetwork } from "./network.command";
import { handleConversation } from "./conversation.command";
import { handleScrape } from "./scrape.command";
import { handleSync } from "./sync.command";
import { handleTool } from "./tool.command";
import { handleOnboarding } from "./onboarding.command";
import * as output from "./output";

const DEFAULT_API_URL = "https://protocol.index.network";
const DEFAULT_APP_URL = "https://index.network";
const VERSION = packageJson.version;

/** Print current commands as text or one machine-readable help result. */
function renderHelp(json?: boolean): void {
  const help = `Usage: index <command> [args] [options]

  login [--app-url <url>]             Authenticate through the browser
  logout                             Revoke and clear the stored session
  tool list                          Discover tools and their JSON schemas
  tool call <name> --query '<json>'   Invoke a tool with a JSON object
  agent me                           Read your selected personal agent
  profile [show <user-id>|sync]       Read profiles or research public prefill
  intent list|show|create|update|archive|add-to-network|remove-from-network
  network list|show|create|update|delete|join|leave|invite
  opportunity list|show|accept|reject
  negotiation list [--intent-id <id>] [--state open|settled]
  negotiation show <opportunity-id>
  negotiation turn <opportunity-id> --action propose|counter|accept|decline
      --message <text> --expected-turn-count <n>
  conversation list|with|show|send|stream
  conversation show agent --intent-id <id>
  conversation send agent <text> --intent-id <id> [--question-id <id>]
  onboarding confirm-profile
  onboarding complete [--intent-id <id>]
  scrape <url> [--objective <text>]
  sync                               Download profile, networks, and intents

Global options: --api-url <origin>, --json, --help, --version
List options: --archived (intents), --status (opportunities), --limit <n>
Network options: --prompt <text> (create), --title <text> (update)

Auth: INDEX_SESSION_TOKEN or INDEX_API_KEY, otherwise stored browser login.
API origin: --api-url, INDEX_API_URL, stored login URL, production default.
--json emits one result/error; conversation stream emits NDJSON events.`;
  console.log(json ? JSON.stringify({ version: VERSION, help }) : `Index CLI ${VERSION}\n\n${help}`);
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

  const session = process.env.INDEX_SESSION_TOKEN || undefined;
  const apiKey = process.env.INDEX_API_KEY || undefined;
  if (session && apiKey) throw new Error("Set only one of INDEX_SESSION_TOKEN and INDEX_API_KEY");
  const token = session ?? apiKey ?? creds?.token;
  if (!token) throw new Error("Not logged in. Run `index login` or set INDEX_SESSION_TOKEN or INDEX_API_KEY.");
  const apiUrl = apiUrlOverride ?? process.env.INDEX_API_URL ?? creds?.apiUrl ?? DEFAULT_API_URL;
  return new ApiClient(apiUrl, token, apiKey ? "apiKey" : "session");
}

// ── Login / Logout ──────────────────────────────────────────────────

/**
 * Handle the login command via the browser handshake.
 */
async function runLogin(apiUrlOverride?: string, appUrlOverride?: string, json?: boolean): Promise<void> {
  const store = new CredentialStore();
  const apiUrl = apiUrlOverride ?? process.env.INDEX_API_URL ?? (await store.load())?.apiUrl ?? DEFAULT_API_URL;
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

  if (json) {
    if (!result.success) throw new Error(result.error ?? "Login failed.");
    console.log(JSON.stringify(result));
    return;
  }
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
async function runLogout(json?: boolean): Promise<void> {
  const result = await handleLogout(new CredentialStore());
  if (json) {
    console.log(JSON.stringify(result));
    if (!result.success) process.exitCode = 1;
    return;
  }
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
      renderHelp(args.json);
      return;
    case "version":
      console.log(args.json ? JSON.stringify({ version: VERSION }) : VERSION);
      return;
    case "unknown":
      output.error(`Unknown command: ${args.unknown}`, 1);
      return;
    case "login":
      await runLogin(args.apiUrl, args.appUrl, args.json);
      return;
    case "logout":
      await runLogout(args.json);
      return;
  }

  // All remaining commands require authentication
  const client = await requireAuth(args.apiUrl);

  switch (args.command) {
    case "tool":
      await handleTool(client, args.subcommand, args.positionals?.[0], args.query, args.json);
      return;
    case "agent":
      if (args.subcommand !== "me") throw new Error("Usage: index agent me");
      console.log(JSON.stringify(await client.getAgent(), null, args.json ? undefined : 2));
      return;
    case "profile":
      await handleProfile(
        client,
        args.subcommand,
        args.subcommand === "search" || args.subcommand === "update"
          ? (args.positionals ?? [])
          : (args.userId ? [args.userId] : []),
        {
          json: args.json,
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
      });
      return;
    case "negotiation":
      await handleNegotiation(client, args.subcommand, {
        targetId: args.targetId,
        intentId: args.intentId,
        state: args.state,
        action: args.action,
        message: args.message,
        expectedTurnCount: args.expectedTurnCount,
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
        json: args.json,
        intentId: args.intentId,
        questionId: args.questionId,
      });
      return;
    case "scrape":
      await handleScrape(client, args.positionals ?? [], {
        json: args.json,
        objective: args.objective,
      });
      return;
    case "onboarding":
      await handleOnboarding(client, args.subcommand, { json: args.json, intentId: args.intentId });
      return;
    case "sync":
      await handleSync(client, { json: args.json });
      return;
  }
}

// ── Run ──────────────────────────────────────────────────────────────

main().catch((err) => {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(err instanceof ApiError
      ? { error: err.message, status: err.status, response: err.response }
      : { error: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  } else output.error(err instanceof Error ? err.message : String(err), 1);
});
