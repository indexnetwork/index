import { z } from 'zod';

import type { DefineTool, ResolvedToolContext, ToolDeps } from '../shared/agent/tool.helpers.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import type { NegotiatorVerdictInput, NegotiatorVerdictResult } from '../../platform/negotiation/verdict.js';

/**
 * Owner verdict tools on the MCP surface (`reject_opportunity` /
 * `accept_opportunity`, #1471 one surface over).
 *
 * `update_opportunity` cannot serve the verdict: it refuses a `negotiating`
 * pairing outright. These tools go through the verdict host instead: a numbered
 * counterparty mapping, the same Radar Skip/Start-Chat service call
 * underneath, and the same outcome hooks (question retirement, DM resolution,
 * contact memberships) in its wake.
 *
 * Admission is a SESSION-AUTHENTICATED principal (`context.isSessionAuth`,
 * bound by the host in mcp.server.ts) — never a caller-supplied field. The
 * capability matrix already hides these tools from every agent principal
 * (`human_only`); this handler check is the fail-closed second layer, so a
 * mis-listed surface still refuses. API-key agents are refused, deliberately:
 * a verdict is the owner's own gate, and the boundary is the feature.
 *
 * Positions, never ids — the host resolves the number against the same
 * oldest-first enumeration the DM prompt renders, and the executed result
 * names WHO the write landed on. An unknown number returns the current
 * numbered list rather than deciding anything.
 */

const logger = protocolLogger('McpTools:OpportunityVerdict');

const VerdictQuerySchema = z.object({
  intentId: z.string()
    .describe('The signal (intent id, from read_intents) whose counterparty the owner is deciding on.'),
  counterparty: z.number().int().min(1)
    .describe('Which counterparty, by 1-based position in the signal\'s actionable list (oldest pairing first). An out-of-range number returns the current numbered list without deciding anything.'),
  reason: z.string().min(1).max(500).optional()
    .describe('Why, in the owner\'s OWN words, if they gave a reason. For the record only — never invent or infer one.'),
});

/** One verdict's result copy, per host status — honest in the same way the chat lane is. */
function describeVerdict(verdict: 'rejected' | 'accepted', result: NegotiatorVerdictResult): string {
  switch (result.status) {
    case 'executed':
      return success({
        status: 'executed',
        counterparty: result.counterparty,
        message: verdict === 'rejected'
          ? `Done — the ${result.counterparty} pairing is declined; they will not be contacted further about it. Confirm that to the user, naming ${result.counterparty}. Do NOT also edit their signal.`
          : `Done — the ${result.counterparty} pairing is accepted on the user's behalf. That is one side of it: the connection is made when ${result.counterparty} accepts too, so say plainly that it now waits on them. Do NOT also edit their signal.`,
      });
    case 'none_actionable':
      return error('There is no counterparty left to decide on for this signal — they have concluded or expired. Tell the user that plainly rather than implying a decision was recorded.');
    case 'unknown_counterparty':
      return error(
        `That number does not name a counterparty of this signal; nothing was decided. The current list (${result.count}): `
        + result.actionable.map((label, index) => `${index + 1}. ${label}`).join('; ')
        + '. Call again with the right number, or ask the user which of them they meant.',
      );
    case 'already_decided':
      return error(`The user has already acted on the ${result.counterparty} pairing, so nothing changed just now. Say so plainly — for an accept, it is ${result.counterparty}'s move next, not theirs.`);
    case 'error':
    default:
      return error(`Could not record that ${verdict === 'rejected' ? 'rejection' : 'acceptance'}. Tell the user honestly that it did not go through, and do not describe the pairing as ${verdict}.`);
  }
}

/** Registers the MCP-surface owner verdict tools. */
export function createOpportunityVerdictTools(defineTool: DefineTool, deps: ToolDeps) {
  const run = async (
    verdict: 'rejected' | 'accepted',
    toolName: string,
    context: ResolvedToolContext,
    query: z.infer<typeof VerdictQuerySchema>,
    execute: (userId: string, input: NegotiatorVerdictInput) => Promise<NegotiatorVerdictResult>,
  ): Promise<string> => {
    try {
      // Fail-closed owner boundary: only a session-authenticated principal
      // admits a verdict. The capability matrix already refuses agent
      // principals; this refusal stands even if the tool is ever listed on a
      // surface without it.
      if (context.agentId || context.isSessionAuth !== true) {
        return error('Owner verdicts require the owner\'s own authenticated session. This principal cannot pass one.');
      }
      const result = await execute(context.userId, {
        intentId: query.intentId,
        counterparty: query.counterparty,
        ...(query.reason ? { reason: query.reason } : {}),
      });
      return describeVerdict(verdict, result);
    } catch (err) {
      logger.error('MCP owner verdict failed', { toolName, err });
      return describeVerdict(verdict, { status: 'error' });
    }
  };

  const rejectOpportunity = defineTool({
    name: 'reject_opportunity',
    description:
      'Decline one of a signal\'s counterparties, because the user (the signal\'s owner, in their own authenticated session) told you to. ' +
      'This is the ONLY tool that declines a live or parked pairing — `update_opportunity` refuses a `negotiating` one, and saying it does nothing. ' +
      'It executes the same owner reject the Radar card\'s Skip performs, so the pairing\'s open question retires with it.\n\n' +
      '**Access:** owner session only. Agent principals cannot pass owner verdicts; this tool is absent from their inventory and refused if called.\n\n' +
      '**Never on your own judgment** — only on the user\'s explicit instruction about a specific counterparty.',
    querySchema: VerdictQuerySchema,
    handler: async ({ context, query }) => {
      const host = deps.negotiatorVerdictTools;
      if (!host) return error('The verdict lane is not available on this deployment.');
      return run('rejected', 'reject_opportunity', context, query, (userId, input) => host.rejectOpportunity(userId, input));
    },
  });

  const acceptOpportunity = defineTool({
    name: 'accept_opportunity',
    description:
      'Accept one of a signal\'s counterparties on the user\'s (the owner\'s) explicit instruction, from their own authenticated session. ' +
      'This records the owner\'s acceptance — one side of a two-party decision: the connection is made only when the counterparty accepts too, ' +
      'so never say they are connected on the strength of this alone.\n\n' +
      '**Access:** owner session only. Agent principals cannot pass owner verdicts; this tool is absent from their inventory and refused if called.\n\n' +
      '**Never on your own judgment** — only on the user\'s explicit instruction about a specific counterparty.',
    querySchema: VerdictQuerySchema,
    handler: async ({ context, query }) => {
      const host = deps.negotiatorVerdictTools;
      if (!host) return error('The verdict lane is not available on this deployment.');
      return run('accepted', 'accept_opportunity', context, query, (userId, input) => host.acceptOpportunity(userId, input));
    },
  });

  return [rejectOpportunity, acceptOpportunity] as const;
}
