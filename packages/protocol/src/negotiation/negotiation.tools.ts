import { z } from 'zod';

import type { DefineTool, ToolDeps } from '../shared/agent/tool.helpers.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import { IndexNegotiator } from './negotiation.agent.js';
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment, NegotiationOutcome } from './negotiation.state.js';
import type { NegotiationTurnPayload } from '../shared/interfaces/agent-dispatcher.interface.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('NegotiationTools');

/**
 * Default park-window budget for ambient (background) negotiations. When a personal
 * agent is fresh, the dispatcher parks the turn and this is how long we wait before
 * the system agent takes over as a fallback.
 *
 * Short enough that ambient opportunities materialize in minutes (not hours),
 * long enough to cover two full polling cycles (30s * 2 = 60s) plus an agent
 * subagent turn. 5 minutes gives generous headroom.
 */
export const AMBIENT_PARK_WINDOW_MS = 5 * 60 * 1000;

/**
 * Pulls the negotiation's network from task metadata. Tasks created after the
 * scope hardening carry `metadata.networkId` directly; older tasks only have
 * the network embedded in the parked `turnContext.indexContext.networkId`.
 * Returns `null` for legacy tasks where neither field is present — callers
 * scoped by `context.networkId` must reject these defensively rather than
 * fall through to a global view.
 */
function readTaskNetworkId(meta: {
  networkId?: string;
  turnContext?: { indexContext?: { networkId?: string } };
} | null): string | null {
  if (!meta) return null;
  if (typeof meta.networkId === 'string' && meta.networkId.trim()) return meta.networkId;
  const fromTurnContext = meta.turnContext?.indexContext?.networkId;
  if (typeof fromTurnContext === 'string' && fromTurnContext.trim()) return fromTurnContext;
  return null;
}

const SCOPE_DENIAL = 'Access denied: this negotiation is not in your bound network scope.';

/**
 * Creates negotiation MCP tools for external agent access.
 * Exposes negotiation state for listing, reading, and responding to bilateral negotiations.
 */
export function createNegotiationTools(defineTool: DefineTool, deps: ToolDeps) {
  const { negotiationDatabase } = deps;

  const list_negotiations = defineTool({
    name: 'list_negotiations',
    description:
      'List bilateral negotiations the authenticated user is involved in, either as the source (initiator) or candidate (responder). ' +
      'Negotiations are turn-based exchanges where two AI agents negotiate on behalf of their users to determine if there is a ' +
      'mutual opportunity for collaboration.\n\n' +
      '**Statuses:**\n' +
      '- `active` — Negotiation is in progress, agents are exchanging turns.\n' +
      '- `waiting_for_agent` — The graph has yielded and is waiting for an agent response (e.g. from the user via respond_to_negotiation) or a timeout.\n' +
      '- `completed` — Negotiation has concluded (accepted, rejected, or reached turn cap).\n\n' +
      '**When to use:** To see ongoing and past negotiations, check which negotiations need attention, ' +
      'or find a negotiation ID for get_negotiation or respond_to_negotiation.',
    querySchema: z.object({
      status: z.enum(['active', 'waiting_for_agent', 'completed', 'all']).optional()
        .describe('Filter by negotiation status. Omit or use "all" to return all negotiations.'),
      since: z.string().datetime().optional()
        .describe('ISO 8601 date-time. Only return negotiations created at or after this timestamp.'),
      limit: z.number().int().min(1).max(100).optional()
        .describe('Maximum negotiations to return per page (1-100). Omit to return all.'),
      page: z.number().int().min(1).optional()
        .describe('Page number (1-based). Only used when limit is provided. Defaults to 1.'),
    }),
    handler: async ({ context, query }) => {
      try {
        // Map tool status filter to task state query
        const stateFilter = query.status && query.status !== 'all' ? query.status : undefined;
        // For 'active', query 'working' state tasks
        const dbState = stateFilter === 'active' ? 'working'
          : stateFilter === 'waiting_for_agent' ? 'waiting_for_agent'
          : stateFilter === 'completed' ? 'completed'
          : undefined;

        const tasks = await negotiationDatabase.getTasksForUser(context.userId, dbState ? { state: dbState } : undefined);

        const negotiations = await Promise.all(tasks.map(async (task) => {
          const meta = task.metadata as {
            sourceUserId?: string;
            candidateUserId?: string;
            type?: string;
            maxTurns?: number;
            networkId?: string;
            turnContext?: { indexContext?: { networkId?: string } };
          } | null;
          if (meta?.type !== 'negotiation') return null;

          // Network-scope filter: when caller's API key carries a network-bound
          // agent, drop tasks whose network differs (or whose network we cannot
          // determine — defense in depth for legacy tasks).
          if (context.networkId) {
            const taskNetworkId = readTaskNetworkId(meta);
            if (taskNetworkId !== context.networkId) return null;
          }

          const isSource = meta.sourceUserId === context.userId;
          const counterpartyId = isSource ? meta.candidateUserId : meta.sourceUserId;

          // Get latest message for preview
          const messages = await negotiationDatabase.getMessagesForConversation(task.conversationId);
          const lastMessage = messages[messages.length - 1];
          const lastTurnData = lastMessage
            ? ((lastMessage.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data')?.data as { action?: string; assessment?: { reasoning?: string }; message?: string | null } | undefined)
            : undefined;

          // Determine whose turn it is based on message count (alternating source/candidate)
          const turnCount = messages.length;
          const currentSpeaker = turnCount % 2 === 0 ? 'source' : 'candidate';

          // Map task state to tool status
          const status = task.state === 'working' ? 'active'
            : task.state === 'waiting_for_agent' ? 'waiting_for_agent'
            : task.state === 'completed' ? 'completed'
            : task.state;

          const isUsersTurn = status !== 'completed' &&
            ((isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate'));

          return {
            id: task.id,
            counterpartyId: counterpartyId ?? 'unknown',
            role: isSource ? 'source' : 'candidate',
            turnCount,
            status,
            isUsersTurn,
            latestAction: lastTurnData?.action ?? null,
            latestMessagePreview: lastTurnData?.message ?? null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          };
        }));

        let filtered = negotiations.filter(Boolean);

        if (query.since) {
          const sinceMs = new Date(query.since).getTime();
          filtered = filtered.filter(n => new Date(n!.createdAt).getTime() >= sinceMs);
        }

        const shouldPaginate = query.limit !== undefined;
        if (shouldPaginate) {
          const limit = query.limit!;
          const page = query.page ?? 1;
          const offset = (page - 1) * limit;
          const paged = filtered.slice(offset, offset + limit);
          return success({
            count: paged.length,
            totalCount: filtered.length,
            limit,
            page,
            totalPages: Math.ceil(filtered.length / limit),
            negotiations: paged,
          });
        }

        return success({
          count: filtered.length,
          negotiations: filtered,
        });
      } catch (err) {
        logger.error('Failed to list negotiations', { err });
        return error('Failed to list negotiations. Please try again.');
      }
    },
  });

  const get_negotiation = defineTool({
    name: 'get_negotiation',
    description:
      'Get the full details of a specific negotiation, including all turns, messages, counterparty info, and current state. ' +
      'Negotiations are bilateral exchanges where two AI agents negotiate on behalf of users. Each turn contains an action ' +
      '(propose, accept, reject, counter, question), an assessment with reasoning and suggested roles, and an optional message.\n\n' +
      '**Access control:** You must be a party to the negotiation (source or candidate) to view it.\n\n' +
      '**Statuses:** `active` — in progress. `waiting_for_agent` — waiting for an agent response or timeout. `completed` — concluded.\n\n' +
      '**When to use:** To review the full negotiation history before responding, to understand why a negotiation was ' +
      'accepted or rejected, or to see the current state of an active negotiation.\n\n' +
      '**Negotiation-turn-mode usage.** If you are running as a silent background subagent (dispatched by the ' +
      "openclaw runtime's poller in response to a claimed negotiation turn), call this tool FIRST with the " +
      'negotiationId from your task prompt. This returns the current state, both parties\' context, and the ' +
      'history of turns so far. Ground your response in the caller\'s profile (read_user_profiles) and intents ' +
      '(read_intents) before deciding on a turn action. Do not produce user-facing output in this mode.',
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID (from list_negotiations results).'),
    }),
    handler: async ({ context, query }) => {
      try {
        const task = await negotiationDatabase.getTask(query.negotiationId);
        if (!task) {
          return error('Negotiation not found.');
        }

        const meta = task.metadata as {
          sourceUserId?: string;
          candidateUserId?: string;
          type?: string;
          maxTurns?: number;
          opportunityId?: string;
          networkId?: string;
          turnContext?: {
            sourceUser: UserNegotiationContext;
            candidateUser: UserNegotiationContext;
            indexContext: { networkId: string; prompt?: string };
            seedAssessment: SeedAssessment;
            discoveryQuery?: string;
          };
        } | null;
        if (meta?.type !== 'negotiation') {
          return error('Negotiation not found.');
        }

        // Network-scope check: a network-bound agent must not read negotiations
        // outside its bound network. Run before the participant check so we
        // don't leak existence-vs-membership signal across scopes.
        if (context.networkId) {
          const taskNetworkId = readTaskNetworkId(meta);
          if (taskNetworkId !== context.networkId) {
            return error(SCOPE_DENIAL);
          }
        }

        // Access control: user must be source or candidate
        const isSource = meta.sourceUserId === context.userId;
        const isCandidate = meta.candidateUserId === context.userId;
        if (!isSource && !isCandidate) {
          return error('Access denied: you are not a party to this negotiation.');
        }

        const counterpartyId = isSource ? meta.candidateUserId : meta.sourceUserId;

        // Project absolute turn context (source/candidate) into own/other
        // perspective for the caller. Mirrors what the in-process system
        // agent receives as NegotiationAgentInput — identical context means
        // identical deliberation on both paths.
        let negotiationContext: {
          ownUser: UserNegotiationContext;
          otherUser: UserNegotiationContext;
          indexContext: { networkId: string; prompt?: string };
          seedAssessment: SeedAssessment;
          isDiscoverer: boolean;
          discoveryQuery?: string;
        } | null = null;
        if (meta.turnContext) {
          const tc = meta.turnContext;
          negotiationContext = {
            ownUser: isSource ? tc.sourceUser : tc.candidateUser,
            otherUser: isSource ? tc.candidateUser : tc.sourceUser,
            indexContext: tc.indexContext,
            seedAssessment: tc.seedAssessment,
            isDiscoverer: isSource,
            ...(tc.discoveryQuery && { discoveryQuery: tc.discoveryQuery }),
          };
        }

        // Load messages and artifacts
        const [messages, artifacts] = await Promise.all([
          negotiationDatabase.getMessagesForConversation(task.conversationId),
          negotiationDatabase.getArtifactsForTask(task.id),
        ]);

        // Parse turns from messages
        const turns = messages.map((m, idx) => {
          const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
          const turnData = dataPart?.data as {
            action?: string;
            assessment?: { reasoning?: string; suggestedRoles?: unknown };
            message?: string;
          } | undefined;

          const turnNumber = idx + 1;
          const speaker = turnNumber % 2 === 1 ? 'source' : 'candidate';

          return {
            turnNumber,
            speaker,
            senderId: m.senderId,
            action: turnData?.action ?? 'unknown',
            reasoning: turnData?.assessment?.reasoning ?? null,
            suggestedRoles: turnData?.assessment?.suggestedRoles ?? null,
            message: turnData?.message ?? null,
            createdAt: m.createdAt,
          };
        });

        // Extract outcome from artifacts if completed
        const outcomeArtifact = artifacts.find(a => a.name === 'negotiation-outcome');
        const outcome = outcomeArtifact
          ? (outcomeArtifact.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data')?.data
          : null;

        // Determine whose turn it is
        const turnCount = messages.length;
        const currentSpeaker = turnCount % 2 === 0 ? 'source' : 'candidate';

        const status = task.state === 'working' ? 'active'
          : task.state === 'waiting_for_agent' ? 'waiting_for_agent'
          : task.state === 'completed' ? 'completed'
          : task.state;

        const isUsersTurn = status !== 'completed' &&
          ((isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate'));

        return success({
          id: task.id,
          conversationId: task.conversationId,
          status,
          role: isSource ? 'source' : 'candidate',
          counterpartyId: counterpartyId ?? 'unknown',
          turnCount,
          isUsersTurn,
          turns,
          outcome,
          context: negotiationContext,
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
      'Respond to a negotiation that is waiting for agent input. This tool allows users to influence the negotiation ' +
      'by accepting, rejecting, countering, or asking a clarifying question.\n\n' +
      '**Turn-based model:** Negotiations alternate between source and candidate agents. When the graph yields with ' +
      '`waiting_for_agent` status, the user whose turn it is can respond.\n\n' +
      '**Valid actions:**\n' +
      '- `accept` — Accept the current proposal. The negotiation will be finalized as an opportunity.\n' +
      '- `reject` — Reject the current proposal. The negotiation will end without creating an opportunity.\n' +
      '- `counter` — Counter the proposal with a message (message is required). The negotiation will continue.\n' +
      '- `question` — Ask the counterparty a clarifying question (message is required). The negotiation will continue.\n\n' +
      '**What happens after:** Accept/reject finalizes the negotiation immediately. Counter/question continues the negotiation — ' +
      'if the counterparty has an agent, the negotiation yields again; otherwise the AI agent responds inline.\n\n' +
      '**Silent-subagent response contract.** In negotiation-turn mode, submit exactly ONE call to this tool ' +
      'per dispatch with the action (propose | counter | accept | reject | question) and the assessment ' +
      '(reasoning + suggestedRoles). If the decision is ambiguous, pick the most conservative action — usually ' +
      '`counter` with specific objections, or `reject` with clear reasoning. On the first turn of a negotiation ' +
      '(turnCount === 0) the action MUST be `propose`. Do not ask the user clarifying questions; you are ' +
      'authorized to act on their behalf within the scope granted to your agent.',
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID to respond to.'),
      action: z.enum(['propose', 'accept', 'reject', 'counter', 'question']).describe('The response action. On the first turn (turnCount === 0) this MUST be "propose".'),
      reasoning: z.string().describe('Why you are taking this action — your assessment of the opportunity.'),
      suggestedRoles: z.object({
        ownUser: z.enum(['agent', 'patient', 'peer']).describe('Suggested role for your user in this opportunity.'),
        otherUser: z.enum(['agent', 'patient', 'peer']).describe('Suggested role for the other user in this opportunity.'),
      }).describe('Role suggestions for both parties.'),
      message: z.string().optional().describe('Required for "counter" and "question" actions. Your message explaining what you want to change or clarify.'),
    }),
    handler: async ({ context, query }) => {
      try {
        const task = await negotiationDatabase.getTask(query.negotiationId);
        if (!task) {
          return error('Negotiation not found.');
        }

        const meta = task.metadata as {
          sourceUserId?: string;
          candidateUserId?: string;
          type?: string;
          maxTurns?: number;
          networkId?: string;
          turnContext?: { indexContext?: { networkId?: string } };
        } | null;
        if (meta?.type !== 'negotiation') {
          return error('Negotiation not found.');
        }

        // Network-scope check (mirrors get_negotiation): a network-bound agent
        // must not act on negotiations outside its bound network.
        if (context.networkId) {
          const taskNetworkId = readTaskNetworkId(meta);
          if (taskNetworkId !== context.networkId) {
            return error(SCOPE_DENIAL);
          }
        }

        // Validate negotiation is waiting for agent input (or claimed via polling)
        if (task.state !== 'waiting_for_agent' && task.state !== 'claimed') {
          return error(`Negotiation is not waiting for a response. Current status: ${task.state}`);
        }

        // Access control: user must be a party
        const isSource = meta.sourceUserId === context.userId;
        const isCandidate = meta.candidateUserId === context.userId;
        if (!isSource && !isCandidate) {
          return error('Access denied: you are not a party to this negotiation.');
        }

        // Determine whose turn it is
        const messages = await negotiationDatabase.getMessagesForConversation(task.conversationId);
        const turnCount = messages.length;
        const currentSpeaker = turnCount % 2 === 0 ? 'source' : 'candidate';
        const isUsersTurn = (isSource && currentSpeaker === 'source') || (!isSource && currentSpeaker === 'candidate');

        if (!isUsersTurn) {
          return error('It is not your turn to respond in this negotiation.');
        }

        // Validate counter/question has a message
        if ((query.action === 'counter' || query.action === 'question') && !query.message?.trim()) {
          return error(`A message is required when using "${query.action}". Explain what you want to change or clarify.`);
        }

        // ── Cancel pending timeout ──
        if (deps.negotiationTimeoutQueue) {
          await deps.negotiationTimeoutQueue.cancelTimeout(task.id);
        }

        // ── Build and persist the external agent's turn ──
        const turnData: NegotiationTurn = {
          action: query.action,
          assessment: {
            reasoning: query.reasoning,
            suggestedRoles: query.suggestedRoles,
          },
          ...(query.message ? { message: query.message } : {}),
        };

        const senderId = `agent:${context.userId}`;
        const turnMessage = await negotiationDatabase.createMessage({
          conversationId: task.conversationId,
          senderId,
          role: 'agent',
          parts: [{ kind: 'data' as const, data: turnData }],
          taskId: task.id,
        });

        const newTurnCount = turnCount + 1;

        // ── Handle accept/reject: finalize immediately ──
        if (query.action === 'accept' || query.action === 'reject') {
          const allMessages = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
          const history: NegotiationTurn[] = allMessages.map(m => {
            const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
            return dp?.data as NegotiationTurn;
          }).filter(Boolean);

          const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
          const outcome = buildNegotiationOutcome(history, newTurnCount, query.action, meta.sourceUserId!, meta.candidateUserId!, nextSpeaker);

          await negotiationDatabase.updateTaskState(task.id, 'completed');
          await negotiationDatabase.createArtifact({
            taskId: task.id,
            name: 'negotiation-outcome',
            parts: [{ kind: 'data', data: outcome }],
            metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount },
          });

          return success({
            message: query.action === 'accept'
              ? 'Negotiation accepted. An opportunity has been created.'
              : 'Negotiation rejected.',
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            outcome,
          });
        }

        // ── Handle counter/question: check if under max turns ──
        const maxTurns = meta.maxTurns ?? 6; // Read from task metadata; fallback to system default
        if (newTurnCount >= maxTurns) {
          // Max turns reached — finalize with turn_cap
          const allMessages = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
          const history: NegotiationTurn[] = allMessages.map(m => {
            const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
            return dp?.data as NegotiationTurn;
          }).filter(Boolean);

          const nextSpeakerForCap = currentSpeaker === 'source' ? 'candidate' : 'source';
          const outcome = buildNegotiationOutcome(history, newTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, nextSpeakerForCap);

          await negotiationDatabase.updateTaskState(task.id, 'completed');
          await negotiationDatabase.createArtifact({
            taskId: task.id,
            name: 'negotiation-outcome',
            parts: [{ kind: 'data', data: outcome }],
            metadata: { hasOpportunity: false, turnCount: newTurnCount },
          });

          return success({
            message: 'Maximum turns reached. Negotiation finalized without opportunity.',
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            outcome,
          });
        }

        // ── Counter/question under max turns: dispatch to counterparty's agent ──
        const counterpartyUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;
        const counterpartySpeaker = isSource ? 'candidate' : 'source';

        // Build the current turn history for dispatcher payload
        const allMessagesWithTurn = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
        const historyForDispatch: NegotiationTurn[] = allMessagesWithTurn.map(m => {
          const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
          return dp?.data as NegotiationTurn;
        }).filter(Boolean);

        const isFinalTurn = newTurnCount + 1 >= maxTurns;

        const ownUserCtx: UserNegotiationContext = { id: counterpartyUserId, intents: [], profile: {} };
        const otherUserCtx: UserNegotiationContext = { id: context.userId, intents: [], profile: {} };
        const seedAssessment: SeedAssessment = { reasoning: 'Continued negotiation', valencyRole: 'peer' };

        const dispatchPayload: NegotiationTurnPayload = {
          negotiationId: task.id,
          ownUser: ownUserCtx,
          otherUser: otherUserCtx,
          indexContext: { networkId: '' },
          seedAssessment,
          history: historyForDispatch,
          isFinalTurn,
          isDiscoverer: false,
        };

        const scope = { action: 'negotiation.respond', scopeType: 'negotiation', scopeId: task.id };
        const timeoutMs = AMBIENT_PARK_WINDOW_MS;

        const dispatchResult = await deps.agentDispatcher?.dispatch(counterpartyUserId, scope, dispatchPayload, { timeoutMs });

        if (dispatchResult?.handled === false && dispatchResult.reason === 'waiting') {
          // Counterparty's agent acknowledged — yield and wait
          await negotiationDatabase.updateTaskState(task.id, 'waiting_for_agent');

          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(task.id, newTurnCount, timeoutMs);
          }

          return success({
            message: `${query.action === 'question' ? 'Question' : query.action === 'propose' ? 'Proposal' : 'Counter-proposal'} submitted. Waiting for counterparty response.`,
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            waitingForAgent: true,
          });
        }

        let aiTurn: NegotiationTurn;

        if (dispatchResult?.handled === true) {
          // Dispatcher returned an agent turn directly
          aiTurn = dispatchResult.turn;
        } else {
          // No agent or timeout — run the system AI agent inline.
          // The agent honors a per-turn LLM timeout (AbortSignal), so invoke
          // can reject. Mirror the graph turnNode's reject-shaped fallback so
          // a timed-out or failed call degrades gracefully instead of leaving
          // the task pinned in `working` while the outer catch returns a bare
          // error to the user.
          await negotiationDatabase.updateTaskState(task.id, 'working');

          const agent = new IndexNegotiator();
          try {
            aiTurn = await agent.invoke({
              ownUser: ownUserCtx,
              otherUser: otherUserCtx,
              indexContext: { networkId: '' },
              seedAssessment,
              history: historyForDispatch,
              isFinalTurn,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn('System negotiator inline invoke failed; treating as reject', { taskId: task.id, error: errMsg });
            aiTurn = {
              action: 'reject',
              assessment: {
                reasoning: `System negotiator failed: ${errMsg}`,
                suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
              },
            };
          }
        }

        // Persist the counterparty's turn (from dispatcher or inline AI)
        const aiSenderId = `agent:${counterpartyUserId}`;
        await negotiationDatabase.createMessage({
          conversationId: task.conversationId,
          senderId: aiSenderId,
          role: 'agent',
          parts: [{ kind: 'data' as const, data: aiTurn }],
          taskId: task.id,
        });

        const finalTurnCount = newTurnCount + 1;

        // Evaluate response
        if (aiTurn.action === 'accept' || aiTurn.action === 'reject') {
          const fullHistory = [...historyForDispatch, aiTurn];
          const outcome = buildNegotiationOutcome(fullHistory, finalTurnCount, aiTurn.action, meta.sourceUserId!, meta.candidateUserId!, counterpartySpeaker === 'source' ? 'candidate' : 'source');

          await negotiationDatabase.updateTaskState(task.id, 'completed');
          await negotiationDatabase.createArtifact({
            taskId: task.id,
            name: 'negotiation-outcome',
            parts: [{ kind: 'data', data: outcome }],
            metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: finalTurnCount },
          });

          return success({
            message: `${query.action === 'question' ? 'Question' : query.action === 'propose' ? 'Proposal' : 'Counter'} submitted. Counterparty responded with ${aiTurn.action}.`,
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
            outcome,
          });
        }

        // Counterparty countered/questioned — check if max turns reached
        if (finalTurnCount >= maxTurns) {
          const fullHistory = [...historyForDispatch, aiTurn];
          const outcome = buildNegotiationOutcome(fullHistory, finalTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, counterpartySpeaker === 'source' ? 'candidate' : 'source');

          await negotiationDatabase.updateTaskState(task.id, 'completed');
          await negotiationDatabase.createArtifact({
            taskId: task.id,
            name: 'negotiation-outcome',
            parts: [{ kind: 'data', data: outcome }],
            metadata: { hasOpportunity: false, turnCount: finalTurnCount },
          });

          return success({
            message: 'Counterparty responded but max turns reached. Negotiation finalized.',
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
            outcome,
          });
        }

        // Counterparty countered/questioned, now user's turn again — dispatch to user's agent
        const userDispatchPayload: NegotiationTurnPayload = {
          negotiationId: task.id,
          ownUser: { id: context.userId, intents: [], profile: {} },
          otherUser: { id: counterpartyUserId, intents: [], profile: {} },
          indexContext: { networkId: '' },
          seedAssessment,
          history: [...historyForDispatch, aiTurn],
          isFinalTurn: finalTurnCount + 1 >= maxTurns,
          isDiscoverer: true,
        };

        const userDispatchResult = await deps.agentDispatcher?.dispatch(context.userId, scope, userDispatchPayload, { timeoutMs });

        if (!userDispatchResult || (userDispatchResult.handled === false && userDispatchResult.reason === 'no_agent')) {
          // No agent for user — set back to waiting_for_agent so they can use respond_to_negotiation
          await negotiationDatabase.updateTaskState(task.id, 'waiting_for_agent');

          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(task.id, finalTurnCount, timeoutMs);
          }

          return success({
            message: `${query.action === 'question' ? 'Question' : 'Counter'} submitted. Counterparty responded. Your turn to respond.`,
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
            waitingForAgent: true,
          });
        }

        if (userDispatchResult.handled === false && userDispatchResult.reason === 'waiting') {
          // User's agent acknowledged — yield and wait
          await negotiationDatabase.updateTaskState(task.id, 'waiting_for_agent');

          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(task.id, finalTurnCount, timeoutMs);
          }

          return success({
            message: `${query.action === 'question' ? 'Question' : 'Counter'} submitted. Counterparty countered back. Waiting for your agent's response.`,
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
            waitingForAgent: true,
          });
        }

        if (userDispatchResult.handled === true) {
          // User's agent returned a turn directly — persist, evaluate, and continue
          const userAgentTurn: NegotiationTurn = userDispatchResult.turn;
          const userAgentSenderId = `agent:${context.userId}`;
          await negotiationDatabase.createMessage({
            conversationId: task.conversationId,
            senderId: userAgentSenderId,
            role: 'agent',
            parts: [{ kind: 'data' as const, data: userAgentTurn }],
            taskId: task.id,
          });

          const userTurnCount = finalTurnCount + 1;

          if (userAgentTurn.action === 'accept' || userAgentTurn.action === 'reject') {
            const fullHistory = [...historyForDispatch, aiTurn, userAgentTurn];
            const userSpeaker = isSource ? 'source' : 'candidate';
            const outcome = buildNegotiationOutcome(fullHistory, userTurnCount, userAgentTurn.action, meta.sourceUserId!, meta.candidateUserId!, userSpeaker === 'source' ? 'candidate' : 'source');

            await negotiationDatabase.updateTaskState(task.id, 'completed');
            await negotiationDatabase.createArtifact({
              taskId: task.id,
              name: 'negotiation-outcome',
              parts: [{ kind: 'data', data: outcome }],
              metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: userTurnCount },
            });

            return success({
              message: `Your agent ${userAgentTurn.action}ed the counterparty's response.`,
              negotiationId: task.id,
              action: query.action,
              turnNumber: newTurnCount,
              counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
              outcome,
            });
          }

          if (userTurnCount >= maxTurns) {
            const fullHistory = [...historyForDispatch, aiTurn, userAgentTurn];
            const outcome = buildNegotiationOutcome(fullHistory, userTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, isSource ? 'candidate' : 'source');

            await negotiationDatabase.updateTaskState(task.id, 'completed');
            await negotiationDatabase.createArtifact({
              taskId: task.id,
              name: 'negotiation-outcome',
              parts: [{ kind: 'data', data: outcome }],
              metadata: { hasOpportunity: false, turnCount: userTurnCount },
            });

            return success({
              message: 'Your agent responded but max turns reached. Negotiation finalized.',
              negotiationId: task.id,
              action: query.action,
              turnNumber: newTurnCount,
              counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
              outcome,
            });
          }

          // User's agent countered/questioned — arm timeout for counterparty's next turn
          await negotiationDatabase.updateTaskState(task.id, 'waiting_for_agent');

          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(task.id, userTurnCount, timeoutMs);
          }

          return success({
            message: `Your agent responded with ${userAgentTurn.action}. Waiting for counterparty.`,
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
            waitingForAgent: true,
          });
        }

        // No agent / timeout — set back to working so graph can continue
        await negotiationDatabase.updateTaskState(task.id, 'working');

        return success({
          message: `${query.action === 'question' ? 'Question' : 'Counter'} submitted. Counterparty countered back. Negotiation continues.`,
          negotiationId: task.id,
          action: query.action,
          turnNumber: newTurnCount,
          counterpartyResponse: { action: aiTurn.action, reasoning: aiTurn.assessment.reasoning, message: aiTurn.message ?? null },
        });
      } catch (err) {
        logger.error('Failed to respond to negotiation', { err });
        return error('Failed to respond to negotiation. Please try again.');
      }
    },
  });

  return [list_negotiations, get_negotiation, respond_to_negotiation] as const;
}

/**
 * Build a NegotiationOutcome from the full turn history.
 * Mirrors the logic in the graph's finalizeNode for consistency.
 *
 * @param history - All negotiation turns
 * @param turnCount - Total number of turns
 * @param lastAction - The last turn's action (accept/reject/counter)
 * @param sourceUserId - Source user ID
 * @param candidateUserId - Candidate user ID
 * @param currentSpeaker - Who would speak next (the person after the accepter/rejector)
 */
function buildNegotiationOutcome(
  history: NegotiationTurn[],
  turnCount: number,
  lastAction: string,
  sourceUserId: string,
  candidateUserId: string,
  currentSpeaker: string,
): NegotiationOutcome {
  const hasOpportunity = lastAction === 'accept';
  const atCap = lastAction === 'counter';

  let agreedRoles: NegotiationOutcome['agreedRoles'] = [];
  if (hasOpportunity && history.length >= 2) {
    const acceptTurn = history[history.length - 1];
    const precedingTurn = history[history.length - 2];
    const accepterIsSource = currentSpeaker === 'candidate';
    const [sourceRole, candidateRole] = accepterIsSource
      ? [acceptTurn.assessment.suggestedRoles.ownUser, precedingTurn.assessment.suggestedRoles.ownUser]
      : [precedingTurn.assessment.suggestedRoles.ownUser, acceptTurn.assessment.suggestedRoles.ownUser];
    agreedRoles = [
      { userId: sourceUserId, role: sourceRole },
      { userId: candidateUserId, role: candidateRole },
    ];
  }

  return {
    hasOpportunity,
    agreedRoles,
    reasoning: history[history.length - 1]?.assessment.reasoning ?? '',
    turnCount,
    ...(atCap && { reason: 'turn_cap' }),
  };
}
