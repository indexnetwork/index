import { eq, and, sql, asc, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as convSchema from '../schemas/conversation.schema';
import * as dbSchema from '../schemas/database.schema';
import { conversationDatabaseAdapter, ChatDatabaseAdapter } from '../adapters/database.adapter';
import { negotiationTimeoutQueue } from '../queues/negotiations/timeout.queue';
import { negotiationClaimTimeoutQueue } from '../queues/negotiations/claim-timeout.queue';
import { log } from '../lib/log';
import type { NegotiationTurn, UserNegotiationContext, SeedAssessment } from '@indexnetwork/protocol';
import { AMBIENT_PARK_WINDOW_MS } from '@indexnetwork/protocol';

const logger = log.service.from('NegotiationPollingService');

// ─────────────────────────────────────────────────────────────────────────────
// Error classes
// ─────────────────────────────────────────────────────────────────────────────

/** Thrown when a referenced resource does not exist. Maps to HTTP 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a state conflict prevents the operation. Maps to HTTP 409. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Thrown when the caller is not authorized for the requested agent. Maps to HTTP 403. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the time remaining in a single park-window budget.
 *
 * The response-window timer, whether armed as the `waiting_for_agent` timeout or
 * as the `claimed` timeout, shares one budget rather than stacking. When an agent
 * picks up a parked turn, the claim timer is armed with whatever time is left
 * since park start, not a fresh full budget.
 *
 * Clamped to a 1-second floor so BullMQ delay is always positive.
 *
 * @param parkStartTime - The timestamp when the task entered `waiting_for_agent`
 * @param totalBudgetMs - The total park-window budget in milliseconds
 * @returns Remaining milliseconds (minimum 1 000)
 */
export function computeRemainingBudgetMs(
  parkStartTime: Date,
  totalBudgetMs: number,
): number {
  const elapsedMs = Date.now() - parkStartTime.getTime();
  const remainingMs = totalBudgetMs - elapsedMs;
  return Math.max(1_000, remainingMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PickupResult {
  negotiationId: string;
  taskId: string;
  opportunity: { id: string; reasoning: string; actors: unknown[]; status: string } | null;
  turn: {
    number: number;
    deadline: string;
    history: Array<{ turnNumber: number; agent: 'source' | 'candidate'; action: string; message: string | null | undefined }>;
    counterpartyAction: string;
  };
  /**
   * Full negotiation context, mirroring what the in-process system agent
   * receives as its `NegotiationAgentInput`. `ownUser`/`otherUser` are
   * projected to the claiming user's perspective. Populated on turns parked
   * with turn context; `null` only for legacy tasks created before
   * context persistence landed.
   */
  context: {
    ownUser: UserNegotiationContext;
    otherUser: UserNegotiationContext;
    indexContext: { networkId: string; prompt?: string };
    seedAssessment: SeedAssessment;
    isDiscoverer: boolean;
    discoveryQuery?: string;
  } | null;
}

export interface RespondInput {
  action: 'propose' | 'accept' | 'reject' | 'counter' | 'question';
  message?: string | null;
  assessment: {
    reasoning: string;
    suggestedRoles: {
      ownUser: 'agent' | 'patient' | 'peer';
      otherUser: 'agent' | 'patient' | 'peer';
    };
  };
}

/**
 * Absolute (source/candidate) view of the negotiation context, persisted by
 * {@link NegotiationGraphFactory} when a turn is parked for polling. Projected
 * to ownUser/otherUser at pickup/get_negotiation time using the claiming
 * user's id.
 */
interface PersistedTurnContext {
  sourceUser: UserNegotiationContext;
  candidateUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt?: string };
  seedAssessment: SeedAssessment;
  discoveryQuery?: string;
}

/** Shape of the task metadata JSONB for negotiation tasks. */
interface NegotiationTaskMetadata {
  type: 'negotiation';
  sourceUserId: string;
  candidateUserId: string;
  maxTurns?: number;
  opportunityId?: string;
  turnContext?: PersistedTurnContext;
}

/** Default maximum turns before a negotiation is force-finalized. */
const DEFAULT_MAX_TURNS = 6;


// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NegotiationPollingService
 *
 * Provides the business logic for polling-based negotiation delivery.
 * External agents call {@link pickup} to claim the next pending turn, then
 * call {@link respond} to submit their response.
 *
 * RESPONSIBILITIES:
 * - Pickup: find the oldest pending turn for a user's agent, atomically claim it
 * - Respond: validate the claim, persist the turn, evaluate termination, advance state
 * - Timeout orchestration: cancel/enqueue 24h and 6h timeouts as state transitions
 */
export class NegotiationPollingService {
  /**
   * Picks up the next pending negotiation turn for an agent.
   *
   * Idempotent: if the agent already has a claimed turn, returns that turn
   * without re-claiming. Otherwise finds the oldest `waiting_for_agent` task
   * where the user is a participant and atomically transitions it to `claimed`.
   *
   * @param agentId - The agent claiming the turn
   * @param userId - The user the agent represents
   * @returns The pickup result with opportunity context and turn history, or null if nothing pending
   */
  async pickup(agentId: string, userId: string): Promise<PickupResult | null> {
    await this.assertAgentOwnership(agentId, userId);

    // 1. Check if agent already has a claimed turn (idempotency)
    const [existingClaim] = await db
      .select()
      .from(convSchema.tasks)
      .where(
        and(
          eq(convSchema.tasks.state, 'claimed'),
          eq(convSchema.tasks.claimedByAgentId, agentId),
          sql`${convSchema.tasks.metadata}->>'type' = 'negotiation'`,
        ),
      )
      .limit(1);

    if (existingClaim) {
      logger.info('[NegotiationPollingService] Returning existing claimed turn', {
        agentId,
        taskId: existingClaim.id,
      });
      // Idempotent repick path: the pre-park timestamp is not readily available
      // once a task is claimed, so we fall back to updatedAt (the claim time).
      // The resulting deadline is OPTIMISTIC — it can be later than when the
      // already-armed claim-timer will actually fire (parkStart + 5min), because
      // claimTime > parkStart. Agents may briefly see more time than they have.
      // TODO(plan-b): persist park-start on task metadata at waiting_for_agent
      // transition so both initial pickup and idempotent repick derive deadlines
      // from the same origin. Tracked alongside the per-turn park-window work.
      return this.buildPickupResult(existingClaim, userId, existingClaim.updatedAt ?? new Date());
    }

    // 2. Find oldest task in waiting_for_agent where user is source or candidate
    const [pendingTask] = await db
      .select()
      .from(convSchema.tasks)
      .where(
        and(
          eq(convSchema.tasks.state, 'waiting_for_agent'),
          sql`${convSchema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`(
            ${convSchema.tasks.metadata}->>'sourceUserId' = ${userId}
            OR ${convSchema.tasks.metadata}->>'candidateUserId' = ${userId}
          )`,
        ),
      )
      .orderBy(asc(convSchema.tasks.createdAt))
      .limit(1);

    if (!pendingTask) {
      return null;
    }

    // 3. Atomically transition to claimed (WHERE state = 'waiting_for_agent' prevents races)
    const now = new Date();
    const [claimed] = await db
      .update(convSchema.tasks)
      .set({
        state: 'claimed',
        claimedByAgentId: agentId,
        claimedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(convSchema.tasks.id, pendingTask.id),
          eq(convSchema.tasks.state, 'waiting_for_agent'),
        ),
      )
      .returning();

    if (!claimed) {
      // Another agent won the race
      logger.info('[NegotiationPollingService] Lost race to claim task', {
        agentId,
        taskId: pendingTask.id,
      });
      return null;
    }

    // 4. Cancel park-window timer (no longer unpicked)
    await negotiationTimeoutQueue.cancelTimeout(claimed.id);

    // 5. Enqueue claim timeout using remaining park-window budget.
    // NOTE: claimed.updatedAt is the post-update value (Drizzle RETURNING returns
    // the updated row). The pre-claim updatedAt — the park-start time — lives in
    // pendingTask.updatedAt, captured from the SELECT before the CAS transition.
    // TODO(plan-b): the dispatcher accepts `options.timeoutMs` per call (5 min
    // ambient today, 60s orchestrator after Plan B), but the originating window
    // is not persisted on the task. Until it is, this path assumes every parked
    // turn used AMBIENT_PARK_WINDOW_MS; the orchestrator trigger will over-report
    // remaining budget until the per-turn window is threaded through the timeout
    // job payload or task metadata. Safe for this PR (ambient-only parking).
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(claimed.conversationId);
    const turnNumber = messages.length;
    const remainingMs = computeRemainingBudgetMs(pendingTask.updatedAt, AMBIENT_PARK_WINDOW_MS);
    await negotiationClaimTimeoutQueue.enqueueTimeout(claimed.id, turnNumber, agentId, remainingMs);

    logger.info('[NegotiationPollingService] Turn claimed', {
      agentId,
      userId,
      taskId: claimed.id,
      turnNumber,
    });

    // 6. Return pickup result
    // Pass pendingTask.updatedAt (the pre-claim park-start time) so the
    // deadline reflects the true remaining park-window, not the claim time.
    return this.buildPickupResult(claimed, userId, pendingTask.updatedAt);
  }

  /**
   * Submits a response for a claimed negotiation turn.
   *
   * Validates that the task is in `claimed` state and owned by the given agent,
   * persists the turn as a message, then evaluates whether the negotiation should
   * terminate (accept/reject/max turns) or continue.
   *
   * @param agentId - The agent submitting the response
   * @param userId - The user the agent represents
   * @param negotiationId - The task ID of the negotiation
   * @param input - The agent's response (action, message, assessment)
   * @returns Success confirmation
   * @throws {NotFoundError} If the negotiation task does not exist
   * @throws {ConflictError} If the task is not claimed or not claimed by this agent
   */
  async respond(
    agentId: string,
    userId: string,
    negotiationId: string,
    input: RespondInput,
  ): Promise<{ success: true }> {
    await this.assertAgentOwnership(agentId, userId);

    // 1. Atomically transition out of 'claimed' to 'working' with CAS on
    //    claimedByAgentId. This prevents the claim-timeout worker and respond
    //    from both observing 'claimed' and both appending a turn.
    const now = new Date();
    const [task] = await db
      .update(convSchema.tasks)
      .set({ state: 'working', updatedAt: now })
      .where(
        and(
          eq(convSchema.tasks.id, negotiationId),
          eq(convSchema.tasks.state, 'claimed'),
          eq(convSchema.tasks.claimedByAgentId, agentId),
        ),
      )
      .returning();

    if (!task) {
      // Either the task does not exist, is no longer claimed, or is claimed by
      // a different agent. Disambiguate so callers get a precise error.
      const current = await conversationDatabaseAdapter.getTask(negotiationId);
      if (!current) {
        throw new NotFoundError(`Negotiation ${negotiationId} not found`);
      }
      if (current.claimedByAgentId && current.claimedByAgentId !== agentId) {
        throw new ConflictError(
          `Negotiation ${negotiationId} is claimed by a different agent`,
        );
      }
      throw new ConflictError(
        `Negotiation ${negotiationId} is in state '${current.state}', expected 'claimed'`,
      );
    }

    const meta = task.metadata as NegotiationTaskMetadata | null;
    if (meta?.type !== 'negotiation') {
      throw new NotFoundError(`Task ${negotiationId} is not a negotiation`);
    }

    // 2. Cancel 6h claim timeout (the CAS already fenced it off, but remove the
    //    delayed job so it doesn't wake up and short-circuit on state mismatch).
    await negotiationClaimTimeoutQueue.cancelTimeout(negotiationId);

    // 3. Determine current speaker
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId);
    const currentTurnCount = messages.length;
    const currentSpeaker: 'source' | 'candidate' = currentTurnCount % 2 === 0 ? 'source' : 'candidate';
    const senderId = currentSpeaker === 'source'
      ? `agent:${meta.sourceUserId}`
      : `agent:${meta.candidateUserId}`;

    // 4. Persist the turn as a message
    const turn: NegotiationTurn = {
      action: input.action,
      message: input.message ?? null,
      assessment: input.assessment,
    };

    await conversationDatabaseAdapter.createMessage({
      conversationId: task.conversationId,
      senderId,
      role: 'agent',
      parts: [{ kind: 'data' as const, data: turn }],
      taskId: task.id,
    });

    const newTurnCount = currentTurnCount + 1;
    const maxTurns = meta.maxTurns ?? DEFAULT_MAX_TURNS;

    // 5. Evaluate: accept/reject/maxTurns -> finalize, else -> waiting_for_agent + re-arm timeout
    if (input.action === 'accept' || input.action === 'reject' || newTurnCount >= maxTurns) {
      // Parse full history for outcome building
      const history = this.parseHistory(messages);
      const fullHistory = [...history, turn];
      const nextSpeaker: 'source' | 'candidate' = currentSpeaker === 'source' ? 'candidate' : 'source';

      const outcome = this.buildOutcome(
        fullHistory,
        newTurnCount,
        input.action,
        meta.sourceUserId,
        meta.candidateUserId,
        nextSpeaker,
      );

      await conversationDatabaseAdapter.updateTaskState(task.id, 'completed');
      await conversationDatabaseAdapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: outcome }],
        metadata: { hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount },
      });

      const outcomeStr = input.action === 'accept' ? 'accepted'
        : input.action === 'reject' ? 'rejected'
        : 'turn_cap';

      if (meta.opportunityId) {
        const nextStatus = input.action === 'accept' ? 'pending'
          : input.action === 'reject' ? 'rejected'
          : 'stalled';
        await new ChatDatabaseAdapter().updateOpportunityStatus(meta.opportunityId, nextStatus).catch((err) => {
          logger.error('[NegotiationPollingService] Failed to update opportunity status on finalization', {
            opportunityId: meta.opportunityId,
            nextStatus,
            error: err,
          });
        });
      }

      logger.info('[NegotiationPollingService] Negotiation finalized', {
        negotiationId,
        outcome: outcomeStr,
        turnCount: newTurnCount,
      });
    } else {
      // Continue: set to waiting_for_agent and re-arm park-window timeout
      await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');

      await negotiationTimeoutQueue.enqueueTimeout(negotiationId, newTurnCount, AMBIENT_PARK_WINDOW_MS);

      logger.info('[NegotiationPollingService] Turn submitted, waiting for next agent', {
        negotiationId,
        action: input.action,
        turnCount: newTurnCount,
      });
    }

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verifies that the given agent is owned by the authenticated user. The
   * auth guard only resolves the user from the API key; without this check
   * anyone with a valid key on the system could drive pickup/respond for any
   * agentId they can guess. Throws {@link UnauthorizedError} on mismatch.
   */
  private async assertAgentOwnership(agentId: string, userId: string): Promise<void> {
    const [agent] = await db
      .select({ id: dbSchema.agents.id })
      .from(dbSchema.agents)
      .where(
        and(
          eq(dbSchema.agents.id, agentId),
          eq(dbSchema.agents.ownerId, userId),
          isNull(dbSchema.agents.deletedAt),
        ),
      )
      .limit(1);
    if (!agent) {
      throw new UnauthorizedError(`Agent ${agentId} is not accessible to the current user`);
    }
  }

  /**
   * Builds a {@link PickupResult} from a task row.
   * Loads the opportunity (if referenced), reconstructs turn history, and
   * projects the persisted absolute turn context into ownUser/otherUser
   * from the claiming user's perspective.
   *
   * @param task - Claimed task row
   * @param userId - The user whose agent is claiming this turn (drives ownUser/otherUser projection)
   * @param parkStartTime - The timestamp when the task was last parked (waiting_for_agent updatedAt).
   *   Used with AMBIENT_PARK_WINDOW_MS to compute a meaningful response deadline.
   */
  private async buildPickupResult(task: convSchema.Task, userId: string, parkStartTime: Date): Promise<PickupResult> {
    const meta = task.metadata as NegotiationTaskMetadata;

    // Load opportunity if referenced
    let opportunity: PickupResult['opportunity'] = null;
    if (meta.opportunityId) {
      const [oppRow] = await db
        .select({
          id: dbSchema.opportunities.id,
          detection: dbSchema.opportunities.detection,
          actors: dbSchema.opportunities.actors,
          status: dbSchema.opportunities.status,
        })
        .from(dbSchema.opportunities)
        .where(eq(dbSchema.opportunities.id, meta.opportunityId))
        .limit(1);

      if (oppRow) {
        const detection = oppRow.detection as { reasoning?: string } | null;
        opportunity = {
          id: oppRow.id,
          reasoning: detection?.reasoning ?? '',
          actors: oppRow.actors as unknown[],
          status: oppRow.status,
        };
      }
    }

    // Load turn history
    const messages = await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId);
    const turnNumber = messages.length;

    const history: PickupResult['turn']['history'] = messages.map((m, idx) => {
      const dp = (m.parts as Array<{ kind?: string; data?: NegotiationTurn }>)?.find(
        (p) => p.kind === 'data',
      );
      const turnData = dp?.data;
      const speaker: 'source' | 'candidate' = idx % 2 === 0 ? 'source' : 'candidate';
      return {
        turnNumber: idx,
        agent: speaker,
        action: turnData?.action ?? 'unknown',
        message: turnData?.message,
      };
    });

    // Counterparty action = action from the last turn (the turn that triggered this pickup)
    const lastTurn = history.length > 0 ? history[history.length - 1] : null;
    const counterpartyAction = lastTurn?.action ?? 'none';

    // Deadline = park-start time + ambient park window (typically 5 minutes).
    // Using the pre-claim updatedAt as the park-start gives agents an accurate
    // urgency signal rather than the old claimedAt + 6h which was wildly wrong.
    const deadline = new Date(parkStartTime.getTime() + AMBIENT_PARK_WINDOW_MS);

    // Project persisted source/candidate context into own/other perspective
    // for the claiming user. Null when the task was parked before turn
    // context persistence was added (pre-migration tasks).
    let context: PickupResult['context'] = null;
    if (meta.turnContext) {
      const isSource = meta.sourceUserId === userId;
      const ownUser = isSource ? meta.turnContext.sourceUser : meta.turnContext.candidateUser;
      const otherUser = isSource ? meta.turnContext.candidateUser : meta.turnContext.sourceUser;
      context = {
        ownUser,
        otherUser,
        indexContext: meta.turnContext.indexContext,
        seedAssessment: meta.turnContext.seedAssessment,
        isDiscoverer: isSource,
        ...(meta.turnContext.discoveryQuery && { discoveryQuery: meta.turnContext.discoveryQuery }),
      };
    }

    return {
      negotiationId: task.id,
      taskId: task.id,
      opportunity,
      turn: {
        number: turnNumber,
        deadline: deadline.toISOString(),
        history,
        counterpartyAction,
      },
      context,
    };
  }

  /**
   * Parses negotiation turn history from raw message rows.
   */
  private parseHistory(
    messages: Array<{ parts: unknown[] }>,
  ): NegotiationTurn[] {
    return messages
      .map((m) => {
        const dp = (m.parts as Array<{ kind?: string; data?: unknown }>)?.find(
          (p) => p.kind === 'data',
        );
        return dp?.data as NegotiationTurn;
      })
      .filter(Boolean);
  }

  /**
   * Builds a negotiation outcome from the full turn history.
   * Follows the same pattern as {@link NegotiationTimeoutQueue.buildOutcome}.
   *
   * @param history - Complete turn history including the final turn
   * @param turnCount - Total number of turns
   * @param lastAction - The action of the final turn
   * @param sourceUserId - The source (discoverer) user ID
   * @param candidateUserId - The candidate user ID
   * @param currentSpeaker - Who would speak next (used to determine accepter perspective)
   */
  private buildOutcome(
    history: NegotiationTurn[],
    turnCount: number,
    lastAction: string,
    sourceUserId: string,
    candidateUserId: string,
    currentSpeaker: string,
  ): { hasOpportunity: boolean; agreedRoles: Array<{ userId: string; role: string }>; reasoning: string; turnCount: number; reason?: string } {
    const hasOpportunity = lastAction === 'accept';
    const atCap = lastAction === 'counter';

    let agreedRoles: Array<{ userId: string; role: string }> = [];
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
      ...(atCap && { reason: 'turn_cap' as const }),
    };
  }
}

/** Singleton negotiation polling service instance. */
export const negotiationPollingService = new NegotiationPollingService();
