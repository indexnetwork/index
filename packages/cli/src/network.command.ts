/**
 * Network command handlers for the Index CLI.
 *
 * Implements: list, create, show, join, leave, invite subcommands.
 * All user-facing copy uses "network" terminology even though the
 * backend API uses /api/networks/*.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const NETWORK_HELP = `
Network Commands:
  index network list                     List your networks
  index network create <name>            Create a new network
  index network create <name> --prompt   Create with a description
  index network show <id|key>            Show network details and members
  index network update <id> [--title <t>] [--prompt <p>]
                                         Update a network
  index network delete <id>              Delete a network
  index network join <id|key>            Join a public network
  index network leave <id|key>           Leave a network
  index network invite <id|key> <email>  Invite a user by email
`;

/**
 * Route a network subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, create, show, join, leave, invite, update, delete).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (e.g. prompt, title, json).
 */
export async function handleNetwork(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options: { prompt?: string; title?: string; json?: boolean },
): Promise<void> {
  if (!subcommand) {
    console.log(NETWORK_HELP);
    return;
  }

  switch (subcommand) {
    case "list":
      await networkList(client, options.json);
      return;
    case "create":
      await networkCreate(client, positionals[0], options.prompt, options.json);
      return;
    case "show":
      await networkShow(client, positionals[0], options.json);
      return;
    case "join":
      await networkJoin(client, positionals[0], options.json);
      return;
    case "leave":
      await networkLeave(client, positionals[0], options.json);
      return;
    case "update":
      await networkUpdate(client, positionals[0], options, options.json);
      return;
    case "delete":
      await networkDelete(client, positionals[0], options.json);
      return;
    case "invite":
      await networkInvite(client, positionals[0], positionals[1], options.json);
      return;
    default:
      output.error(`Unknown network subcommand: ${subcommand}`, 1);
  }
}

/**
 * List networks the user is a member of, excluding personal indexes.
 */
async function networkList(client: ApiClient, json?: boolean): Promise<void> {
  const networks = await client.listNetworks();
  const filtered = networks.filter((n) => !n.isPersonal);

  if (json) {
    console.log(JSON.stringify(filtered));
    return;
  }
  output.heading("Networks");
  output.networkTable(filtered);
  console.log();
}

/**
 * Create a new network.
 */
async function networkCreate(client: ApiClient, name: string | undefined, prompt?: string, json?: boolean): Promise<void> {
  if (!name) {
    output.error("Usage: index network create <name>", 1);
    return;
  }

  const network = await client.createNetwork(name, prompt);
  if (json) {
    console.log(JSON.stringify(network));
    return;
  }
  output.success(`Network created: ${network.title}`);
  if (network.key) {
    output.dim(`  Key: ${network.key}`);
  }
  output.dim(`  ID: ${network.id}`);
  output.dim(`  Join Policy: ${(network.joinPolicy ?? "invite_only").replace("_", " ")}`);
}

/**
 * Show network details with members.
 */
async function networkShow(client: ApiClient, id: string | undefined, json?: boolean): Promise<void> {
  if (!id) {
    output.error("Usage: index network show <id>", 1);
    return;
  }

  const network = await client.getNetwork(id);
  const members = await client.getNetworkMembers(id);

  if (json) {
    console.log(JSON.stringify({ ...network, members }));
    return;
  }
  output.networkCard(network);
  output.heading("Members");
  output.memberTable(members);
  console.log();
}

/**
 * Join a public network.
 */
async function networkJoin(client: ApiClient, id: string | undefined, json?: boolean): Promise<void> {
  if (!id) {
    output.error("Usage: index network join <id>", 1);
    return;
  }

  const network = await client.joinNetwork(id);
  if (json) {
    console.log(JSON.stringify(network));
    return;
  }
  output.success(`Joined network: ${network.title}`);
}

/**
 * Leave a network.
 */
async function networkLeave(client: ApiClient, id: string | undefined, json?: boolean): Promise<void> {
  if (!id) {
    output.error("Usage: index network leave <id>", 1);
    return;
  }

  await client.leaveNetwork(id);
  if (json) {
    console.log(JSON.stringify({ id, left: true }));
    return;
  }
  output.success("Left network.");
}

/**
 * Update a network's title and/or prompt.
 */
async function networkUpdate(
  client: ApiClient,
  id: string | undefined,
  options: { title?: string; prompt?: string },
  json?: boolean,
): Promise<void> {
  if (!id) {
    output.error("Usage: index network update <id> [--title <t>] [--prompt <p>]", 1);
    return;
  }

  const settings: Record<string, unknown> = {};
  if (options.title) settings.title = options.title;
  if (options.prompt) settings.prompt = options.prompt;
  if (Object.keys(settings).length === 0) {
    output.error("Provide at least --title or --prompt. Usage: index network update <id> [--title <t>] [--prompt <p>]", 1);
    return;
  }

  const result = await client.callTool("update_index", { networkId: id, settings });
  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) {
    output.error(result.error ?? "Network update failed", 1);
    return;
  }
  output.success("Network updated.");
}

/**
 * Delete a network.
 */
async function networkDelete(client: ApiClient, id: string | undefined, json?: boolean): Promise<void> {
  if (!id) {
    output.error("Usage: index network delete <id>", 1);
    return;
  }

  const result = await client.callTool("delete_index", { networkId: id });
  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) {
    output.error(result.error ?? "Network deletion failed", 1);
    return;
  }
  output.success("Network deleted.");
}

/**
 * Invite a user to a network by email.
 */
async function networkInvite(
  client: ApiClient,
  id: string | undefined,
  email: string | undefined,
  json?: boolean,
): Promise<void> {
  if (!id || !email) {
    output.error("Usage: index network invite <id> <email>", 1);
    return;
  }

  const users = await client.searchUsers(email, id);
  if (users.length === 0) {
    output.error("User not found.");
    return;
  }

  const user = users[0];
  const result = await client.addNetworkMember(id, user.id);
  if (json) {
    console.log(JSON.stringify({ user, ...result }));
    return;
  }
  output.success(`Invited ${user.name} (${user.email}) to the network.`);
  if (result.message) {
    output.dim(`  ${result.message}`);
  }
}

