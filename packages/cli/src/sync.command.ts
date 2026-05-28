/**
 * Sync command handler for the Index CLI.
 *
 * Fetches profile, networks, intents, and contacts, then writes
 * the combined context to ~/.index/context.json (or stdout with --json).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ApiClient } from "./api.client";
import * as output from "./output";

/**
 * Sync all user context to a local file or stdout.
 *
 * @param client - Authenticated API client.
 * @param options - Options: json outputs to stdout instead of file.
 */
export async function handleSync(
  client: ApiClient,
  options: { json?: boolean },
): Promise<void> {
  if (!options.json) output.info("Syncing context...");

  const [profile, networks, intents, contacts] = await Promise.all([
    client.callTool("read_user_profiles", {}),
    client.callTool("read_networks", {}),
    client.callTool("read_intents", {}),
    client.callTool("list_contacts", {}),
  ]);

  const context = {
    syncedAt: new Date().toISOString(),
    profile: profile.success ? profile.data : null,
    networks: networks.success ? networks.data : null,
    intents: intents.success ? intents.data : null,
    contacts: contacts.success ? contacts.data : null,
  };

  if (options.json) {
    console.log(JSON.stringify(context));
    return;
  }

  const dir = join(homedir(), ".index");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "context.json"), JSON.stringify(context, null, 2), { mode: 0o600 });
  output.success("Context synced to ~/.index/context.json");
}
