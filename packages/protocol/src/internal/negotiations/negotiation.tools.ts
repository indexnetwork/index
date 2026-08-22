import { z } from 'zod';

import type { DefineTool } from '../shared/agent/tool.helpers.js';
import type { NegotiationToolDeps } from './negotiation.tools.port.js';
import { success, error } from '../shared/agent/tool.helpers.js';
import type { NegotiationOpportunityLifecycle, OpportunityStatus } from '../../platform/database.js';
import { IndexNegotiator } from './negotiation.agent.js';
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment, NegotiationOutcome } from './negotiation.state.js';
import { allowedActionsFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor, resolveSeat, seatViolationMessage } from './negotiation.protocol.js';
import { NEGOTIATION_ACTIONS } from '../../protocol/schemas/negotiation-state.schema.js';
import type { NegotiationTurnPayload } from '../shared/interfaces/agent-dispatcher.interface.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';
import { focusedIntentId, focusedNetworkId } from '../shared/agent/tool.scope.js';
import { readAuthorizedNegotiationDetail } from './negotiation.detail-reader.js';
import { buildLifecycleNarration, parkLifecycleLabel } from './negotiation.lifecycle-narration.js';
import type { NegotiationParkNarration } from './negotiation.lifecycle-narration.js';
import { classifyInflightPark, classifyPostStallPark } from './negotiation.answer-consumption.js';
import type { ListingOpenQuestion, NegotiationListingParkHost } from '../../platform/negotiation/listing.js';
import { isNegotiationTurnCapReached } from './negotiation.turn-cap.js';
import { expectedNegotiationSpeaker } from './negotiation.expected-speaker.js';
import { readNegotiationMessages } from './negotiation.scope.js';

export { buildLifecycleNarration, parkLifecycleLabel } from './negotiation.lifecycle-narration.js';

const logger = protocolLogger('ChatTools:Negotiation');

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
 * scoped by the request scope envelope must reject these defensively rather than
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

/** Reads lifecycle evidence without making older host adapters mandatory. */
async function readOpportunityLifecycles(
  database: NegotiationToolDeps['negotiationDatabase'],
  opportunityIds: string[],
  ownerUserId: string,
): Promise<Record<string, NegotiationOpportunityLifecycle>> {
  if (opportunityIds.length === 0 || !database.getOpportunityLifecyclesForNegotiations) return {};
  try {
    return await database.getOpportunityLifecyclesForNegotiations(opportunityIds, ownerUserId);
  } catch (err) {
    logger.warn('Failed to load opportunity lifecycle for negotiation narration', { err });
    return {};
  }
}

/**
 * Terminal opportunity status for a negotiation concluded through this tool.
 * Version-independent mapping, identical to the graph's finalize node:
 * `accept` → `pending` (the owner gate is still ahead), reject-like →
 * `rejected`, anything else (the turn cap) → `stalled`.
 */
function terminalOpportunityStatus(lastAction: string): OpportunityStatus {
  if (lastAction === 'accept') return 'pending';
  return isRejectLikeAction(lastAction) ? 'rejected' : 'stalled';
}

/**
 * Conclude a negotiation reached through `respond_to_negotiation`: complete
 * the task, write the outcome artifact, and advance the opportunity out of
 * `negotiating`.
 *
 * The status write goes through `updateOpportunityStatus` — the same waist the
 * graph's finalize node uses — because that method is what carries the
 * post-commit opportunity-transition emit. Writing the column any other way
 * (or, as this path did before, not at all) leaves the transition hook blind:
 * neither side's question-message is regenerated or pruned, radar buckets keep
 * counting a finished negotiation, and the expiry sweep still sees a phantom
 * active opportunity.
 *
 * The status write is best-effort, mirroring finalize: the task is already
 * completed and the artifact written, so a failed status flip is logged rather
 * than turned into a tool error the caller would read as "the conclude did not
 * happen".
 */
async function concludeNegotiation(
  database: NegotiationToolDeps['negotiationDatabase'],
  input: {
    taskId: string;
    opportunityId?: string;
    lastAction: string;
    outcome: NegotiationOutcome;
    turnCount: number;
  },
): Promise<void> {
  await database.updateTaskState(input.taskId, 'completed');
  await database.createArtifact({
    taskId: input.taskId,
    name: 'negotiation-outcome',
    parts: [{ kind: 'data', data: input.outcome }],
    metadata: { hasOpportunity: input.outcome.hasOpportunity, turnCount: input.turnCount },
  });

  if (!input.opportunityId) return;
  const status = terminalOpportunityStatus(input.lastAction);
  try {
    await database.updateOpportunityStatus(input.opportunityId, status);
  } catch (err) {
    logger.error('Failed to update opportunity status on MCP conclude', {
      taskId: input.taskId,
      opportunityId: input.opportunityId,
      status,
      err,
    });
  }
}

/** Extracts the ordered NegotiationTurn list from A2A message data parts. */
function turnsFromMessages(messages: Array<{ parts: unknown[] }>): NegotiationTurn[] {
  return messages
    .map((m) => {
      const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find((p) => p.kind === 'data');
      return dp?.data as NegotiationTurn;
    })
    .filter(Boolean);
}

// ─── Park annotations for the listing (#1472) ───────────────────────────────
//
// The listing renders lifecycle from OPPORTUNITY STATUS, where a pairing whose
// negotiation is parked on the client legitimately reads `negotiating`. On
// 2026-08-20 that is exactly what it read, while a task had sat
// `input_required` on the client's side for two hours with the open question
// "Timing: This week" — and the model, holding a context line saying one thing
// and a just-executed tool saying another, went with the tool and told her
// there were no open questions and nothing for her to decide.
//
// So the listing says the park, and out of the same record every other
// answerability surface reads. Whose side a park is on is the CANONICAL
// predicate (`classifyInflightPark` / `classifyPostStallPark`), run over the
// task and messages the listing already holds — no second predicate, no extra
// read. The question's NUMBER and LABEL come from the host, which resolves
// them through `readOpenQuestionsForIntent`: the same call the open-questions
// prompt section and `answer_pending_question` make, so the number the client
// is shown here is the number that routes their answer.

/**
 * Every open question of the given signals, keyed by the negotiation it
 * unparks. Read per signal — in the pinned case that is a single call — and
 * never allowed to fail the listing: an unreadable signal loses its numbers,
 * not its parks.
 */
async function readListingOpenQuestions(
  host: NegotiationListingParkHost | undefined,
  userId: string,
  intentIds: string[],
): Promise<Map<string, ListingOpenQuestion>> {
  const byOpportunity = new Map<string, ListingOpenQuestion>();
  if (!host || intentIds.length === 0) return byOpportunity;
  for (const intentId of intentIds) {
    try {
      for (const question of await host.readOpenQuestions(userId, intentId)) {
        if (!byOpportunity.has(question.opportunityId)) byOpportunity.set(question.opportunityId, question);
      }
    } catch (err) {
      logger.warn('Failed to read open questions for negotiation listing', { intentId, err });
    }
  }
  return byOpportunity;
}

/**
 * The park this listed negotiation currently holds, or null.
 *
 * The host's open-question set is authoritative for a park on THIS user's side
 * — it is the record the answer lands against. The classifier is what tells
 * the two remaining cases apart: a park on this user whose question the host
 * could not name (no host wired, or a park the block does not carry), and a
 * park on the counterparty's side, which is narrated but never quoted.
 */
function listingPark(input: {
  userId: string;
  opportunityId: string;
  task: { id: string; state: string; metadata: Record<string, unknown> | null };
  messages: Array<{ senderId: string; parts: unknown[]; taskId?: string | null }>;
  openQuestion: ListingOpenQuestion | undefined;
}): NegotiationParkNarration | null {
  const { userId, opportunityId, task, messages, openQuestion } = input;
  if (task.state === 'input_required') {
    const classification = classifyInflightPark(task, { opportunityId, userId });
    if (classification.kind === 'wrong_recipient') return { waitingOn: 'counterparty', kind: 'mid_flight' };
    if (classification.kind !== 'inflight') return null;
    return {
      waitingOn: 'you',
      kind: 'mid_flight',
      ...(openQuestion ? { question: openQuestion.question, questionLabel: openQuestion.label } : {}),
    };
  }
  if (task.state === 'completed') {
    const classification = classifyPostStallPark(task, messages, { userId });
    if (classification.kind === 'wrong_recipient') return { waitingOn: 'counterparty', kind: 'post_stall' };
    if (classification.kind !== 'post_stall') return null;
    return {
      waitingOn: 'you',
      kind: 'post_stall',
      ...(openQuestion ? { question: openQuestion.question, questionLabel: openQuestion.label } : {}),
    };
  }
  return null;
}

/**
 * Creates negotiation MCP tools for external agent access.
 * Exposes negotiation state for listing, reading, and responding to bilateral negotiations.
 */
export function createNegotiationTools(defineTool: DefineTool, deps: NegotiationToolDeps) {
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
      '- `input_required` — The negotiation is PARKED on a person’s answer. Read `park` for whose.\n' +
      '- `completed` — The agent negotiation has concluded (agent-side accept/reject, or turn cap). This is not a completed connection or an owner decision.\n\n' +
      '**Parked negotiations:** A negotiation that is waiting on a person carries a `park` object (`waitingOn: "you" | "counterparty"`, and for the ' +
      'user’s own side the open question’s `question` number and `questionLabel`). It comes from the SAME open-question record that the ' +
      'open-questions section of your context is built from and that `answer_pending_question` routes against, so the numbers are the same numbers ' +
      'and neither surface overrides the other. `park.waitingOn="you"` means the user has something to answer RIGHT NOW — say so, whatever the ' +
      'opportunity status reads. Opportunity status does not settle this: a parked pairing is still `negotiating`, so `negotiating` alone never means ' +
      '"nothing is waiting on you". A `park` on the counterparty’s side names no question content; that question is not this user’s to read.\n\n' +
      '**Lifecycle narration:** Every result includes additive `lifecycle` fields that distinguish the agent-negotiation state, ' +
      'current opportunity status, and persisted owner acceptance. Agent-side `accept` means only that agents found a potential match; ' +
      '`pending` still awaits owner review. When the negotiation is parked, `lifecycle.lifecycleLabel` states the park (it supersedes the ' +
      'status label) and `lifecycle.connectionState` is `parked_awaiting_your_answer` or `parked_awaiting_counterparty`. ' +
      '`directConversationEvidence` is `not_provided`, so this tool never establishes that an H2H message thread exists.\n\n' +
      '**Answering a park:** when `park.waitingOn` is "you", relay the question to the user and route their answer with ' +
      '`answer_pending_question` (negotiationId + the `park.question` number). Nothing else resumes a parked negotiation.\n\n' +
      '**External turns:** a turn submitted through this surface (respond_to_negotiation) or the REST respond endpoint is NOT run ' +
      'through the negotiation graph\'s conclusion floor, decline law, or copy-loop guard — those protections apply only to graph-run turns. ' +
      'Do not describe external turns as protected by them.\n\n' +
      '**When to use:** To see ongoing and past negotiations, check which negotiations need attention, ' +
      'or find a negotiation ID for get_negotiation or respond_to_negotiation.',
    querySchema: z.object({
      status: z.enum(['active', 'waiting_for_agent', 'input_required', 'completed', 'all']).optional()
        .describe(
          'Filter by negotiation status. Omit or use "all" to return all negotiations. '
          + '"input_required" returns the negotiations parked mid-flight on a person\'s answer — read `park` for whose. '
          + 'A post-stall park lives on a "completed" negotiation and carries a `park` object there; it is not returned by this filter.',
        ),
      scope: z.enum(['signal', 'all']).optional()
        .describe('Scope to the pinned signal (requires an intent-pinned session), or pass "all" for the full negotiation history.'),
      since: z.string().datetime().optional()
        .describe('ISO 8601 date-time. Only return negotiations created at or after this timestamp.'),
      limit: z.number().int().min(1).max(100).optional()
        .describe('Maximum negotiations to return per page (1-100). Omit to return all.'),
      page: z.number().int().min(1).optional()
        .describe('Page number (1-based). Only used when limit is provided. Defaults to 1.'),
      detail: z.enum(['summary', 'narrative']).optional()
        .describe(
          'Response detail level. Omit or use "summary" for the default fields. ' +
          'Use "narrative" to receive additional context per negotiation suitable for ' +
          'composing a digest or field report: indexContext (the community/network prompt ' +
          'that seeded the negotiation), recentTurns (last 3 turns with action + message), ' +
          'and outcome (for completed negotiations). These fields are populated from data ' +
          'already loaded for the listing, so the extra cost is minimal.',
        ),
    }),
    handler: async ({ context, query }) => {
      try {
        // Map tool status filter to task state query
        const stateFilter = query.status && query.status !== 'all' ? query.status : undefined;
        // For 'active', query 'working' state tasks
        const dbState = stateFilter === 'active' ? 'working'
          : stateFilter === 'waiting_for_agent' ? 'waiting_for_agent'
          : stateFilter === 'input_required' ? 'input_required'
          : stateFilter === 'completed' ? 'completed'
          : undefined;

        const tasks = await negotiationDatabase.getTasksForUser(context.userId, dbState ? { state: dbState } : undefined);
        const opportunityIds = [...new Set(tasks
          .map((task) => (task.metadata as { opportunityId?: unknown } | null)?.opportunityId)
          .filter((opportunityId): opportunityId is string => typeof opportunityId === 'string' && opportunityId.trim().length > 0)
          .map((opportunityId) => opportunityId.trim()))];
        const opportunityLifecycles = await readOpportunityLifecycles(
          negotiationDatabase,
          opportunityIds,
          context.userId,
        );
        const scopedNetworkId = focusedNetworkId(context);
        const pinnedIntentId = focusedIntentId(context);
        const effectiveScope = query.scope ?? (pinnedIntentId ? 'signal' : 'all');
        if (effectiveScope === 'signal' && !pinnedIntentId) {
          return error('Signal scope requires a pinned intent.');
        }

        // Resolved for the signal-scope filter, and — whenever the park host is
        // wired — for park annotation in every scope: a pairing parked on the
        // client is just as misread in the full-history view.
        const parkHost = deps.negotiationListingPark;
        const signalIntentIdsByOpportunity = effectiveScope === 'signal' || parkHost
          ? await negotiationDatabase.getIntentIdsForOpportunities(opportunityIds, context.userId)
          : null;
        const scopeMetadata = effectiveScope === 'signal'
          ? { scope: 'signal' as const, intentId: pinnedIntentId! }
          : { scope: 'all' as const };

        const annotatedIntentIds = effectiveScope === 'signal'
          ? [pinnedIntentId!]
          : [...new Set(Object.values(signalIntentIdsByOpportunity ?? {})
            .filter((intentId): intentId is string => typeof intentId === 'string' && intentId.length > 0))];
        const openQuestionsByOpportunity = await readListingOpenQuestions(
          parkHost,
          context.userId,
          annotatedIntentIds,
        );

        const negotiations = await Promise.all(tasks.map(async (task) => {
          const meta = task.metadata as {
            sourceUserId?: string;
            candidateUserId?: string;
            type?: string;
            maxTurns?: number;
            opportunityId?: string;
            networkId?: string;
            turnContext?: { indexContext?: { networkId?: string; prompt?: string } };
            isContinuation?: boolean;
            priorTurnCount?: number;
          } | null;
          if (meta?.type !== 'negotiation') return null;

          // Network-scope filter: when caller's API key carries a network-bound
          // agent, drop tasks whose network differs (or whose network we cannot
          // determine — defense in depth for legacy tasks).
          if (scopedNetworkId) {
            const taskNetworkId = readTaskNetworkId(meta);
            if (taskNetworkId !== scopedNetworkId) return null;
          }

          // Intent-scope filter: a pinned negotiator workspace only shows
          // opportunity-bound tasks whose actor intent belongs to this user and
          // matches the pinned signal. Tasks without resolvable provenance are
          // dropped rather than widened into the user's full history.
          const opportunityId = typeof meta.opportunityId === 'string' ? meta.opportunityId.trim() : '';
          if (effectiveScope === 'signal'
            && (!opportunityId || signalIntentIdsByOpportunity?.[opportunityId] !== pinnedIntentId)) {
            return null;
          }

          const isSource = meta.sourceUserId === context.userId;
          const counterpartyId = isSource ? meta.candidateUserId : meta.sourceUserId;

          // This negotiation's own turns: the preview, turn count and floor all
          // describe THIS match, and the pair's DM also holds other matches.
          const messages = await readNegotiationMessages({
            byNegotiation: (id) => negotiationDatabase.getNegotiationMessages(id),
            byConversation: (id) => negotiationDatabase.getMessagesForConversation(id),
          }, { conversationId: task.conversationId, metadata: meta });
          const lastMessage = messages[messages.length - 1];
          const lastTurnData = lastMessage
            ? ((lastMessage.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data')?.data as { action?: string; assessment?: { reasoning?: string }; message?: string | null } | undefined)
            : undefined;

          const turnCount = messages.length;
          const expectedSpeaker = expectedNegotiationSpeaker(meta, messages);

          // Map task state to tool status
          const status = task.state === 'working' ? 'active'
            : task.state === 'waiting_for_agent' ? 'waiting_for_agent'
            : task.state === 'completed' ? 'completed'
            : task.state;

          const isUsersTurn = status !== 'completed' && expectedSpeaker === context.userId;

          // #1472: whether this pairing is parked, and on whose side. Derived
          // from the task and messages already in hand through the canonical
          // park predicate; the question's number and label come from the
          // question record via the host, never from a second enumeration.
          const park = opportunityId
            ? listingPark({
              userId: context.userId,
              opportunityId,
              task,
              messages,
              openQuestion: openQuestionsByOpportunity.get(opportunityId),
            })
            : null;

          const base = {
            id: task.id,
            counterpartyId: counterpartyId ?? 'unknown',
            role: isSource ? 'source' : 'candidate',
            turnCount,
            status,
            isUsersTurn,
            isContinuation: meta.isContinuation ?? false,
            priorTurnCount: meta.priorTurnCount ?? 0,
            latestAction: lastTurnData?.action ?? null,
            latestActionActor: 'agent' as const,
            latestMessagePreview: lastTurnData?.message ?? null,
            // Top-level and inside `lifecycle` both, deliberately: a park is
            // the first thing that must be true about a pairing that has one,
            // and it must not depend on the reader opening a nested object.
            ...(park ? { park: { ...park, label: parkLifecycleLabel(park) } } : {}),
            lifecycle: buildLifecycleNarration(status, opportunityLifecycles[opportunityId], park ?? undefined),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          };

          if (query.detail !== 'narrative') return base;

          // ── Narrative extras (messages already loaded — no extra DB cost) ──

          const RECENT_TURNS_LIMIT = 3;
          const recentMessages = messages.slice(-RECENT_TURNS_LIMIT);
          const recentTurns = recentMessages.map((m, sliceIdx) => {
            const absoluteIdx = messages.length - recentMessages.length + sliceIdx;
            const speaker = m.senderId
              ? (m.senderId === `agent:${meta.sourceUserId}` ? 'source' : 'candidate')
              : (absoluteIdx % 2 === 0 ? 'source' : 'candidate');
            const td = ((m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data')?.data as { action?: string; message?: string | null } | undefined);
            return {
              turnNumber: absoluteIdx + 1,
              speaker,
              role: speaker === (isSource ? 'source' : 'candidate') ? 'own' : 'other',
              action: td?.action ?? 'unknown',
              actionActor: 'agent' as const,
              message: td?.message ?? null,
            };
          });

          const indexContext = meta.turnContext?.indexContext ?? null;

          // Outcome artifact — only meaningful for completed negotiations
          let outcome: unknown = null;
          if (status === 'completed') {
            const artifacts = await negotiationDatabase.getArtifactsForTask(task.id);
            const outcomeArtifact = artifacts.find(a => a.name === 'negotiation-outcome');
            outcome = outcomeArtifact
              ? ((outcomeArtifact.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data')?.data ?? null)
              : null;
          }

          return { ...base, indexContext, recentTurns, outcome };
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
            ...scopeMetadata,
            count: paged.length,
            totalCount: filtered.length,
            limit,
            page,
            totalPages: Math.ceil(filtered.length / limit),
            negotiations: paged,
          });
        }

        return success({
          ...scopeMetadata,
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
      '**Statuses:** `active` — in progress. `waiting_for_agent` — waiting for an agent response or timeout. ' +
      '`input_required` — PARKED on a person\'s answer; read `park` for whose. `completed` — the agents concluded, not that the owner accepted or a connection/message thread exists.\n\n' +
      '**Parked negotiations:** A negotiation waiting on a person carries a `park` object (`waitingOn: "you" | "counterparty"`, and for the ' +
      'user\'s own side the open question\'s `question` number and `questionLabel`, from the SAME record `answer_pending_question` routes against). ' +
      'When the negotiation is parked, `lifecycle.lifecycleLabel` states the park (it supersedes the status label) — `park.waitingOn="you"` means the user has ' +
      'something to answer RIGHT NOW, whatever the opportunity status reads; route their answer with `answer_pending_question`. A `park` on the ' +
      'counterparty\'s side names no question content. Turns carrying an `ask_user` consult include the persisted `askUser` payload (question, dimension, answerhood) ' +
      'and the `checklist` the turn scored, so the consult\'s dimensions and `settles` declarations are visible.\n\n' +
      '**Lifecycle narration:** The additive `lifecycle` object is authoritative for user-facing wording. A turn action of `accept` is agent-side; ' +
      'only `lifecycle.ownerAction=accepted` records this owner as the human acceptor. `conversationType=agent_negotiation` identifies the returned ' +
      'conversationId as the A2A negotiation transcript; this result does not provide H2H conversation evidence.\n\n' +
      '**External turns:** turns submitted through respond_to_negotiation or the REST respond endpoint are NOT run through the negotiation graph\'s ' +
      'conclusion floor, decline law, or copy-loop guard; do not imply those protections for them.\n\n' +
      '**When to use:** To review the full negotiation history before responding, to understand why the agents ' +
      'accepted or rejected a potential match, or to see the current state of an active negotiation.\n\n' +
      '**Negotiation-turn-mode usage.** If you are running as a silent background subagent (dispatched by the ' +
      "openclaw runtime's poller in response to a claimed negotiation turn), call this tool FIRST with the " +
      'negotiationId from your task prompt. This returns the current state, both parties\' context, and the ' +
      'history of turns so far. Ground your response in the caller\'s profile (read_user_contexts) and intents ' +
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
          initiatorUserId?: string;
          protocolVersion?: string;
          type?: string;
          maxTurns?: number;
          opportunityId?: string;
          networkId?: string;
          isContinuation?: boolean;
          priorTurnCount?: number;
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
        const scopedNetworkId = focusedNetworkId(context);
        if (scopedNetworkId) {
          const taskNetworkId = readTaskNetworkId(meta);
          if (taskNetworkId !== scopedNetworkId) {
            return error(SCOPE_DENIAL);
          }
        }

        // Access control: user must be source or candidate
        const isSource = meta.sourceUserId === context.userId;
        const isCandidate = meta.candidateUserId === context.userId;
        if (!isSource && !isCandidate) {
          return error('Access denied: you are not a party to this negotiation.');
        }

        const detail = await readAuthorizedNegotiationDetail({
          task,
          metadata: meta,
          callerUserId: context.userId,
          callerRole: isSource ? 'source' : 'candidate',
          readMessages: (conversationId) => readNegotiationMessages({
            byNegotiation: (id) => negotiationDatabase.getNegotiationMessages(id),
            byConversation: (id) => negotiationDatabase.getMessagesForConversation(id),
          }, { conversationId, metadata: meta }),
          readArtifacts: (taskId) => negotiationDatabase.getArtifactsForTask(taskId),
          readLifecycleEvidence: (opportunityIds, ownerUserId) =>
            readOpportunityLifecycles(negotiationDatabase, opportunityIds, ownerUserId),
          // #1472, one level down: the open question's number and label come
          // from the same host record the listing and `answer_pending_question`
          // read — resolved through the caller's own actor intent, so a park on
          // the counterparty's side can never be quoted here.
          readOpenQuestion: async (opportunityId) => {
            const parkHost = deps.negotiationListingPark;
            if (!parkHost) return undefined;
            try {
              const intentIds = await negotiationDatabase.getIntentIdsForOpportunities([opportunityId], context.userId);
              const intentId = intentIds[opportunityId];
              if (!intentId) return undefined;
              const openQuestions = await parkHost.readOpenQuestions(context.userId, intentId);
              return openQuestions.find((question) => question.opportunityId === opportunityId);
            } catch (openErr) {
              logger.warn('Failed to read open question for negotiation detail', { opportunityId, err: openErr });
              return undefined;
            }
          },
        });
        return success(detail);
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
      '**Valid actions depend on the negotiation protocol version and your seat** — call get_negotiation first: ' +
      'its `seat`, `protocolVersion`, and `allowedActions` fields tell you exactly what you may submit.\n\n' +
      '**v1 negotiations (legacy):** `propose | accept | reject | counter | question` — on the first turn the action MUST be `propose`.\n\n' +
      '**v2 negotiations (client-advocate seat rules):**\n' +
      '- Initiator seat (`outreach | counter | question | withdraw`): you reached out — you can NEVER accept. ' +
      '`outreach` opens the negotiation; `withdraw` ends it without an opportunity.\n' +
      '- Counterparty seat (`accept | decline | counter | question`): only your seat can `accept` (finalizes an opportunity); ' +
      '`decline` ends the negotiation without one.\n\n' +
      '- `counter` — Counter with a message (message is required). The negotiation continues.\n' +
      '- `question` — Ask the other side a clarifying question (message is required). The negotiation continues.\n\n' +
      '**What happens after:** Terminal actions (accept/reject/withdraw/decline) finalize the negotiation immediately. ' +
      'Counter/question continues — if the counterparty has an agent, the negotiation yields again; otherwise the AI agent responds inline.\n\n' +
      '**What this surface does NOT run:** turns submitted here are NOT run through the negotiation graph\'s conclusion floor ' +
      '(the checklist gate an in-graph accept must clear), the decline law, or the copy-loop guard. Those protections apply only to ' +
      'graph-run turns; a turn submitted here is persisted as given. Do not tell the user those checks were applied, and do not submit ' +
      'ask_user/checklist payloads through this tool — it does not carry them.\n\n' +
      '**Silent-subagent response contract.** In negotiation-turn mode, submit exactly ONE call to this tool ' +
      'per dispatch with an action from your seat\'s allowed set and the assessment (reasoning + suggestedRoles). ' +
      'If the decision is ambiguous, pick the most conservative action — usually `counter` with specific objections. ' +
      'Do not ask the user clarifying questions; you are authorized to act on their behalf within the scope granted to your agent.',
    querySchema: z.object({
      negotiationId: z.string().describe('The negotiation task ID to respond to.'),
      action: z.enum(NEGOTIATION_ACTIONS).describe('The response action. Must be within your seat\'s allowedActions (see get_negotiation). v1 first turn MUST be "propose"; v2 initiator first turn MUST be "outreach".'),
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
          initiatorUserId?: string;
          opportunityId?: string;
          protocolVersion?: string;
          type?: string;
          maxTurns?: number;
          networkId?: string;
          turnContext?: { indexContext?: { networkId?: string } };
          negotiationParkGeneration?: string;
          continuationExecution?: {
            priorTaskId: string;
            settlementId: string;
            successorTaskId: string;
            token: string;
            fence: number;
          };
        } | null;
        if (meta?.type !== 'negotiation') {
          return error('Negotiation not found.');
        }
        const timeoutContinuation = meta.continuationExecution
          ? {
              priorTaskId: meta.continuationExecution.priorTaskId,
              settlementId: meta.continuationExecution.settlementId,
              successorTaskId: meta.continuationExecution.successorTaskId,
              token: meta.continuationExecution.token,
              fence: meta.continuationExecution.fence,
            }
          : undefined;

        // Network-scope check (mirrors get_negotiation): a network-bound agent
        // must not act on negotiations outside its bound network.
        const scopedNetworkId = focusedNetworkId(context);
        if (scopedNetworkId) {
          const taskNetworkId = readTaskNetworkId(meta);
          if (taskNetworkId !== scopedNetworkId) {
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

        // Seat + version validation (v2 client-advocate): the submitted action
        // must be within the caller's seat vocabulary. v1 tasks accept the
        // legacy vocabulary unchanged (grandfathered).
        const protocolVersion = readProtocolVersion(meta) ?? 'v1';
        const seat = resolveSeat(context.userId, meta);
        if (!allowedActionsFor(protocolVersion, seat).includes(query.action)) {
          return error(seatViolationMessage(query.action, seat, protocolVersion));
        }

        const messages = await readNegotiationMessages({
          byNegotiation: (id) => negotiationDatabase.getNegotiationMessages(id),
          byConversation: (id) => negotiationDatabase.getMessagesForConversation(id),
        }, { conversationId: task.conversationId, metadata: meta });
        const turnCount = messages.length;
        const expectedSpeaker = expectedNegotiationSpeaker(meta, messages);

        if (expectedSpeaker !== context.userId) {
          return error('It is not your turn to respond in this negotiation.');
        }

        // The caller is the current speaker (verified above).
        const currentSpeaker: 'source' | 'candidate' = isSource ? 'source' : 'candidate';

        // Validate counter/question has a message
        if ((query.action === 'counter' || query.action === 'question') && !query.message?.trim()) {
          return error(`A message is required when using "${query.action}". Explain what you want to change or clarify.`);
        }

        // ── Cancel pending timeout ──
        if (deps.negotiationTimeoutQueue && meta.negotiationParkGeneration) {
          await deps.negotiationTimeoutQueue.cancelTimeout(task.id, meta.negotiationParkGeneration);
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

        // ── Handle terminal actions (accept / reject / withdraw / decline): finalize immediately ──
        if (isTerminalAction(query.action)) {
          const allMessages = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
          const history: NegotiationTurn[] = turnsFromMessages(allMessages);

          const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
          const outcome = buildNegotiationOutcome(history, newTurnCount, query.action, meta.sourceUserId!, meta.candidateUserId!, nextSpeaker);

          await concludeNegotiation(negotiationDatabase, {
            taskId: task.id,
            ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
            lastAction: query.action,
            outcome,
            turnCount: newTurnCount,
          });

          return success({
            message: query.action === 'accept'
              ? 'Negotiation accepted. An opportunity has been created.'
              : query.action === 'withdraw'
                ? 'Negotiation withdrawn.'
                : query.action === 'decline'
                  ? 'Negotiation declined.'
                  : 'Negotiation rejected.',
            negotiationId: task.id,
            action: query.action,
            turnNumber: newTurnCount,
            outcome,
          });
        }

        // ── Handle counter/question: check if under max turns ──
        if (isNegotiationTurnCapReached(newTurnCount, meta.maxTurns)) {
          // Max turns reached — finalize with turn_cap
          const allMessages = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
          const history: NegotiationTurn[] = turnsFromMessages(allMessages);

          const nextSpeakerForCap = currentSpeaker === 'source' ? 'candidate' : 'source';
          const outcome = buildNegotiationOutcome(history, newTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, nextSpeakerForCap);

          await concludeNegotiation(negotiationDatabase, {
            taskId: task.id,
            ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
            lastAction: 'counter',
            outcome,
            turnCount: newTurnCount,
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
        const counterpartySeat = resolveSeat(counterpartyUserId, meta);

        // Build the current turn history for dispatcher payload
        const allMessagesWithTurn = [...messages, { id: turnMessage.id, senderId: turnMessage.senderId, role: turnMessage.role, parts: turnMessage.parts as unknown[], createdAt: turnMessage.createdAt }];
        const historyForDispatch: NegotiationTurn[] = turnsFromMessages(allMessagesWithTurn);

        const isFinalTurn = isNegotiationTurnCapReached(newTurnCount + 1, meta.maxTurns);

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
          seat: counterpartySeat,
          protocolVersion,
          allowedActions: [...allowedActionsFor(protocolVersion, counterpartySeat, isFinalTurn)],
          ...(timeoutContinuation ? { timeoutContinuation } : {}),
        };

        const scope = { action: 'negotiation.respond', scopeType: 'negotiation', scopeId: task.id };
        const timeoutMs = AMBIENT_PARK_WINDOW_MS;

        const dispatchResult = await deps.agentDispatcher?.dispatch(counterpartyUserId, scope, dispatchPayload, { timeoutMs });

        if (dispatchResult?.handled === false && dispatchResult.reason === 'waiting') {
          // The dispatcher armed this exact generation before acknowledging;
          // persist that same token with the waiting state.
          await negotiationDatabase.updateTaskState(
            task.id,
            'waiting_for_agent',
            undefined,
            undefined,
            dispatchResult.resumeToken,
          );

          return success({
            message: `${query.action === 'question' ? 'Question' : query.action === 'propose' ? 'Proposal' : query.action === 'outreach' ? 'Outreach' : 'Counter-proposal'} submitted. Waiting for counterparty response.`,
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
              seat: counterpartySeat,
              protocolVersion,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const errName = (err as { name?: string })?.name ?? '';
            const isTimeout = errName === 'TimeoutError' || /timeout|abort/i.test(errMsg);
            // Log the raw error for ops, but keep the persisted/returned
            // reasoning generic — this string round-trips back to the caller
            // via counterpartyResponse.reasoning and ends up in the negotiation
            // history visible through get_negotiation, so we don't want raw
            // provider messages (URLs, request IDs, internal stack hints) on
            // the wire.
            logger.warn('System negotiator inline invoke failed; treating as reject', {
              taskId: task.id,
              isTimeout,
              error: errMsg,
            });
            aiTurn = {
              action: rejectActionFor(protocolVersion, counterpartySeat),
              assessment: {
                reasoning: isTimeout
                  ? 'Negotiator response timed out.'
                  : 'Negotiator failed to produce a response.',
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
        if (isTerminalAction(aiTurn.action)) {
          const fullHistory = [...historyForDispatch, aiTurn];
          const outcome = buildNegotiationOutcome(fullHistory, finalTurnCount, aiTurn.action, meta.sourceUserId!, meta.candidateUserId!, counterpartySpeaker === 'source' ? 'candidate' : 'source');

          await concludeNegotiation(negotiationDatabase, {
            taskId: task.id,
            ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
            lastAction: aiTurn.action,
            outcome,
            turnCount: finalTurnCount,
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
        if (isNegotiationTurnCapReached(finalTurnCount, meta.maxTurns)) {
          const fullHistory = [...historyForDispatch, aiTurn];
          const outcome = buildNegotiationOutcome(fullHistory, finalTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, counterpartySpeaker === 'source' ? 'candidate' : 'source');

          await concludeNegotiation(negotiationDatabase, {
            taskId: task.id,
            ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
            lastAction: 'counter',
            outcome,
            turnCount: finalTurnCount,
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
          isFinalTurn: isNegotiationTurnCapReached(finalTurnCount + 1, meta.maxTurns),
          isDiscoverer: true,
          seat,
          protocolVersion,
          allowedActions: [...allowedActionsFor(protocolVersion, seat, isNegotiationTurnCapReached(finalTurnCount + 1, meta.maxTurns))],
          ...(timeoutContinuation ? { timeoutContinuation } : {}),
        };

        const userDispatchResult = await deps.agentDispatcher?.dispatch(context.userId, scope, userDispatchPayload, { timeoutMs });

        if (!userDispatchResult || (userDispatchResult.handled === false && userDispatchResult.reason === 'no_agent')) {
          // No agent for user — arm and persist one exact generation so they
          // can still use respond_to_negotiation while fallback is bounded.
          const parkGeneration = crypto.randomUUID();
          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(
              task.id,
              finalTurnCount,
              timeoutMs,
              parkGeneration,
              timeoutContinuation,
            );
          }
          await negotiationDatabase.updateTaskState(
            task.id,
            'waiting_for_agent',
            undefined,
            undefined,
            parkGeneration,
          );

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
          // The dispatcher armed this exact generation before acknowledging.
          await negotiationDatabase.updateTaskState(
            task.id,
            'waiting_for_agent',
            undefined,
            undefined,
            userDispatchResult.resumeToken,
          );

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

          if (isTerminalAction(userAgentTurn.action)) {
            const fullHistory = [...historyForDispatch, aiTurn, userAgentTurn];
            const userSpeaker = isSource ? 'source' : 'candidate';
            const outcome = buildNegotiationOutcome(fullHistory, userTurnCount, userAgentTurn.action, meta.sourceUserId!, meta.candidateUserId!, userSpeaker === 'source' ? 'candidate' : 'source');

            await concludeNegotiation(negotiationDatabase, {
              taskId: task.id,
              ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
              lastAction: userAgentTurn.action,
              outcome,
              turnCount: userTurnCount,
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

          if (isNegotiationTurnCapReached(userTurnCount, meta.maxTurns)) {
            const fullHistory = [...historyForDispatch, aiTurn, userAgentTurn];
            const outcome = buildNegotiationOutcome(fullHistory, userTurnCount, 'counter', meta.sourceUserId!, meta.candidateUserId!, isSource ? 'candidate' : 'source');

            await concludeNegotiation(negotiationDatabase, {
              taskId: task.id,
              ...(meta.opportunityId ? { opportunityId: meta.opportunityId } : {}),
              lastAction: 'counter',
              outcome,
              turnCount: userTurnCount,
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

          // User's agent countered/questioned — arm one exact generation for
          // the counterparty's next turn.
          const parkGeneration = crypto.randomUUID();
          if (deps.negotiationTimeoutQueue) {
            await deps.negotiationTimeoutQueue.enqueueTimeout(
              task.id,
              userTurnCount,
              timeoutMs,
              parkGeneration,
              timeoutContinuation,
            );
          }
          await negotiationDatabase.updateTaskState(
            task.id,
            'waiting_for_agent',
            undefined,
            undefined,
            parkGeneration,
          );

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
  // Non-terminal last action at finalization means the turn cap was hit.
  const atCap = !isTerminalAction(lastAction);

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
