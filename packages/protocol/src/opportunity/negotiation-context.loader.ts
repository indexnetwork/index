/**
 * Negotiation context loader: given an opportunity, fetches the attached
 * negotiation task's transcript and outcome so the home-card presenter can
 * explain *why* the opportunity surfaced.
 *
 * For `draft`, `latent`, and `expired` opportunities, no negotiation has
 * happened (or no longer matters) so the loader returns null.
 *
 * For `negotiating` opportunities, only `turnCount` / `turnCap` are returned
 * — the presenter renders a templated chip without invoking the LLM.
 *
 * For `pending`, `stalled`, `accepted`, and `rejected` opportunities, the
 * full transcript and outcome are included so the prompt can ground its
 * explanation in concrete turn content.
 */

import type { NegotiationGraphDatabase, OpportunityStatus } from '../shared/interfaces/database.interface.js';
import type { NegotiationOutcome, NegotiationTurn } from '../negotiation/negotiation.state.js';
import { protocolLogger } from '../shared/observability/protocol.logger.js';

const logger = protocolLogger('NegotiationContextLoader');

/**
 * Narrow slice of {@link NegotiationGraphDatabase} required by the loader. Kept
 * minimal so call sites can opt into a smaller surface.
 */
export type NegotiationContextDatabase = Pick<
  NegotiationGraphDatabase,
  'getNegotiationTaskForOpportunity' | 'getMessagesForConversation' | 'getArtifactsForTask'
>;

/**
 * Snapshot of a negotiation surfaced to the presenter. `turns` and `outcome`
 * are only populated for post-negotiation statuses (pending/stalled/
 * accepted/rejected); `negotiating` gets only the counters.
 */
export interface NegotiationContext {
  status: OpportunityStatus;
  /**
   * Conversation/task id of the A2A negotiation that produced this opportunity.
   * Lets callers deep-link to the negotiation trace (e.g. `/chat/:conversationId`).
   * Present whenever a negotiation task exists (i.e. context is non-null).
   */
  conversationId: string;
  turnCount: number;
  /** Max turns allowed for this negotiation (0 = unlimited). */
  turnCap: number;
  /** Only present when status is not `negotiating`. */
  outcome?: NegotiationOutcome;
  /** Only present when status is not `negotiating`. */
  turns?: NegotiationTurn[];
}

const STATUSES_WITH_NO_NEGOTIATION: ReadonlyArray<OpportunityStatus> = ['draft', 'latent', 'expired'];
const NEGOTIATION_OUTCOME_ARTIFACT_NAME = 'negotiation-outcome';

/**
 * Loads the negotiation context for an opportunity.
 *
 * @param db - Narrow slice of NegotiationGraphDatabase.
 * @param opportunityId - Opportunity to load negotiation context for.
 * @param opportunityStatus - Current opportunity status. Used to gate loading
 *   and to decide which fields to populate.
 * @returns NegotiationContext, or null when no meaningful negotiation exists
 *   (draft/latent/expired) or when the task lookup fails.
 */
export async function loadNegotiationContext(
  db: NegotiationContextDatabase,
  opportunityId: string,
  opportunityStatus: OpportunityStatus,
): Promise<NegotiationContext | null> {
  if (STATUSES_WITH_NO_NEGOTIATION.includes(opportunityStatus)) {
    return null;
  }

  const task = await db.getNegotiationTaskForOpportunity(opportunityId);
  if (!task) {
    logger.verbose('No negotiation task found for opportunity', { opportunityId, opportunityStatus });
    return null;
  }

  const turnCap = readNumber(task.metadata, 'maxTurns') ?? 0;

  const messages = await db.getMessagesForConversation(task.conversationId);
  const turns = extractTurns(messages);
  const turnCount = turns.length;

  if (opportunityStatus === 'negotiating') {
    return { status: opportunityStatus, conversationId: task.conversationId, turnCount, turnCap };
  }

  const artifacts = await db.getArtifactsForTask(task.id);
  const outcome = extractOutcome(artifacts);

  return {
    status: opportunityStatus,
    conversationId: task.conversationId,
    turnCount,
    turnCap,
    ...(outcome ? { outcome } : {}),
    turns,
  };
}

function readNumber(metadata: Record<string, unknown> | null, key: string): number | undefined {
  if (!metadata) return undefined;
  const value = metadata[key];
  return typeof value === 'number' ? value : undefined;
}

function extractTurns(messages: Array<{ parts: unknown[] }>): NegotiationTurn[] {
  const turns: NegotiationTurn[] = [];
  for (const message of messages) {
    const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === 'data');
    if (dataPart?.data) {
      turns.push(dataPart.data as NegotiationTurn);
    }
  }
  return turns;
}

function extractOutcome(
  artifacts: Array<{ name: string | null; parts: unknown[] }>,
): NegotiationOutcome | undefined {
  const outcomeArtifact = artifacts.find((a) => a.name === NEGOTIATION_OUTCOME_ARTIFACT_NAME);
  if (!outcomeArtifact) return undefined;

  const dataPart = (outcomeArtifact.parts as Array<{ kind?: string; data?: unknown }>).find(
    (p) => p.kind === 'data',
  );
  return dataPart?.data as NegotiationOutcome | undefined;
}
