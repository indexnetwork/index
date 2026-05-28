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
  index intent link <id> <network-id>           Link a signal to a network
  index intent unlink <id> <network-id>         Unlink a signal from a network
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
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to create signal", 1); return; }

      // `create_intent` returns a proposal (for interactive approval), not a
      // persisted intent. Confirm it so the CLI actually creates the signal.
      const proposals = parseIntentProposals((result.data as { message?: string })?.message);
      if (proposals.length === 0) {
        output.error("Signal proposal could not be parsed from the response.", 1);
        return;
      }
      for (const proposal of proposals) {
        await client.confirmIntent(proposal.proposalId, proposal.description);
        output.success("Signal created.");
        output.dim(`  ${proposal.description}`);
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
      const result = await client.callTool("update_intent", {
        intentId: options.intentId,
        newDescription: options.intentContent,
      });
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

    case "link": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent link <intent-id> <network-id>", 1);
        return;
      }
      // Resolve short ID to full UUID — the tool rejects non-UUID intent IDs.
      const intent = await client.getIntent(options.intentId);
      const result = await client.callTool("create_intent_index", {
        intentId: intent.id,
        networkId: options.targetId,
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to link signal", 1); return; }
      output.success("Signal linked to network.");
      return;
    }

    case "unlink": {
      if (!options.intentId || !options.targetId) {
        output.error("Usage: index intent unlink <intent-id> <network-id>", 1);
        return;
      }
      // Resolve short ID to full UUID — the tool rejects non-UUID intent IDs.
      const intent = await client.getIntent(options.intentId);
      const result = await client.callTool("delete_intent_index", {
        intentId: intent.id,
        networkId: options.targetId,
      });
      if (options.json) { console.log(JSON.stringify(result)); return; }
      if (!result.success) { output.error(result.error ?? "Failed to unlink signal", 1); return; }
      output.success("Signal unlinked from network.");
      return;
    }
  }
}

/**
 * Extract intent proposals from a `create_intent` tool message.
 *
 * The tool embeds one or more ```intent_proposal fenced JSON blocks (each with
 * a `proposalId` and `description`) in its message. This pulls them out so the
 * CLI can confirm them into real signals.
 *
 * @param message - The `message` field of the create_intent tool result.
 * @returns Parsed proposals (empty if none found).
 */
function parseIntentProposals(
  message: string | undefined,
): Array<{ proposalId: string; description: string }> {
  if (!message) return [];
  const proposals: Array<{ proposalId: string; description: string }> = [];
  const blockRegex = /```intent_proposal\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(message)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { proposalId?: string; description?: string };
      if (parsed.proposalId && parsed.description) {
        proposals.push({ proposalId: parsed.proposalId, description: parsed.description });
      }
    } catch {
      // Skip blocks whose body is not valid JSON.
    }
  }
  return proposals;
}
