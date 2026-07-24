import type { NegotiationGraphDatabase, NegotiationOutcome, NegotiationProtocolVersion, NegotiationTurn, SeedAssessment, UserNegotiationContext } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import type { ContinuationExecutionFence } from '../../adapters/negotiation-continuation.atomic';

type TimeoutLogger = ReturnType<typeof log.job.from>;

type NegotiationSeat = 'initiator' | 'counterparty';

export type TimeoutNegotiatorInvoke = (input: {
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
  isDiscoverer: boolean;
  seat: NegotiationSeat;
  protocolVersion: NegotiationProtocolVersion;
  isFinalTurn?: boolean;
}) => Promise<NegotiationTurn>;

function isTerminalAction(action: string): boolean {
  return action === 'accept' || action === 'reject' || action === 'withdraw' || action === 'decline';
}

function isRejectLikeAction(action: string): boolean {
  return action === 'reject' || action === 'withdraw' || action === 'decline';
}

function readProtocolVersion(meta: NegotiationTaskMeta | null): NegotiationProtocolVersion | null {
  return meta?.protocolVersion === 'v2' ? 'v2' : meta?.protocolVersion === 'v1' ? 'v1' : null;
}

function resolveSeat(userId: string, meta: NegotiationTaskMeta | null): NegotiationSeat {
  return (meta?.initiatorUserId || meta?.sourceUserId) === userId ? 'initiator' : 'counterparty';
}

const defaultInvokeNegotiator: TimeoutNegotiatorInvoke = async (input) => {
  const { IndexNegotiator } = await import('@indexnetwork/protocol');
  return new IndexNegotiator().invoke(input);
};

/** Negotiation task metadata both timeout workers read off `task.metadata`. */
export interface NegotiationTaskMeta {
  sourceUserId?: string;
  candidateUserId?: string;
  /** Rigid initiator seat, stamped at discovery time (v2 client-advocate). */
  initiatorUserId?: string;
  /** Negotiation protocol version; absent on pre-v2 tasks (treated as v1). */
  protocolVersion?: string;
  type?: string;
  maxTurns?: number;
  opportunityId?: string;
  /** ISO timestamp set by the archive backfill on pre-v2 legacy negotiations. */
  archivedAt?: string;
}

/** Per-worker log strings — the only textual difference between the two timeout workers. */
export interface TimeoutFallbackLabels {
  /** "...running AI fallback" line. */
  fallback: string;
  /** "Negotiation finalized after <x>" line. */
  finalized: string;
  /** "Failed to update opportunity status on <x> finalization" error line. */
  statusUpdateFailed: string;
}

/**
 * Build a {@link NegotiationOutcome} from the finalized turn history.
 * Mirrors the graph `finalizeNode` logic; identical across both timeout workers.
 */
export function buildNegotiationOutcome(
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

/**
 * Run the AI fallback turn for a stalled negotiation and evaluate the result.
 *
 * This is the block that was copy-pasted between {@link NegotiationTimeoutQueue}
 * and {@link NegotiationClaimTimeoutQueue}: parse history → run {@link IndexNegotiator}
 * → persist the turn → finalize (accept/reject/turn-cap) or re-arm (counter under cap).
 * The two workers differ only in their log strings, seed reasoning, max-turns source,
 * the extra fallback-log fields, and how the next timeout is re-armed (`rearm`).
 *
 * Callers must have already acquired the task, confirmed the turn count matches, and
 * verified `meta.type === 'negotiation'` before invoking this.
 */
export async function runTimeoutFallback(params: {
  database: NegotiationGraphDatabase;
  logger: TimeoutLogger;
  labels: TimeoutFallbackLabels;
  negotiationId: string;
  taskId: string;
  conversationId: string;
  meta: NegotiationTaskMeta;
  messages: Array<{ parts: unknown[]; senderId?: string }>;
  currentTurnCount: number;
  seedReasoning: string;
  maxTurns: number;
  /** Extra fields merged into the "running AI fallback" log (claim worker adds `agentId`). */
  fallbackLogExtra?: Record<string, unknown>;
  /** Re-arm the next park-window timeout when the AI counters under the cap. */
  rearm: (newTurnCount: number) => Promise<void>;
  /** Injectable negotiator invocation for hermetic queue tests. */
  invokeNegotiator?: TimeoutNegotiatorInvoke;
  /** Present only after a parked/claimed exact continuation was atomically fenced. */
  continuationExecution?: ContinuationExecutionFence;
}): Promise<{ continuationOutcome?: 'accepted' | 'rejected' | 'stalled' | 'waiting_for_agent' }> {
  const {
    database, logger, labels, negotiationId, taskId, conversationId,
    meta, messages, currentTurnCount, seedReasoning, maxTurns, fallbackLogExtra, rearm,
    invokeNegotiator = defaultInvokeNegotiator,
    continuationExecution,
  } = params;

  // Determine whose turn it is from the last message's sender — not parity,
  // which misattributes the parked seat across continuation sessions (a
  // continuation can start with either side speaking first).
  const lastSenderId = messages.length > 0 ? messages[messages.length - 1].senderId : undefined;
  const currentSpeaker = lastSenderId
    ? (lastSenderId === `agent:${meta.sourceUserId}` ? 'candidate' : 'source')
    : (currentTurnCount % 2 === 0 ? 'source' : 'candidate');
  const isSource = currentSpeaker === 'source';
  const activeUserId = isSource ? meta.sourceUserId! : meta.candidateUserId!;
  const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;

  // Seat + version for the parked seat (v2 client-advocate): the system agent
  // taking over this turn must use the seat-scoped schema — an initiator-seat
  // fallback can never accept on the user's behalf. v1 tasks keep the legacy
  // schema and the legacy non-final behavior (no isFinalTurn forcing).
  const protocolVersion = (readProtocolVersion(meta) ?? 'v1') as NegotiationProtocolVersion;
  const seat = resolveSeat(activeUserId, meta);
  const isFinalTurn = protocolVersion === 'v2' && (currentTurnCount + 1) >= maxTurns;

  logger.info(labels.fallback, {
    negotiationId,
    ...fallbackLogExtra,
    activeUserId,
    turnNumber: currentTurnCount,
  });

  // Parse history
  const history: NegotiationTurn[] = messages.map((m: { parts: unknown[] }) => {
    const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(p => p.kind === 'data');
    return dp?.data as NegotiationTurn;
  }).filter(Boolean);

  // Run AI agent for the timed-out turn
  const ownUserCtx: UserNegotiationContext = { id: activeUserId, intents: [], profile: {} };
  const otherUserCtx: UserNegotiationContext = { id: otherUserId, intents: [], profile: {} };
  const seedAssessment: SeedAssessment = { reasoning: seedReasoning, valencyRole: 'peer' };

  const aiTurn = await invokeNegotiator({
    ownUser: ownUserCtx,
    otherUser: otherUserCtx,
    indexContext: { networkId: '', prompt: '' },
    seedAssessment,
    history,
    isDiscoverer: isSource,
    seat,
    protocolVersion,
    ...(isFinalTurn && { isFinalTurn }),
  });

  // Persist the AI turn
  await database.createMessage({
    conversationId,
    senderId: `agent:${activeUserId}`,
    role: 'agent',
    parts: [{ kind: 'data' as const, data: aiTurn }],
    taskId,
    ...(continuationExecution ? { continuationExecution } : {}),
  });

  const newTurnCount = currentTurnCount + 1;

  // Evaluate: terminal action → finalize; counter at max → finalize; counter under max → continue
  if (isTerminalAction(aiTurn.action) || newTurnCount >= maxTurns) {
    const fullHistory = [...history, aiTurn];
    const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
    const outcome = buildNegotiationOutcome(fullHistory, newTurnCount, aiTurn.action, meta.sourceUserId!, meta.candidateUserId!, nextSpeaker);

    if (continuationExecution) await database.updateTaskState(taskId, 'completed', undefined, continuationExecution);
    else await database.updateTaskState(taskId, 'completed');
    const continuationOutcome = aiTurn.action === 'accept' ? 'accepted'
      : isRejectLikeAction(aiTurn.action) ? 'rejected' : 'stalled';
    await database.createArtifact({
      taskId,
      name: 'negotiation-outcome',
      parts: [{ kind: 'data', data: outcome }],
      metadata: {
        hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount,
        ...(continuationExecution ? { continuationOutcome } : {}),
      },
      ...(continuationExecution ? { continuationExecution } : {}),
    });

    const outcomeStr = aiTurn.action === 'accept' ? 'accepted'
      : isRejectLikeAction(aiTurn.action) ? 'rejected'
      : 'turn_cap';

    const opportunityId = meta.opportunityId;
    if (opportunityId) {
      const nextStatus = aiTurn.action === 'accept' ? 'pending'
        : isRejectLikeAction(aiTurn.action) ? 'rejected'
        : 'stalled';
      const updateStatus = continuationExecution
        ? database.updateOpportunityStatus(opportunityId, nextStatus, undefined, continuationExecution)
        : database.updateOpportunityStatus(opportunityId, nextStatus);
      await updateStatus.catch((err: unknown) => {
        logger.error(labels.statusUpdateFailed, {
          opportunityId,
          nextStatus,
          error: err,
        });
      });
    }

    logger.info(labels.finalized, {
      negotiationId,
      outcome: outcomeStr,
      turnCount: newTurnCount,
    });
    return continuationExecution ? { continuationOutcome } : {};
  }

  // AI countered and under max turns — the other party now needs to respond.
  if (continuationExecution) await database.updateTaskState(taskId, 'waiting_for_agent', undefined, continuationExecution);
  else await database.updateTaskState(taskId, 'waiting_for_agent');
  await rearm(newTurnCount);

  logger.info('AI agent countered, armed timeout for next speaker', {
    negotiationId,
    action: aiTurn.action,
    turnCount: newTurnCount,
  });
  return continuationExecution ? { continuationOutcome: 'waiting_for_agent' } : {};
}
