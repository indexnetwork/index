/**
 * Intent (signal) command handlers for the Index CLI.
 *
 * Implements: list, show, create, archive subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const INTENT_HELP = `
Usage:
  index intent list [--archived] [--limit <n>]  List your signals
  index intent show <id>                        Show signal details (accepts short ID)
  index intent create <content>                 Create a signal from text
  index intent update <id> <content>            Update a signal's description
  index intent archive <id>                     Archive a signal (accepts short ID)
  index intent add-to-network <id> <network-id>      Add a signal to a network
  index intent remove-from-network <id> <network-id> Remove a signal from a network
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
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      output.heading("Signals");
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
        output.error("Missing signal ID. Usage: index intent show <id>", 1);
        return;
      }
      const intent = await client.getIntent(options.intentId);
      if (options.json) { console.log(JSON.stringify(intent)); return; }
      output.intentCard(intent);
      return;
    }

    case "create": {
      if (!options.intentContent) {
        output.error("Missing content. Usage: index intent create <content>", 1);
        return;
      }
      if (!options.json) output.info("Processing signal...");
      const result = await client.callTool("create_intent", {
        description: options.intentContent,
        ...(options.targetId ? { networkIds: [options.targetId] } : {}),
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to create signal", 1); return; }

      const created = (result.data as { intents?: Array<{ description?: string }> })?.intents ?? [];
      output.success("Signal created.");
      for (const intent of created) {
        if (intent.description) output.dim(`  ${intent.description}`);
      }
      return;
    }

    case "update": {
      if (!options.intentId) {
        output.error("Missing signal ID. Usage: index intent update <id> <content>", 1);
        return;
      }
      if (!options.intentContent) {
        output.error("Missing content. Usage: index intent update <id> <content>", 1);
        return;
      }
      if (!options.json) output.info("Updating signal...");
      const result = await client.updateIntent(options.intentId, options.intentContent);
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to update signal", 1); return; }
      output.success("Signal updated.");
      return;
    }

    case "archive": {
      if (!options.intentId) {
        output.error("Missing signal ID. Usage: index intent archive <id>", 1);
        return;
      }
      // Resolve short ID to full UUID via REST read
      const intent = await client.getIntent(options.intentId);
      const result = await client.callTool("delete_intent", { intentId: intent.id });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to archive signal", 1); return; }
      output.success(`Signal ${options.intentId} archived.`);
      return;
    }

    case "add-to-network": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent add-to-network <intent-id> <network-id>", 1);
        return;
      }
      // Resolve short ID to full UUID — the tool rejects non-UUID intent IDs.
      const intent = await client.getIntent(options.intentId);
      const result = await client.callTool("add_intent_to_network", {
        intentId: intent.id,
        networkId: options.targetId,
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to add signal to network", 1); return; }
      output.success("Signal added to network.");
      return;
    }

    case "remove-from-network": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent remove-from-network <intent-id> <network-id>", 1);
        return;
      }
      // Resolve short ID to full UUID — the tool rejects non-UUID intent IDs.
      const intent = await client.getIntent(options.intentId);
      const result = await client.callTool("remove_intent_from_network", {
        intentId: intent.id,
        networkId: options.targetId,
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to remove signal from network", 1); return; }
      output.success("Signal removed from network.");
      return;
    }
  }
}
