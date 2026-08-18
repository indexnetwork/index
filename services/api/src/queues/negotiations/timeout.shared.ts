import { isNegotiationTurnCapReached, type NegotiationContinuationTimeoutIdentity, type NegotiationGraphDatabase, type NegotiationOutcome, type NegotiationProtocolVersion, type NegotiationTurn, type SeedAssessment, type UserNegotiationContext } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import type { ContinuationExecutionFence } from '../../adapters/negotiation-continuation.atomic';
import { remainingDeadlineDelayMs, type AcquiredNegotiationTimeoutExecution, type NegotiationTimeoutAtomicStep, type NegotiationTimeoutCompletionPlan, type NegotiationTimeoutExecutionStore } from '../../lib/negotiation/timeout-execution';
import { expectedNegotiationSpeaker, readNegotiationMessages } from '../../lib/negotiation/expected-speaker';

type TimeoutLogger = ReturnType<typeof log.job.from>;

/**
 * The parked negotiation's own messages. A timeout resumes ONE match; the pair's
 * shared DM also holds the negotiations they ran for every other match.
 */
export function negotiationMessagesFor(
  database: Pick<NegotiationGraphDatabase, 'getNegotiationMessages' | 'getMessagesForConversation'>,
  task: { conversationId: string; metadata: unknown },
) {
  return readNegotiationMessages({
    byNegotiation: (id) => database.getNegotiationMessages(id),
    byConversation: (id) => database.getMessagesForConversation(id),
  }, {
    conversationId: task.conversationId,
    metadata: task.metadata as { opportunityId?: unknown } | null,
  });
}

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
  /** Stable key for provider tracing/deduplication across Bull redelivery. */
  executionId?: string;
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
  maxTurns?: number | null;
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

export type ResumableTimeoutFaultStep = 'cas' | 'invocation' | NegotiationTimeoutAtomicStep | 'outbox';

/**
 * Resume one durably acquired timeout execution. Invocation output is stored
 * before dialogue persistence; final message/task/artifact/opportunity/
 * continuation effects and the completion receipt commit atomically. A retry
 * therefore starts from pending, invoked, or completed without duplicating a
 * turn or artifact and without relying on the watchdog to rescue `working`.
 */
export async function runResumableTimeoutFallback(params: {
  database: NegotiationGraphDatabase & NegotiationTimeoutExecutionStore;
  acquired: AcquiredNegotiationTimeoutExecution;
  logger: TimeoutLogger;
  labels: TimeoutFallbackLabels;
  negotiationId: string;
  meta: NegotiationTaskMeta;
  messages: Array<{ parts: unknown[]; senderId?: string }>;
  seedReasoning: string;
  maxTurns: number | null | undefined;
  parkWindowMs: number;
  fallbackLogExtra?: Record<string, unknown>;
  invokeNegotiator?: TimeoutNegotiatorInvoke;
  rearm: (
    turnNumber: number,
    parkGeneration: string,
    delayMs: number,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ) => Promise<void>;
  faultAfterStep?: (step: ResumableTimeoutFaultStep) => void | Promise<void>;
  now?: () => number;
}): Promise<void> {
  const {
    database, acquired, logger, labels, negotiationId, meta, messages,
    seedReasoning, maxTurns, parkWindowMs, fallbackLogExtra,
    invokeNegotiator = defaultInvokeNegotiator, rearm, faultAfterStep,
    now = Date.now,
  } = params;
  let execution = acquired.execution;
  const continuationExecution = acquired.continuationExecution;
  await faultAfterStep?.('cas');

  const deliverReceipt = async (): Promise<void> => {
    const receipt = execution.receipt;
    if (!receipt || execution.outboxDeliveredAt) return;
    if (receipt.rearm) {
      await rearm(
        receipt.turnNumber,
        receipt.rearm.parkGeneration,
        remainingDeadlineDelayMs(receipt.rearm.deadlineAt, now()),
        receipt.rearm.continuation,
      );
    }
    await faultAfterStep?.('outbox');
    if (!await database.markNegotiationTimeoutOutboxDelivered(
      execution.taskId,
      execution.executionId,
    )) throw new Error('Timeout execution outbox changed before delivery acknowledgement');
  };

  if (execution.status === 'completed') {
    await deliverReceipt();
    return;
  }

  const currentTurnCount = execution.turnNumber;
  const expectedSpeaker = expectedNegotiationSpeaker(meta, messages);
  if (!expectedSpeaker) throw new Error('Timeout execution has malformed bilateral speaker metadata');
  const currentSpeaker = expectedSpeaker === meta.sourceUserId ? 'source' : 'candidate';
  const isSource = currentSpeaker === 'source';
  const activeUserId = expectedSpeaker;
  const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;
  const protocolVersion = (readProtocolVersion(meta) ?? 'v1') as NegotiationProtocolVersion;
  const seat = resolveSeat(activeUserId, meta);
  const isFinalTurn = protocolVersion === 'v2' && isNegotiationTurnCapReached(currentTurnCount + 1, maxTurns);
  const history: NegotiationTurn[] = messages.map((message) => {
    const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>)
      ?.find((part) => part.kind === 'data');
    return dataPart?.data as NegotiationTurn;
  }).filter(Boolean);

  if (execution.status === 'pending') {
    logger.info(labels.fallback, {
      negotiationId,
      ...fallbackLogExtra,
      activeUserId,
      turnNumber: currentTurnCount,
      executionId: execution.executionId,
    });
    const turn = await invokeNegotiator({
      ownUser: { id: activeUserId, intents: [], profile: {} },
      otherUser: { id: otherUserId, intents: [], profile: {} },
      indexContext: { networkId: '', prompt: '' },
      seedAssessment: { reasoning: seedReasoning, valencyRole: 'peer' },
      history,
      isDiscoverer: isSource,
      seat,
      protocolVersion,
      ...(isFinalTurn ? { isFinalTurn: true } : {}),
      executionId: execution.executionId,
    });
    const recorded = await database.recordNegotiationTimeoutInvocation({
      taskId: execution.taskId,
      executionId: execution.executionId,
      turn,
    });
    if (!recorded) throw new Error('Timeout execution lost before invocation persistence');
    execution = recorded.execution;
    await faultAfterStep?.('invocation');
  }
  if (!execution.turn) throw new Error('Invoked timeout execution has no durable turn');

  const newTurnCount = currentTurnCount + 1;
  const terminal = isTerminalAction(execution.turn.action) || isNegotiationTurnCapReached(newTurnCount, maxTurns);
  const continuationIdentity = continuationExecution
    ? {
        priorTaskId: continuationExecution.taskId,
        settlementId: continuationExecution.settlementId,
        successorTaskId: continuationExecution.successorTaskId,
        token: continuationExecution.token,
        fence: continuationExecution.fence,
      }
    : undefined;
  let plan: NegotiationTimeoutCompletionPlan;
  if (terminal) {
    const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
    const outcome = buildNegotiationOutcome(
      [...history, execution.turn],
      newTurnCount,
      execution.turn.action,
      meta.sourceUserId!,
      meta.candidateUserId!,
      nextSpeaker,
    );
    const continuationOutcome = execution.turn.action === 'accept'
      ? 'accepted'
      : isRejectLikeAction(execution.turn.action) ? 'rejected' : 'stalled';
    const opportunityStatus = execution.turn.action === 'accept'
      ? 'pending'
      : isRejectLikeAction(execution.turn.action) ? 'rejected' : 'stalled';
    plan = {
      executionId: execution.executionId,
      taskId: execution.taskId,
      conversationId: acquired.task.conversationId,
      turn: execution.turn,
      finalState: 'completed',
      turnNumber: newTurnCount,
      outcome: outcome as unknown as Record<string, unknown>,
      ...(meta.opportunityId ? { opportunity: { id: meta.opportunityId, status: opportunityStatus } } : {}),
      ...(continuationExecution ? { continuationOutcome } : {}),
      rearm: null,
    };
  } else {
    // The next generation is deterministic from this exact execution. A replay
    // can only target the same Bull job and can never extend the deadline.
    const parkGeneration = `${execution.executionId}:next`;
    plan = {
      executionId: execution.executionId,
      taskId: execution.taskId,
      conversationId: acquired.task.conversationId,
      turn: execution.turn,
      finalState: 'waiting_for_agent',
      turnNumber: newTurnCount,
      ...(continuationExecution ? { continuationOutcome: 'waiting_for_agent' as const } : {}),
      rearm: {
        parkGeneration,
        parkWindowMs,
        ...(continuationIdentity ? { continuation: continuationIdentity } : {}),
      },
    };
  }

  const completed = await database.completeNegotiationTimeoutExecution(
    plan,
    continuationExecution,
    faultAfterStep
      ? async (step) => faultAfterStep(step)
      : undefined,
  );
  if (!completed) throw new Error('Timeout execution lost before atomic completion');
  execution = completed.execution;
  if (execution.status !== 'completed') throw new Error('Timeout execution did not produce a receipt');
  await deliverReceipt();

  logger.info(terminal ? labels.finalized : 'AI agent countered, armed timeout for next speaker', {
    negotiationId,
    action: execution.turn?.action,
    turnCount: newTurnCount,
    executionId: execution.executionId,
  });
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
  maxTurns: number | null | undefined;
  /** Extra fields merged into the "running AI fallback" log (claim worker adds `agentId`). */
  fallbackLogExtra?: Record<string, unknown>;
  /** Re-arm the next park-window timeout when the AI counters under the cap. */
  rearm: (
    newTurnCount: number,
    parkGeneration: string,
    continuation?: NegotiationContinuationTimeoutIdentity,
  ) => Promise<void>;
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

  // Determine the bilateral speaker from this negotiation's own turn history.
  // Unrelated/system senders do not move the seat; no history means the
  // negotiation has not opened, so the floor sits with its initiator.
  const expectedSpeaker = expectedNegotiationSpeaker(meta, messages);
  if (!expectedSpeaker) throw new Error('Timeout fallback has malformed bilateral speaker metadata');
  const currentSpeaker = expectedSpeaker === meta.sourceUserId ? 'source' : 'candidate';
  const isSource = currentSpeaker === 'source';
  const activeUserId = expectedSpeaker;
  const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;

  // Seat + version for the parked seat (v2 client-advocate): the system agent
  // taking over this turn must use the seat-scoped schema — an initiator-seat
  // fallback can never accept on the user's behalf. v1 tasks keep the legacy
  // schema and the legacy non-final behavior (no isFinalTurn forcing).
  const protocolVersion = (readProtocolVersion(meta) ?? 'v1') as NegotiationProtocolVersion;
  const seat = resolveSeat(activeUserId, meta);
  const isFinalTurn = protocolVersion === 'v2' && isNegotiationTurnCapReached(currentTurnCount + 1, maxTurns);

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
  if (isTerminalAction(aiTurn.action) || isNegotiationTurnCapReached(newTurnCount, maxTurns)) {
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

  // AI countered and under max turns — persist and enqueue the exact same park
  // generation so a redelivered job cannot consume a later re-park.
  const parkGeneration = crypto.randomUUID();
  if (continuationExecution) {
    await database.updateTaskState(
      taskId,
      'waiting_for_agent',
      undefined,
      continuationExecution,
      parkGeneration,
    );
  } else {
    await database.updateTaskState(taskId, 'waiting_for_agent', undefined, undefined, parkGeneration);
  }
  const nextContinuation = continuationExecution
    ? {
        priorTaskId: continuationExecution.taskId,
        settlementId: continuationExecution.settlementId,
        successorTaskId: continuationExecution.successorTaskId,
        token: continuationExecution.token,
        fence: continuationExecution.fence,
      }
    : undefined;
  await rearm(newTurnCount, parkGeneration, nextContinuation);

  logger.info('AI agent countered, armed timeout for next speaker', {
    negotiationId,
    action: aiTurn.action,
    turnCount: newTurnCount,
  });
  return continuationExecution ? { continuationOutcome: 'waiting_for_agent' } : {};
}
