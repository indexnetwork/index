/**
 * Opportunity command handlers for the Index CLI.
 *
 * Implements: list, show, accept, reject subcommands.
 * Follows the same handleX(client, subcommand, positionals, options)
 * pattern as network.command.ts and conversation.command.ts.
 */

import { ApiError, type ApiClient, type UptakeAcceptanceAdvisoryBody } from "./api.client";
import * as output from "./output";

const OPPORTUNITY_HELP = `
Usage:
  index opportunity list                        List your opportunities
  index opportunity list --status <s>           Filter by status (pending|accepted|rejected|expired)
  index opportunity list --limit <n>            Limit results
  index opportunity show <id>                   Show full opportunity details (accepts short ID)
  index opportunity accept <id>                 Accept an opportunity (accepts short ID)
  index opportunity accept <id> --acknowledge-uptake <id,id>  Continue after an uptake advisory
  index opportunity reject <id>                 Reject an opportunity (accepts short ID)
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
    acknowledgeUptake?: string[];
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
      await opportunityStatusUpdate(client, options.targetId, "accepted", options.json, options.acknowledgeUptake);
      return;

    case "reject":
      if (!options.targetId) {
        output.error("Missing opportunity ID. Usage: index opportunity reject <id>", 1);
        return;
      }
      await opportunityStatusUpdate(client, options.targetId, "rejected", options.json);
      return;


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
  acknowledgedUptakeQuestionIds?: string[],
): Promise<void> {
  // Resolve short ID to full UUID via REST read.
  const opportunity = await client.getOpportunity(id);
  if (status === "accepted") {
    try {
      const result = await client.updateOpportunityStatus(opportunity.id, "accepted", acknowledgedUptakeQuestionIds);
      if (json) { console.log(JSON.stringify(result)); return; }
      output.success("Opportunity accepted.");
    } catch (error) {
      const advisory = uptakeAdvisoryFromError(error);
      if (json && error instanceof ApiError) {
        console.log(JSON.stringify(error.response ?? { error: error.message }));
        return;
      }
      if (!advisory) throw error;
      output.heading("Questions before accepting");
      for (const question of advisory.advisory.questions) {
        console.log(`\n${question.title}`);
        console.log(question.prompt);
        for (const option of question.options) {
          console.log(`  - ${option.label}${option.description ? ` — ${option.description}` : ""}`);
        }
        output.dim(`  Question ID: ${question.id}`);
      }
      const ids = advisory.advisory.questions.map((question) => question.id).join(",");
      output.info(`Answer or dismiss these questions, then retry. To continue anyway, run:\n  index opportunity accept ${opportunity.id} --acknowledge-uptake ${ids}`);
    }
    return;
  }

  const result = await client.updateOpportunityStatus(opportunity.id, "rejected");
  if (json) {
    console.log(JSON.stringify(result));
    return;
  }
  output.success("Opportunity rejected.");
}

function uptakeAdvisoryFromError(error: unknown): UptakeAcceptanceAdvisoryBody | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.response as Partial<UptakeAcceptanceAdvisoryBody> | undefined;
  return body?.advisory?.code === "unresolved_uptake_questions"
    ? body as UptakeAcceptanceAdvisoryBody
    : null;
}
