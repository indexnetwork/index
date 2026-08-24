import { z } from 'zod';

import type { DefineTool } from '../shared/agent/tool.helpers.js';
import type { NegotiationToolDeps } from './negotiation.tools.port.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { focusedIntentId, focusedNetworkId } from '../shared/agent/tool.scope.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { buildLifecycleNarration, parkLifecycleLabel } from './negotiation.lifecycle-narration.js';
import { NegotiationTurnSchema, NEGOTIATION_CONTINUE_VERBS } from './negotiation.turn.js';
import type { NegotiationTaskMetadata, NegotiationTaskRow } from '../../platform/database/negotiation.js';

export { buildLifecycleNarration, parkLifecycleLabel } from './negotiation.lifecycle-narration.js';

const logger = protocolLogger('ChatTools:Negotiation');

/** The pause payload is private to `pausedBy` — every other reader sees the reason only. */
function pauseFor(task: NegotiationTaskRow, viewerId: string): (NegotiationTaskMetadata['pause'] & { label: string }) | undefined {
  if (task.state !== 'paused' || !task.metadata.pause) return undefined;
  const { reason, payload, pausedBy } = task.metadata.pause;
  const visible = pausedBy === viewerId ? { reason, payload, pausedBy } : { reason };
  return { ...visible, label: parkLifecycleLabel(task.metadata.pause) };
}

/**
 * Creates negotiation MCP tools for external agent access.
 *
 * Every write goes through the negotiation graph — this file never persists a
 * turn or a status change itself.
 */
export function createNegotiationTools(defineTool: DefineTool, deps: NegotiationToolDeps) {
  const { negotiationDatabase, negotiationGraph } = deps;

  function turnsOf(task: NegotiationTaskRow, messages: Array<{ senderId: string; parts: unknown[]; createdAt: Date }>) {
    return messages.map((m, i) => {
      const part = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === 'data');
      const parsed = part ? NegotiationTurnSchema.safeParse(part.data) : undefined;
      const speaker = m.senderId === `agent:${task.metadata.sourceUserId}` ? 'source' : 'candidate';
      return {
        turnNumber: i + 1,
        speaker,
        senderId: m.senderId,
        turn: parsed?.success ? parsed.data : null,
        createdAt: m.createdAt,
      };
    });
  }

  const list_negotiations = defineTool({
    name: 'list_negotiations',
    description:
      'List negotiations the authenticated user is involved in, either as the source (initiator) or candidate (responder). ' +
      'Negotiations are turn-based exchanges where two AI negotiator agents talk on behalf of their users; a negotiator never ' +
      'accepts, declines or withdraws — it only continues (outreach/counter/question) or pauses.\n\n' +
      '**Statuses:**\n' +
      '- `working` — turns are being exchanged.\n' +
      '- `paused` — waiting: `counterparty_silent` (the other side has not answered), `needs_principal` (waiting on the ' +
      'user themselves — relay the question), or `ready_for_verdict` (the negotiator believes a decision is possible; this ' +
      'is a recommendation, not a decision — only the user\'s own agent can act on it).\n' +
      '- `completed` — resolved: the opportunity status was written (`pending` or `rejected`).\n\n' +
      '**When to use:** To see ongoing and past negotiations, or find a negotiation ID for get_negotiation or respond_to_negotiation.',
    querySchema: z.object({
      status: z.enum(['working', 'paused', 'completed', 'all']).optional().describe('Filter by negotiation status. Omit or use "all" for everything.'),
      scope: z.enum(['signal', 'all']).optional().describe('Scope to the pinned signal (requires an intent-pinned session), or "all" for the full history.'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum negotiations to return (1-100). Omit to return all.'),
      page: z.number().int().min(1).optional().describe('Page number (1-based). Only used when limit is provided.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const allTasks = await negotiationDatabase.getNegotiationTasksForUser(context.userId);
        const tasks = query.status && query.status !== 'all' ? allTasks.filter((t) => t.state === query.status) : allTasks;

        const scopedNetworkId = focusedNetworkId(context);
        const pinnedIntentId = focusedIntentId(context);
        const effectiveScope = query.scope ?? (pinnedIntentId ? 'signal' : 'all');
        if (effectiveScope === 'signal' && !pinnedIntentId) return error('Signal scope requires a pinned intent.');

        const negotiations = tasks
          .filter((task) => !scopedNetworkId || task.metadata.networkId === scopedNetworkId)
          .filter((task) => effectiveScope !== 'signal' || task.metadata.intentId === pinnedIntentId)
          .map((task) => {
            const isSource = task.metadata.sourceUserId === context.userId;
            const counterpartyId = isSource ? task.metadata.candidateUserId : task.metadata.sourceUserId;
            const scopedPause = pauseFor(task, context.userId);
            return {
              id: task.id,
              opportunityId: task.metadata.opportunityId,
              counterpartyId,
              role: isSource ? 'source' : 'candidate',
              status: task.state,
              ...(scopedPause ? { pause: scopedPause } : {}),
              createdAt: task.createdAt,
              updatedAt: task.updatedAt,
            };
          });

        const shouldPaginate = query.limit !== undefined;
        if (shouldPaginate) {
          const limit = query.limit!;
          const page = query.page ?? 1;
          const offset = (page - 1) * limit;
          const paged = negotiations.slice(offset, offset + limit);
          return success({ count: paged.length, totalCount: negotiations.length, limit, page, negotiations: paged });
        }
        return success({ count: negotiations.length, negotiations });
      } catch (err) {
        logger.error('Failed to list negotiations', { err });
        return error('Failed to list negotiations. Please try again.');
      }
    },
  });

  const get_negotiation = defineTool({
    name: 'get_negotiation',
    description:
      'Get the full details of a specific negotiation: every turn, the counterparty, and the current state. A turn is one of ' +
      '`outreach | counter | question` (continues) or a pause with a reason (`counterparty_silent | needs_principal | ' +
      'ready_for_verdict`) and, for the latter two, a payload.\n\n' +
      '**Access control:** You must be a party to the negotiation (source or candidate) to view it.\n\n' +
      '**When to use:** To review the negotiation history before responding, or to see why it paused.',
    querySchema: z.object({ negotiationId: z.string().describe('The negotiation task ID (from list_negotiations results).') }),
    handler: async ({ context, query }) => {
      try {
        const task = await negotiationDatabase.getNegotiationTask(query.negotiationId);
        if (!task) return error('Negotiation not found.');

        const scopedNetworkId = focusedNetworkId(context);
        if (scopedNetworkId && task.metadata.networkId !== scopedNetworkId) {
          return error('Access denied: this negotiation is not in your bound network scope.');
        }
        const isSource = task.metadata.sourceUserId === context.userId;
        const isCandidate = task.metadata.candidateUserId === context.userId;
        if (!isSource && !isCandidate) return error('Access denied: you are not a party to this negotiation.');

        const [messages, opportunity] = await Promise.all([
          negotiationDatabase.getNegotiationMessages(task.id),
          negotiationDatabase.getOpportunity(task.metadata.opportunityId).catch(() => null),
        ]);
        const scopedPause = pauseFor(task, context.userId);

        return success({
          id: task.id,
          opportunityId: task.metadata.opportunityId,
          conversationId: task.conversationId,
          conversationType: 'agent_negotiation' as const,
          status: task.state,
          role: isSource ? 'source' : 'candidate',
          counterpartyId: isSource ? task.metadata.candidateUserId : task.metadata.sourceUserId,
          brief: task.brief,
          turns: turnsOf(task, messages),
          ...(scopedPause ? { pause: scopedPause } : {}),
          lifecycle: buildLifecycleNarration(
            task.state,
            opportunity ? { status: opportunity.status, acceptedByOwner: false } : undefined,
            scopedPause,
          ),
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        });
      } catch (err) {
        logger.error('Failed to get negotiation', { err });
        return error('Failed to get negotiation. Please try again.');
      }
    },
  });

  const respond_to_negotiation = defineTool({
    name: 'respond_to_negotiation',
    description:
      'Submit a turn to a negotiation on your seat\'s behalf. There is no accept, decline, or withdraw here — a negotiator ' +
      'never concludes a negotiation. To continue, submit `outreach` (opening turn only), `counter`, or `question` with a ' +
      'message. To stop, submit a `pause`: `needs_principal` (you need something only your principal knows — payload carries ' +
      'the question) or `ready_for_verdict` (you believe a decision is possible — payload carries a `pending`/`reject` ' +
      'recommendation and your reasoning). The turn goes through the same validation and pause bookkeeping every other turn ' +
      'source uses (internal agent, external agent, timeout) — there is no separate "external turn" code path.',
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID to respond to.'),
      verb: z.enum(NEGOTIATION_CONTINUE_VERBS).optional().describe('Set for a continuing turn: outreach (opening only), counter, or question.'),
      message: z.string().optional().describe('Required with verb.'),
      reasoning: z.string().optional().describe('Required with verb.'),
      pauseReason: z.enum(['needs_principal', 'ready_for_verdict']).optional().describe('Set to pause instead of continuing.'),
      question: z.string().optional().describe('Required when pauseReason is needs_principal.'),
      recommendation: z.enum(['pending', 'reject']).optional().describe('Required when pauseReason is ready_for_verdict.'),
    }).refine((v) => Boolean(v.verb) !== Boolean(v.pauseReason), { message: 'Provide exactly one of verb or pauseReason.' })
      .refine((v) => v.pauseReason !== 'needs_principal' || Boolean(v.question), { message: 'question is required when pauseReason is needs_principal.' })
      .refine((v) => v.pauseReason !== 'ready_for_verdict' || Boolean(v.recommendation), { message: 'recommendation is required when pauseReason is ready_for_verdict — no default is fabricated.' })
      // Without this, an omitted reasoning silently became '' (query.reasoning
      // ?? '') and failed the pause schema's own min(1) downstream — an
      // opaque parse error instead of a clear one, and ready_for_verdict was
      // unsatisfiable for any caller that didn't already know reasoning was
      // required for the pause path too, not just continuing verbs.
      .refine((v) => v.pauseReason !== 'ready_for_verdict' || Boolean(v.reasoning), { message: 'reasoning is required when pauseReason is ready_for_verdict.' }),
    handler: async ({ context, query }) => {
      try {
        const task = await negotiationDatabase.getNegotiationTask(query.negotiationId);
        if (!task) return error('Negotiation not found.');

        const scopedNetworkId = focusedNetworkId(context);
        if (scopedNetworkId && task.metadata.networkId !== scopedNetworkId) {
          return error('Access denied: this negotiation is not in your bound network scope.');
        }
        const isSource = task.metadata.sourceUserId === context.userId;
        const isCandidate = task.metadata.candidateUserId === context.userId;
        if (!isSource && !isCandidate) return error('Access denied: you are not a party to this negotiation.');
        // 'working' or 'paused' both accept a turn — apply reopens a paused negotiation
        // itself; only a resolved one is truly done.
        if (task.state === 'completed') return error(`Negotiation is not accepting a turn right now. Current status: ${task.state}`);

        // question/recommendation/reasoning presence for their respective
        // pauseReason is enforced by the schema's refine above — never
        // defaulted here.
        const turn = query.verb
          ? { verb: query.verb, message: query.message ?? '', reasoning: query.reasoning ?? '' }
          : query.pauseReason === 'needs_principal'
            ? { verb: 'pause' as const, reason: 'needs_principal' as const, payload: { question: query.question! } }
            : { verb: 'pause' as const, reason: 'ready_for_verdict' as const, payload: { recommendation: query.recommendation!, reasoning: query.reasoning! } };

        const parsed = NegotiationTurnSchema.safeParse(turn);
        if (!parsed.success) return error(`Invalid turn: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}`);

        const result = await negotiationGraph.invoke({ negotiationId: task.id, turn: parsed.data, byUserId: context.userId });
        if (result.status === 'error') return error(result.error ?? 'Failed to apply turn.');
        // The pre-check above reads task.state before this invoke — a concurrent
        // resolve can still land the negotiation between the two. `result.status`
        // is the graph's own definitive outcome: 'resolved' here means this turn
        // was silently discarded (routed to read), not applied — must not report
        // success for it.
        if (result.status === 'resolved') {
          return error(`Negotiation is not accepting a turn right now. Current status: ${result.status}`);
        }

        return success({
          negotiationId: task.id,
          status: result.status,
          ...(result.pause ? { pause: result.pause } : {}),
          turnCount: result.turns.length,
        });
      } catch (err) {
        logger.error('Failed to respond to negotiation', { err });
        return error('Failed to respond to negotiation. Please try again.');
      }
    },
  });

  return [list_negotiations, get_negotiation, respond_to_negotiation] as const;
}
