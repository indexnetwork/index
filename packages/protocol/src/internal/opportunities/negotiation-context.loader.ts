/**
 * Negotiation context loader: given an opportunity, fetches the attached
 * negotiation task's transcript so the card presenter can explain *why* the
 * opportunity surfaced.
 *
 * For `draft`, `latent`, and `expired` opportunities, no negotiation has
 * happened (or no longer matters) so the loader returns null.
 */

import type { NegotiationGraphDatabase, OpportunityStatus } from '../../platform/database.js';
import { NEGOTIATION_MAX_TURNS_AMBIENT } from '../../protocol/core.js';
import { NegotiationTurnSchema, type NegotiationTurn } from "../negotiations/negotiation.turn.js";
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('NegotiationContextLoader');

/**
 * Narrow slice of {@link NegotiationGraphDatabase} required by the loader. Kept
 * minimal so call sites can opt into a smaller surface.
 */
export type NegotiationContextDatabase = Pick<
  NegotiationGraphDatabase,
  'getNegotiationTaskForOpportunity' | 'getNegotiationMessages' | 'getArtifactsForTask'
>;

/** Snapshot of a negotiation surfaced to the presenter. */
export interface NegotiationContext {
  status: OpportunityStatus;
  /**
   * Conversation/task id of the A2A negotiation that produced this opportunity.
   * Lets callers deep-link to the negotiation trace (e.g. `/chat/:conversationId`).
   */
  conversationId: string;
  turnCount: number;
  /** Max turns before the negotiation pauses (`counterparty_silent`). */
  turnCap: number;
  turns: NegotiationTurn[];
  /** Present once the negotiation has paused. */
  pause?: { reason: string; payload?: unknown };
  /** The resolve artifact's private reasoning, present only for its resolver. */
  outcomeReasoning?: string;
}

const STATUSES_WITH_NO_NEGOTIATION: ReadonlyArray<OpportunityStatus> = ['draft', 'latent', 'expired'];

/**
 * Loads the negotiation context for an opportunity.
 *
 * @returns NegotiationContext, or null when no meaningful negotiation exists
 *   (draft/latent/expired) or when the task lookup fails.
 */
export async function loadNegotiationContext(
  db: NegotiationContextDatabase,
  opportunityId: string,
  opportunityStatus: OpportunityStatus,
  viewerId: string,
): Promise<NegotiationContext | null> {
  if (STATUSES_WITH_NO_NEGOTIATION.includes(opportunityStatus)) {
    return null;
  }

  const task = await db.getNegotiationTaskForOpportunity(opportunityId, { includeCompleted: true });
  if (!task) {
    logger.verbose('No negotiation task found for opportunity', { opportunityId, opportunityStatus });
    return null;
  }

  const [messages, artifacts] = await Promise.all([
    db.getNegotiationMessages(task.id),
    task.state === 'completed' ? db.getArtifactsForTask(task.id) : Promise.resolve([]),
  ]);
  const turns = extractTurns(messages, viewerId);

  return {
    status: opportunityStatus,
    conversationId: task.conversationId,
    turnCount: turns.length,
    turnCap: NEGOTIATION_MAX_TURNS_AMBIENT,
    turns,
    ...(task.state === 'paused' && task.metadata.pause
      ? { pause: pauseForViewer(task.metadata.pause, viewerId) }
      : {}),
    ...outcomeReasoningForViewer(artifacts, viewerId),
  };
}

/** Pause payload is private to the pausing seat — other viewers see the reason only. */
function pauseForViewer(
  pause: { reason: string; payload?: unknown; pausedBy?: string },
  viewerId: string,
): { reason: string; payload?: unknown } {
  if (pause.pausedBy === viewerId) {
    return pause.payload !== undefined
      ? { reason: pause.reason, payload: pause.payload }
      : { reason: pause.reason };
  }
  return { reason: pause.reason };
}

function outcomeReasoningForViewer(
  artifacts: Awaited<ReturnType<NegotiationContextDatabase['getArtifactsForTask']>>,
  viewerId: string,
): Pick<NegotiationContext, 'outcomeReasoning'> {
  const outcome = artifacts.find((artifact) => artifact.name === 'negotiation_outcome');
  if (!outcome || outcome.metadata?.resolvedByUserId !== viewerId) return {};
  const data = (outcome.parts as Array<{ kind?: string; data?: unknown }>)
    .find((part) => part.kind === 'data')?.data;
  if (!data || typeof data !== 'object' || typeof (data as { reasoning?: unknown }).reasoning !== 'string') return {};
  const reasoning = (data as { reasoning: string }).reasoning.trim();
  return reasoning ? { outcomeReasoning: reasoning } : {};
}

/** Strip counterparty continue-turn reasoning; the authoring seat keeps its own. */
function extractTurns(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  viewerId: string,
): NegotiationTurn[] {
  const turns: NegotiationTurn[] = [];
  const viewerAgentId = `agent:${viewerId}`;
  for (const message of messages) {
    const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === 'data');
    const parsed = dataPart ? NegotiationTurnSchema.safeParse(dataPart.data) : undefined;
    if (!parsed?.success) continue;
    const turn = parsed.data;
    if (turn.verb !== 'pause' && message.senderId !== viewerAgentId && 'reasoning' in turn) {
      const { reasoning: _reasoning, ...rest } = turn;
      turns.push(rest as NegotiationTurn);
    } else {
      turns.push(turn);
    }
  }
  return turns;
}
