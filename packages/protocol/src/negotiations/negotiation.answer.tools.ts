import { z } from 'zod';

import type { DefineTool } from '../shared/agent/tool.helpers.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { focusedNetworkId } from '../shared/agent/tool.scope.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import type { NegotiationToolDeps } from './negotiation.tools.port.js';

/**
 * The MCP-surface answer lane (`answer_pending_question`).
 *
 * `list_negotiations` and `get_negotiation` have said the park since #1472:
 * "open question 3, 'Timing'" — to a client that, on this surface, had no tool
 * to answer it. This closes the read-and-act gap over the EXISTING host
 * (`NegotiatorAnswerToolsHost`): same `readOpenQuestionsForIntent` numbering,
 * same serialized consumption queue, same #1432 resume spine underneath.
 * Nothing is re-implemented.
 *
 * MCP has no pinned intent, so the tool resolves its scope from the
 * negotiation the client is looking at: `negotiationId` (the id the listing
 * and detail hand out next to the park) → the caller's own actor intent on
 * that negotiation's opportunity → the host. The `question` number passes
 * through untouched — it is the number the park annotation printed, and both
 * come from the same enumeration, so they cannot drift.
 *
 * Registered on the MCP surface only (tool.registry): the chat lane is the
 * persona-append tool (#1466) and the REST Tool API deliberately does not
 * carry this. Access is decided by the capability matrix
 * (`CANONICAL_MCP_TOOL_ACCESS_RULES`); the handler enforces the rest —
 * participant admission here, recipient-side scoping in the host (a question
 * parked on the counterparty never enumerates for this caller).
 */

const logger = protocolLogger('McpTools:NegotiationAnswer');

const SCOPE_DENIAL = 'Access denied: this negotiation is not in your bound network scope.';

/** Registers the MCP-surface `answer_pending_question` tool. */
export function createNegotiationAnswerTools(defineTool: DefineTool, deps: NegotiationToolDeps) {
  const { negotiationDatabase } = deps;

  const answerPendingQuestion = defineTool({
    name: 'answer_pending_question',
    description:
      'Route the user\'s answer to the open question a PARKED negotiation is waiting on, resuming it. This is the ONLY thing ' +
      'that resumes a parked negotiation — responding, editing the signal, or updating the opportunity does not.\n\n' +
      '**When to use:** `list_negotiations` / `get_negotiation` showed a `park` with `waitingOn: "you"` and a `question` number, ' +
      'and the user has answered that question. Pass the negotiation\'s id, the exact `park.question` number, and the user\'s answer ' +
      'in their own words. Never invent an answer, and never add a preference or constraint the user did not state.\n\n' +
      '**Numbering:** the `question` number and the number shown in the park annotation come from the same open-question record, ' +
      'so pass the number exactly as shown. If it no longer names an open question you will get `unknown_question` with the current count — ' +
      're-read the listing rather than guessing.\n\n' +
      '**One answer, every negotiation it unparks:** a question can unblock several parked negotiations; the host resumes them all from one answer.',
    querySchema: z.object({
      negotiationId: z.string()
        .describe('The parked negotiation\'s task id, from list_negotiations or get_negotiation.'),
      question: z.number().int().min(1)
        .describe('Which open question is being answered — the `park.question` number exactly as the listing or detail showed it.'),
      answer: z.string().min(1).max(4000)
        .describe('The user\'s answer, in their own words, restated only enough to stand alone.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const host = deps.negotiatorAnswerTools;
        if (!host) {
          return error('The answer lane is not available on this deployment. Tell the user honestly that the answer was not routed.');
        }

        const task = await negotiationDatabase.getTask(query.negotiationId);
        if (!task) {
          return error('Negotiation not found.');
        }
        const meta = task.metadata as {
          type?: string;
          sourceUserId?: string;
          candidateUserId?: string;
          opportunityId?: string;
          networkId?: string;
          turnContext?: { indexContext?: { networkId?: string } };
        } | null;
        if (meta?.type !== 'negotiation') {
          return error('Negotiation not found.');
        }

        // Network-scope check (mirrors get_negotiation): a network-bound agent
        // must not act on negotiations outside its bound network. Run before
        // the participant check so no existence-vs-membership signal leaks.
        const scopedNetworkId = focusedNetworkId(context);
        if (scopedNetworkId) {
          const metaNetworkId = typeof meta.networkId === 'string' && meta.networkId.trim()
            ? meta.networkId
            : meta.turnContext?.indexContext?.networkId ?? null;
          if (metaNetworkId !== scopedNetworkId) {
            return error(SCOPE_DENIAL);
          }
        }

        const isParty = meta.sourceUserId === context.userId || meta.candidateUserId === context.userId;
        if (!isParty) {
          return error('Access denied: you are not a party to this negotiation.');
        }

        const opportunityId = typeof meta.opportunityId === 'string' ? meta.opportunityId.trim() : '';
        if (!opportunityId) {
          return error('This negotiation carries no opportunity, so it has no question to answer.');
        }

        // The caller's own actor intent on this pairing — the signal whose
        // open-question block the number indexes into. A caller who is not the
        // question's recipient resolves no open question through the host and
        // gets `no_open_question`/`unknown_question`, never a resume.
        const intentIds = await negotiationDatabase.getIntentIdsForOpportunities([opportunityId], context.userId);
        const intentId = intentIds[opportunityId];
        if (!intentId) {
          return error('Could not resolve your signal for this negotiation, so the answer was not routed.');
        }

        const result = await host.answerOpenQuestion(context.userId, {
          intentId,
          question: query.question,
          answer: query.answer,
        });

        switch (result.status) {
          case 'routed':
            return success({
              status: 'routed',
              negotiationId: task.id,
              question: result.label,
              message:
                'The answer is on its way to the negotiation that was waiting on it. Confirm to the user in one short sentence '
                + 'what you took as their answer, and do not also change their signal on the strength of it.',
            });
          case 'no_open_question':
            return error(
              'Nothing is waiting on the user for this signal any more — the parked negotiations resolved or expired. '
              + 'Tell them that plainly rather than implying their answer was recorded.',
            );
          case 'unknown_question':
            return error(
              `That number does not name an open question (${result.open} currently open). `
              + 'Re-read the park annotations from list_negotiations and call this again with the number shown there.',
            );
          case 'error':
          default:
            return error('Could not route that answer. Tell the user honestly that it did not go through.');
        }
      } catch (err) {
        logger.error('Failed to route MCP pending-question answer', { err });
        return error('Could not route that answer. Tell the user honestly that it did not go through.');
      }
    },
  });

  return [answerPendingQuestion] as const;
}
