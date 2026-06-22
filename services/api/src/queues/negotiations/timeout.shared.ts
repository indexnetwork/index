import { IndexNegotiator } from '@indexnetwork/protocol';
import type { NegotiationTurn, NegotiationOutcome, UserNegotiationContext, SeedAssessment, NegotiationGraphDatabase } from '@indexnetwork/protocol';

import { log } from '../../lib/log';

type TimeoutLogger = ReturnType<typeof log.job.from>;

/** Negotiation task metadata both timeout workers read off `task.metadata`. */
export interface NegotiationTaskMeta {
  sourceUserId?: string;
  candidateUserId?: string;
  type?: string;
  maxTurns?: number;
  opportunityId?: string;
}

/** Per-worker log strings — the only textual difference between the two timeout workers. */
export interface TimeoutFallbackLabels {
  /** Bracketed job tag, e.g. `[NegotiationTimeoutJob]`. */
  job: string;
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
  messages: Array<{ parts: unknown[] }>;
  currentTurnCount: number;
  seedReasoning: string;
  maxTurns: number;
  /** Extra fields merged into the "running AI fallback" log (claim worker adds `agentId`). */
  fallbackLogExtra?: Record<string, unknown>;
  /** Re-arm the next park-window timeout when the AI counters under the cap. */
  rearm: (newTurnCount: number) => Promise<void>;
}): Promise<void> {
  const {
    database, logger, labels, negotiationId, taskId, conversationId,
    meta, messages, currentTurnCount, seedReasoning, maxTurns, fallbackLogExtra, rearm,
  } = params;

  // Determine whose turn it is
  const currentSpeaker = currentTurnCount % 2 === 0 ? 'source' : 'candidate';
  const isSource = currentSpeaker === 'source';
  const activeUserId = isSource ? meta.sourceUserId! : meta.candidateUserId!;
  const otherUserId = isSource ? meta.candidateUserId! : meta.sourceUserId!;

  logger.info(`${labels.job} ${labels.fallback}`, {
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
  const agent = new IndexNegotiator();
  const ownUserCtx: UserNegotiationContext = { id: activeUserId, intents: [], profile: {} };
  const otherUserCtx: UserNegotiationContext = { id: otherUserId, intents: [], profile: {} };
  const seedAssessment: SeedAssessment = { reasoning: seedReasoning, valencyRole: 'peer' };

  const aiTurn = await agent.invoke({
    ownUser: ownUserCtx,
    otherUser: otherUserCtx,
    indexContext: { networkId: '', prompt: '' },
    seedAssessment,
    history,
    isDiscoverer: isSource,
  });

  // Persist the AI turn
  await database.createMessage({
    conversationId,
    senderId: `agent:${activeUserId}`,
    role: 'agent',
    parts: [{ kind: 'data' as const, data: aiTurn }],
    taskId,
  });

  const newTurnCount = currentTurnCount + 1;

  // Evaluate: accept/reject → finalize; counter at max → finalize; counter under max → continue
  if (aiTurn.action === 'accept' || aiTurn.action === 'reject' || newTurnCount >= maxTurns) {
    const fullHistory = [...history, aiTurn];
    const nextSpeaker = currentSpeaker === 'source' ? 'candidate' : 'source';
    const outcome = buildNegotiationOutcome(fullHistory, newTurnCount, aiTurn.action, meta.sourceUserId!, meta.candidateUserId!, nextSpeaker);

    await database.updateTaskState(taskId, 'completed');
    await database.createArtifact({
      taskId,
      name: 'negotiation-outcome',
      parts: [{ kind: 'data', data: outcome }],
      metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount },
    });

    const outcomeStr = aiTurn.action === 'accept' ? 'accepted'
      : aiTurn.action === 'reject' ? 'rejected'
      : 'turn_cap';

    const opportunityId = meta.opportunityId;
    if (opportunityId) {
      const nextStatus = aiTurn.action === 'accept' ? 'pending'
        : aiTurn.action === 'reject' ? 'rejected'
        : 'stalled';
      await database.updateOpportunityStatus(opportunityId, nextStatus).catch((err: unknown) => {
        logger.error(`${labels.job} ${labels.statusUpdateFailed}`, {
          opportunityId,
          nextStatus,
          error: err,
        });
      });
    }

    logger.info(`${labels.job} ${labels.finalized}`, {
      negotiationId,
      outcome: outcomeStr,
      turnCount: newTurnCount,
    });
    return;
  }

  // AI countered and under max turns — the other party now needs to respond.
  await database.updateTaskState(taskId, 'waiting_for_agent');
  await rearm(newTurnCount);

  logger.info(`${labels.job} AI agent countered, armed timeout for next speaker`, {
    negotiationId,
    action: aiTurn.action,
    turnCount: newTurnCount,
  });
}
