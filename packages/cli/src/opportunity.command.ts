/**
 * Opportunity command handlers for the Index CLI.
 *
 * Implements: list, show, accept, reject subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import type { ApiClient } from "./api.client";
import * as output from "./output";

const OPPORTUNITY_HELP = `
Usage:
  index opportunity list                        List your opportunities
  index opportunity list --status <s>           Filter by status (pending|accepted|rejected|expired)
  index opportunity list --limit <n>            Limit results
  index opportunity show <id>                   Show full opportunity details (accepts short ID)
  index opportunity accept <id>                 Accept an opportunity (accepts short ID)
  index opportunity reject <id>                 Reject an opportunity (accepts short ID)
  index opportunity discover <query>            Discover opportunities by search query
  index opportunity discover --target <uid> <q> Discover for a specific user
  index opportunity discover --introduce <a> <b> Introduce two users
`;

/**
 * Route an opportunity subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, show, accept, reject).
 * @param options - Additional options (targetId, status, limit, json).
 */
export async function handleOpportunity(
  client: ApiClient,
  subcommand: string | undefined,
  options: {
    targetId?: string;
    status?: string;
    limit?: number;
    json?: boolean;
    positionals?: string[];
    target?: string;
    introduce?: string;
  },
): Promise<void> {
  if (!subcommand) {
    if (options.json) {
      console.log(JSON.stringify({ error: "No subcommand provided" }));
    } else {
      console.log(OPPORTUNITY_HELP);
    }
    return;
  }

  switch (subcommand) {
    case "list":
      await opportunityList(client, options.status, options.limit, options.json);
      return;

    case "show":
      if (!options.targetId) {
        output.error("Missing opportunity ID. Usage: index opportunity show <id>", 1);
        return;
      }
      await opportunityShow(client, options.targetId, options.json);
      return;

    case "accept":
      if (!options.targetId) {
        output.error("Missing opportunity ID. Usage: index opportunity accept <id>", 1);
        return;
      }
      await opportunityStatusUpdate(client, options.targetId, "accepted", options.json);
      return;

    case "reject":
      if (!options.targetId) {
        output.error("Missing opportunity ID. Usage: index opportunity reject <id>", 1);
        return;
      }
      await opportunityStatusUpdate(client, options.targetId, "rejected", options.json);
      return;

    case "discover": {
      const query = options.positionals?.join(" ");
      if (!query && !options.introduce) {
        output.error("Usage: index opportunity discover <query>", 1);
        return;
      }
      if (options.introduce) {
        const userA = options.introduce;
        const userB = options.positionals?.[0];
        if (!userB) {
          output.error("Usage: index opportunity discover --introduce <userA> <userB>", 1);
          return;
        }
        // Remaining positionals after userB serve as a hint for the introduction
        const hint = options.positionals?.slice(1).join(" ") || undefined;
        await discoverIntroduction(client, userA, userB, hint, options.json);
      } else if (options.target) {
        if (!options.json) output.info("Discovering opportunities...");
        const result = await client.callTool("create_opportunities", {
          targetUserId: options.target,
          searchQuery: query,
        });
        if (options.json) { console.log(JSON.stringify(result)); return; }
        if (!result.success) { output.error(result.error ?? "Discovery failed", 1); return; }
        output.success("Discovery complete.");
        const data = result.data as { message?: string };
        if (data?.message) output.dim(`  ${data.message}`);
      } else {
        if (!options.json) output.info("Discovering opportunities...");
        const result = await client.callTool("create_opportunities", { searchQuery: query });
        if (options.json) { console.log(JSON.stringify(result)); return; }
        if (!result.success) { output.error(result.error ?? "Discovery failed", 1); return; }
        output.success("Discovery complete.");
        const data = result.data as { message?: string };
        if (data?.message) output.dim(`  ${data.message}`);
      }
      return;
    }

    default:
      output.error(`Unknown subcommand: ${subcommand}`, 1);
      return;
  }
}

/**
 * List opportunities with optional filters.
 */
async function opportunityList(
  client: ApiClient,
  status?: string,
  limit?: number,
  json?: boolean,
): Promise<void> {
  const opportunities = await client.listOpportunities({ status, limit });
  if (json) { console.log(JSON.stringify(opportunities)); return; }
  output.heading("Opportunities");
  output.opportunityTable(opportunities);
  console.log();
}

/**
 * Show detailed information for a single opportunity.
 */
async function opportunityShow(client: ApiClient, id: string, json?: boolean): Promise<void> {
  const opportunity = await client.getOpportunity(id);
  if (json) { console.log(JSON.stringify(opportunity)); return; }
  output.opportunityCard(opportunity);
}

/**
 * Update an opportunity's status (accept/reject).
 */
async function opportunityStatusUpdate(
  client: ApiClient,
  id: string,
  status: "accepted" | "rejected",
  json?: boolean,
): Promise<void> {
  // Resolve short ID to full UUID via REST read
  const opportunity = await client.getOpportunity(id);
  const result = await client.callTool("update_opportunity", {
    opportunityId: opportunity.id,
    status,
  });
  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) { output.error(result.error ?? `Failed to ${status === "accepted" ? "accept" : "reject"} opportunity`, 1); return; }
  output.success(`Opportunity ${status === "accepted" ? "accepted" : "rejected"}.`);
}

/**
 * Gather profiles and intents for two users, find a shared index,
 * then call create_opportunities in introduction mode.
 */
async function discoverIntroduction(
  client: ApiClient,
  userA: string,
  userB: string,
  hint?: string,
  json?: boolean,
): Promise<void> {
  if (!json) output.info("Gathering data for introduction...");

  // Step 1: Find shared indexes between the two users
  const [membershipsA, membershipsB] = await Promise.all([
    client.callTool("read_network_memberships", { userId: userA }),
    client.callTool("read_network_memberships", { userId: userB }),
  ]);

  if (!membershipsA.success || !membershipsB.success) {
    const err = membershipsA.error ?? membershipsB.error ?? "Failed to read memberships";
    if (json) { console.log(JSON.stringify({ success: false, error: err })); return; }
    output.error(err, 1);
    return;
  }

  const networksA = ((membershipsA.data?.memberships ?? membershipsA.data?.networks) as Array<{ networkId: string }>) ?? [];
  const networksB = ((membershipsB.data?.memberships ?? membershipsB.data?.networks) as Array<{ networkId: string }>) ?? [];
  const idsA = new Set(networksA.map((m) => m.networkId));
  const shared = networksB.filter((m) => idsA.has(m.networkId));

  if (shared.length === 0) {
    const err = "No shared networks found between these users. They must be members of at least one common network.";
    if (json) { console.log(JSON.stringify({ success: false, error: err })); return; }
    output.error(err, 1);
    return;
  }

  const sharedNetworkId = shared[0].networkId;
  if (!json) output.dim(`  Found shared network: ${sharedNetworkId}`);

  // Step 2: Gather profiles and intents in parallel
  const [profileA, profileB, intentsA, intentsB] = await Promise.all([
    client.callTool("read_user_profiles", { userId: userA }),
    client.callTool("read_user_profiles", { userId: userB }),
    client.callTool("read_intents", { userId: userA, networkId: sharedNetworkId }),
    client.callTool("read_intents", { userId: userB, networkId: sharedNetworkId }),
  ]);

  const gatherError =
    profileA.error ??
    profileB.error ??
    intentsA.error ??
    intentsB.error;

  if (!profileA.success || !profileB.success || !intentsA.success || !intentsB.success) {
    const err = gatherError ?? "Failed to gather profiles and intents for introduction.";
    if (json) { console.log(JSON.stringify({ success: false, error: err })); return; }
    output.error(err, 1);
    return;
  }

  const extractProfile = (result: { success: boolean; data?: Record<string, unknown> }) => {
    if (!result.success || !result.data) return undefined;
    // Single-user profile response has a profile object at top level or nested
    const d = result.data as Record<string, unknown>;
    if (d.profile) return d.profile as Record<string, unknown>;
    // Multi-profile response (from query mode) — take first
    const profiles = d.profiles as Array<{ profile?: Record<string, unknown> }> | undefined;
    return profiles?.[0]?.profile;
  };

  const extractIntents = (result: { success: boolean; data?: Record<string, unknown> }) => {
    if (!result.success || !result.data) return undefined;
    const d = result.data as Record<string, unknown>;
    return (d.intents as Array<{ intentId?: string; id?: string; payload: string; summary?: string }> | undefined)
      ?.map((i) => ({ intentId: i.intentId ?? i.id ?? "", payload: i.payload, summary: i.summary }));
  };

  const entities = [
    { userId: userA, profile: extractProfile(profileA), intents: extractIntents(intentsA), networkId: sharedNetworkId },
    { userId: userB, profile: extractProfile(profileB), intents: extractIntents(intentsB), networkId: sharedNetworkId },
  ];

  if (!json) output.dim("  Profiles and intents gathered. Creating introduction...");

  // Step 3: Call create_opportunities with full entity data
  const result = await client.callTool("create_opportunities", {
    partyUserIds: [userA, userB],
    entities,
    ...(hint ? { hint } : {}),
  });

  if (json) { console.log(JSON.stringify(result)); return; }
  if (!result.success) { output.error(result.error ?? "Introduction failed", 1); return; }
  output.success("Introduction created.");
  const data = result.data as { message?: string };
  if (data?.message) output.dim(`  ${data.message}`);
}
