/**
 * Intent command handlers for the Index CLI.
 *
 * Implements: list, show, create, archive subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const INTENT_HELP = `
Usage:
  index intent list [--archived] [--limit <n>] [--query <text>]  List your intents
  index intent show <id>                        Show intent details (accepts short ID)
  index intent prepare <content> [--answer 'prompt=reply']  Review and repair a draft
  index intent create <content> [--receipt <token>]         Create an admitted intent
  index intent pause <id> | resume <id>         Hold or restart its agent
  index intent update <id> <content>            Update an intent's description
  index intent archive <id>                     Archive an intent (accepts short ID)
  index intent networks <id>                    List the networks an intent is shared in
  index intent add-to-network <id> <network-id>      Add an intent to a network
  index intent remove-from-network <id> <network-id> Remove an intent from a network
`;

/**
 * Route an intent subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, show, create, archive).
 * @param options - Additional options (intentId, intentContent, archived, limit, json).
 */
export async function handleIntent(
  client: ApiClient,
  subcommand: string | undefined,
  options: {
    intentId?: string;
    intentContent?: string;
    archived?: boolean;
    limit?: number;
    json?: boolean;
    targetId?: string;
    query?: string;
    receipt?: string;
    answers?: { key: string; value: string }[];
  },
): Promise<void> {
  if (!subcommand) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No subcommand provided" }));
    } else {
      console.log(INTENT_HELP);
    }
    return;
  }

  switch (subcommand) {
    case "list": {
      const result = await client.listIntents({
        archived: options.archived,
        limit: options.limit,
        query: options.query,
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      output.heading("Intents");
      output.intentTable(result.intents);
      if (result.pagination.totalCount > 0) {
        output.dim(
          `\n  Page ${result.pagination.current} of ${result.pagination.total} (${result.pagination.totalCount} total)`,
        );
      }
      console.log();
      return;
    }

    case "show": {
      if (!options.intentId) {
        output.error("Missing intent ID. Usage: index intent show <id>", 1);
        return;
      }
      const intent = await client.getIntent(options.intentId);
      if (options.json) { console.log(JSON.stringify(intent)); return; }
      output.intentCard(intent);
      return;
    }

    case "prepare": {
      if (!options.intentContent) throw new Error("Usage: index intent prepare <content> [--answer 'prompt=reply']");
      const prepared = await client.prepareIntent(options.intentContent, (options.answers ?? []).map(({ key, value }) => ({ prompt: key, answer: value })));
      console.log(JSON.stringify(prepared, null, options.json ? undefined : 2));
      return;
    }

    case "create": {
      if (!options.intentContent) {
        output.error("Missing content. Usage: index intent create <content>", 1);
        return;
      }
      if (!options.json) output.info("Processing intent...");
      const result = await client.createIntent(
        options.intentContent,
        options.targetId ? [options.targetId] : undefined,
        options.receipt,
      );
      if (options.json) { console.log(JSON.stringify(result)); return; }
      output.success("Intent created.");
      output.dim(`  shared in ${result.networkIds.length} network${result.networkIds.length === 1 ? "" : "s"}`);
      return;
    }

    case "update": {
      if (!options.intentId) {
        output.error("Missing intent ID. Usage: index intent update <id> <content>", 1);
        return;
      }
      if (!options.intentContent) {
        output.error("Missing content. Usage: index intent update <id> <content>", 1);
        return;
      }
      if (!options.json) output.info("Updating intent...");
      const result = await client.updateIntent(options.intentId, options.intentContent);
      if (options.json) { console.log(JSON.stringify(result)); return; }
      output.success("Intent updated.");
      return;
    }

    case "pause":
    case "resume": {
      if (!options.intentId) throw new Error(`Usage: index intent ${subcommand} <id>`);
      const status = subcommand === "pause" ? "PAUSED" : "ACTIVE";
      await client.updateIntentStatus(options.intentId, status);
      if (options.json) console.log(JSON.stringify({ intentId: options.intentId, status }));
      else output.success(`Intent ${status.toLowerCase()}.`);
      return;
    }

    case "archive": {
      if (!options.intentId) {
        output.error("Missing intent ID. Usage: index intent archive <id>", 1);
        return;
      }
      await client.archiveIntent(options.intentId);
      if (options.json) { console.log(JSON.stringify({ success: true })); return; }
      output.success(`Intent ${options.intentId} archived.`);
      return;
    }

    case "networks": {
      if (!options.intentId) {
        output.error("Usage: index intent networks <intent-id>", 1);
        return;
      }
      const networkIds = await client.listIntentNetworks(options.intentId);
      if (options.json) { console.log(JSON.stringify({ networkIds })); return; }
      output.heading("Networks");
      for (const networkId of networkIds) output.dim(`  ${networkId}`);
      console.log();
      return;
    }

    case "add-to-network": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent add-to-network <intent-id> <network-id>", 1);
        return;
      }
      await client.addIntentToNetwork(options.intentId, options.targetId);
      if (options.json) { console.log(JSON.stringify({ success: true })); return; }
      output.success("Intent added to network.");
      return;
    }

    case "remove-from-network": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent remove-from-network <intent-id> <network-id>", 1);
        return;
      }
      await client.removeIntentFromNetwork(options.intentId, options.targetId);
      if (options.json) { console.log(JSON.stringify({ success: true })); return; }
      output.success("Intent removed from network.");
      return;
    }
  }
}
