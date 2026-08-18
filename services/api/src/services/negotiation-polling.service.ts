import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import * as convSchema from '../schemas/conversation.schema';
import * as dbSchema from '../schemas/database.schema';
import { conversationDatabaseAdapter } from '../adapters/database.adapter';
import { log } from '../lib/log';
import { negotiationTimeoutQueue } from '../queues/negotiations/timeout.queue';
import { negotiationClaimTimeoutQueue } from '../queues/negotiations/claim-timeout.queue';
import { allowedHermesActionsFor, buildHermesNegotiationTurn, consultationPromptFor, HERMES_OWNER_DIRECTIVE, isNegotiationTurnCapReached, type HermesNegotiationAction, type HermesNegotiationResponse, type NegotiationTurn, type UserNegotiationContext, type SeedAssessment, type NegotiationAction, type NegotiationConsultationReason, type NegotiationSeat, type NegotiationProtocolVersion, type NegotiatorMemoryEntry } from '@indexnetwork/protocol';
import { negotiatorMemoryRetrievalAdapter } from '../adapters/negotiator-memory.retrieval.adapter';
import { completeContinuationExecution, parkContinuationExecution, readClaimedContinuationExecution } from '../adapters/negotiation-continuation.atomic';
import { AMBIENT_PARK_WINDOW_MS, allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, isRejectLikeAction, isTerminalAction, negotiationConsultationPolicyMode, negotiationQuestionSettlementId, readProtocolVersion, resolveSeat, seatViolationMessage } from '@indexnetwork/protocol';
import { NegotiationPollingAuthorization } from '../lib/agent/negotiation-polling-authorization';
import { parkedQuestionEnqueue } from '../queues/parked-question.enqueue';
import { assessExternalConsultationEligibility, buildExternalConsultationQuestionerPayload, type ExternalConsultationPersistedTurn } from '../lib/negotiation/consultation';
import { isDedicatedHermesNegotiationAudience, type NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';
import type { AtomicHermesResponseInput, AtomicHermesResponseResult, HermesRunMutationAuthority } from '../adapters/conversation.database.adapter';
import { remainingDeadlineDelayMs } from '../lib/negotiation/timeout-execution';
import { expectedNegotiationSpeaker, readNegotiationMessages } from '../lib/negotiation/expected-speaker';
import { hermesRuntimeTelemetry, type HermesRuntimeTelemetry } from '../lib/agent/hermes-runtime-telemetry';
import { logNegotiationPickupConflict } from '../lib/agent/negotiation-polling.log';

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

/**
 * Thrown when a submitted negotiation action is outside the caller's seat
 * vocabulary for the task's protocol version. Maps to HTTP 400.
 */
export class SeatViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeatViolationError';
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
 * Clamped to zero: an already elapsed preserved deadline is repaired as an
 * immediate BullMQ fallback rather than being extended.
 *
 * @param parkStartTime - The timestamp when the task entered `waiting_for_agent`
 * @param totalBudgetMs - The total park-window budget in milliseconds
 * @returns Remaining milliseconds (zero when the original deadline elapsed)
 */
export function computeRemainingBudgetMs(
  parkStartTime: Date,
  totalBudgetMs: number,
): number {
  const elapsedMs = Date.now() - parkStartTime.getTime();
  const remainingMs = totalBudgetMs - elapsedMs;
  return Math.max(0, remainingMs);
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
   * The claiming user's seat under the task's negotiation protocol version
   * (v2 client-advocate: `initiator` never accepts; only `counterparty` can).
   */
  seat: NegotiationSeat;
  /** Negotiation protocol version stamped on the task (`v1` for pre-v2 tasks). */
  protocolVersion: NegotiationProtocolVersion;
  /** Actions the claiming seat may submit on this turn. */
  allowedActions: NegotiationAction[];
  /** Whether this exact claim may enter the owner-consultation continuation. */
  canConsultOwner: boolean;
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
  /**
   * The CLAIMING user's own negotiator memories (P5.3 read path) — private
   * context for their agent's turn. Strictly seat-scoped: retrieval is keyed
   * on the claiming user's id, so this never contains the counterparty's
   * memory. Absent when `NEGOTIATOR_MEMORY_INJECT` is off or nothing was
   * retrieved.
   */
  negotiatorMemory?: NegotiatorMemoryEntry[];
  /** Recipient-private consultation; present only for that recipient's agent. */
  privateConsultation?: { kind: 'answer' | 'dismiss' | 'timeout'; selectedOptions: string[]; freeText?: string };
}

export interface HermesPickupResult {
  negotiationId: string;
  taskId: string;
  opportunity: { id: string; status: string } | null;
  turn: {
    number: number;
    deadline: string;
    history: Array<{ turnNumber: number; agent: 'source' | 'candidate'; action: string }>;
    counterpartyAction: string;
  };
  seat: NegotiationSeat;
  protocolVersion: NegotiationProtocolVersion;
  allowedActions: HermesNegotiationAction[];
  canConsultOwner: boolean;
  ownerDirective: typeof HERMES_OWNER_DIRECTIVE;
  runCapability: string;
}

export type ConsultNegotiationInput = {
  reason: NegotiationConsultationReason;
};

export type ConsultNegotiationResult = {
  success: true;
  status: 'input_required';
  settlementId: string;
};

export interface RespondInput {
  action: NegotiationAction;
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
  /** Rigid initiator seat, stamped at discovery time (v2 client-advocate). */
  initiatorUserId?: string;
  /** Negotiation protocol version; absent on pre-v2 tasks (treated as v1). */
  protocolVersion?: string;
  maxTurns?: number;
  opportunityId?: string;
  networkId?: string;
  sourceIntentId?: string;
  candidateIntentId?: string;
  participantBindings?: Array<{ userId: string; intentId: string; networkId: string }>;
  /** ISO timestamp set by the archive backfill on pre-v2 legacy negotiations. */
  archivedAt?: string;
  turnContext?: PersistedTurnContext & {
    privateConsultation?: { recipientUserId: string; kind: 'answer' | 'dismiss' | 'timeout'; selectedOptions: string[]; freeText?: string };
  };
}

function hermesResponseIdentity(taskId: string, capability: string): AtomicHermesResponseInput['identity'] {
  const digest = createHash('sha256').update(`${taskId}\0${capability}`, 'utf8').digest('hex');
  return {
    receiptId: `hermes-response:${digest}`,
    messageId: `hermes-response-message:${digest}`,
    artifactId: `hermes-response-artifact:${digest}`,
    sessionId: `hermes-response-session:${digest}`,
  };
}

export type HermesResponsePersistence = Pick<typeof conversationDatabaseAdapter,
  | 'getTask'
  | 'getMessagesForConversation'
  | 'getNegotiationMessages'
  | 'getPendingHermesResponseOutboxes'
  | 'getHermesResponseReplay'
  | 'respondHermesNegotiationAtomically'
  | 'markHermesResponseOutboxDelivered'
>;

/**
 * This negotiation's own messages — turn numbers, floor checks and turn caps all
 * describe one match, while the pair's DM accumulates every match they share.
 */
function negotiationMessagesFor(
  reader: Pick<typeof conversationDatabaseAdapter, 'getNegotiationMessages' | 'getMessagesForConversation'>,
  task: { conversationId: string; metadata: unknown },
) {
  return readNegotiationMessages({
    byNegotiation: (id) => reader.getNegotiationMessages(id),
    byConversation: (id) => reader.getMessagesForConversation(id),
  }, {
    conversationId: task.conversationId,
    metadata: task.metadata as { opportunityId?: unknown } | null,
  });
}

/** Durable successor markers require a current continuation fence; never downgrade to generic CAS. */
function hasContinuationIdentity(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(record, 'continuationExecution')
    || record.isContinuation === true
    || (typeof record.resumeFromTaskId === 'string' && record.resumeFromTaskId.length > 0)
    || (typeof record.continuationSettlementId === 'string' && record.continuationSettlementId.length > 0);
}


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
  constructor(
    private readonly authorization: NegotiationPollingAuthorization = negotiationPollingAuthorization,
    private readonly pickupAdapter: Pick<typeof conversationDatabaseAdapter, 'pickupNegotiationAtomically'> = conversationDatabaseAdapter,
    private readonly responsePersistence: HermesResponsePersistence = conversationDatabaseAdapter,
    private readonly now: () => number = Date.now,
    private readonly telemetry: HermesRuntimeTelemetry = hermesRuntimeTelemetry,
  ) {}

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
  async pickup(
    agentId: string,
    userId: string,
    principal: NegotiationCredentialPrincipal,
    runId?: string,
  ): Promise<PickupResult | HermesPickupResult | null> {
    if (!await this.authorization.authorizePickup(agentId, userId)) {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }

    // A fresh cron/gateway session repairs durable queue work committed by an
    // earlier process before selecting another negotiation. This path is scoped
    // to the exact current agent/owner and does not retain or require the old
    // raw run capability. Delivery failure rejects pickup, so ordinary success
    // can never strand a known pending response outbox.
    const pendingOutboxes = await this.responsePersistence.getPendingHermesResponseOutboxes(
      agentId,
      userId,
      principal,
    );
    this.telemetry.gauge('pending_outbox', pendingOutboxes.length);
    for (const pending of pendingOutboxes) {
      this.telemetry.increment('outbox_replay_attempted', { reason: 'outbox_pending' });
      await this.deliverHermesResponseOutbox(pending.taskId, pending.result);
    }

    const pickup = await this.pickupAdapter.pickupNegotiationAtomically({
      agentId,
      ownerId: userId,
      principal,
      ...(runId ? { runId } : {}),
    });
    if (pickup.kind === 'unauthorized') {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is no longer the selected negotiation executor`);
    }
    if (pickup.kind === 'empty') return null;
    if (pickup.kind === 'run_exhausted') {
      this.telemetry.increment('conflict', { reason: 'run_exhausted' });
      throw new ConflictError('This Hermes run has already picked up a negotiation task');
    }
    if (pickup.kind === 'conflict') {
      this.telemetry.increment('conflict', { reason: 'runtime_conflict' });
      logNegotiationPickupConflict();
      return null;
    }

    const claimed = pickup.task;
    const claimedAt = claimed.claimedAt?.toISOString();
    if (!claimedAt) throw new Error(`Claimed negotiation ${claimed.id} has no claim generation`);
    const messages = await negotiationMessagesFor(conversationDatabaseAdapter, claimed);
    const turnNumber = messages.length;
    const remainingMs = computeRemainingBudgetMs(pickup.parkStartTime, AMBIENT_PARK_WINDOW_MS);
    const execution = (claimed.metadata as {
      continuationExecution?: {
        priorTaskId?: unknown;
        settlementId?: unknown;
        successorTaskId?: unknown;
        token?: unknown;
        fence?: unknown;
      };
    } | null)?.continuationExecution;
    const continuation = execution
      && typeof execution.priorTaskId === 'string'
      && typeof execution.settlementId === 'string'
      && typeof execution.successorTaskId === 'string'
      && typeof execution.token === 'string'
      && typeof execution.fence === 'number'
      ? {
          priorTaskId: execution.priorTaskId,
          settlementId: execution.settlementId,
          successorTaskId: execution.successorTaskId,
          token: execution.token,
          fence: execution.fence,
        }
      : undefined;

    // Both new and exact-existing claims run this delivery repair. The job ID
    // is claim-generation specific, so an existing add cannot extend the
    // original deadline or duplicate fallback.
    await negotiationTimeoutQueue.cancelTimeout(claimed.id, pickup.parkGeneration);
    await negotiationClaimTimeoutQueue.enqueueTimeout(
      claimed.id,
      turnNumber,
      agentId,
      claimedAt,
      remainingMs,
      continuation,
    );

    logger.info(pickup.kind === 'existing' ? 'Returning existing claimed turn after timer repair' : 'Turn claimed', {
      agentId,
      userId,
      taskId: claimed.id,
      turnNumber,
    });

    const result = await this.buildPickupResult(claimed, userId, pickup.parkStartTime);
    return isDedicatedHermesNegotiationAudience(principal.audience)
      ? this.projectHermesPickup(result, pickup.runCapability)
      : result;
  }

  /**
   * Pause an exact external claim and route a privacy-minimal owner question
   * through the existing Questioner/expiry/continuation lifecycle.
   */
  async consult(
    agentId: string,
    userId: string,
    negotiationId: string,
    input: ConsultNegotiationInput,
    principal: NegotiationCredentialPrincipal,
    runAuthority?: HermesRunMutationAuthority,
  ): Promise<ConsultNegotiationResult> {
    if (!await this.authorization.authorizeRespond(agentId, userId)) {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }
    if (runAuthority && await conversationDatabaseAdapter.isHermesRunMutationReplay(
      negotiationId,
      principal,
      runAuthority,
    )) {
      return {
        success: true,
        status: 'input_required',
        settlementId: negotiationQuestionSettlementId(negotiationId),
      };
    }
    const task = await conversationDatabaseAdapter.getTask(negotiationId);
    if (!task) throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    const metadata = task.metadata as NegotiationTaskMetadata | null;
    if (metadata?.type !== 'negotiation') {
      throw new NotFoundError(`Task ${negotiationId} is not a negotiation`);
    }
    if (metadata.sourceUserId !== userId && metadata.candidateUserId !== userId) {
      throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    }

    const messages = await negotiationMessagesFor(conversationDatabaseAdapter, task);
    const persistedTurns = this.persistedTurns(messages);
    const questionerEnqueue = parkedQuestionEnqueue();
    const policyMode = negotiationConsultationPolicyMode();
    const eligibility = assessExternalConsultationEligibility({
      task: {
        id: task.id,
        state: task.state,
        claimedByAgentId: task.claimedByAgentId,
        metadata: metadata as unknown as Record<string, unknown>,
      },
      messages: persistedTurns,
      userId,
      agentId,
      policyMode,
      wiring: {
        askUserEnabled: configuredAskUserEnabled(),
        questionerEnabled: Boolean(questionerEnqueue),
        expiryEnabled: typeof negotiationTimeoutQueue.enqueueAskUserExpiry === 'function',
      },
    });
    if (policyMode === 'shadow') {
      logger.info('negotiation_consultation_policy', {
        stage: 'assessed', mode: policyMode, eligible: eligibility.policy.eligible,
        ...(eligibility.policy.reason ? { reason: eligibility.policy.reason } : {}),
      });
    }
    if (!eligibility.structuralEligible || !eligibility.eligible || !eligibility.coordinates) {
      if (task.state === 'claimed' && task.claimedByAgentId !== agentId) {
        throw new ConflictError(`Negotiation ${negotiationId} is claimed by a different agent`);
      }
      throw new SeatViolationError('Owner consultation is not available for this negotiation turn');
    }
    if (eligibility.policy.eligible && eligibility.policy.reason && policyMode !== 'off') {
      logger.info('negotiation_consultation_policy', {
        stage: 'eligible', mode: policyMode, reason: eligibility.policy.reason,
      });
    }

    if (!eligibility.policy.reason || eligibility.policy.reason !== input.reason) {
      throw new SeatViolationError('Consultation reason does not match the server-authorized category');
    }
    const safeAskUser = consultationPromptFor(eligibility.policy.reason);

    const hasContinuation = hasContinuationIdentity(task.metadata);
    const continuationExecution = hasContinuation
      ? await readClaimedContinuationExecution(db, negotiationId)
      : null;
    if (hasContinuation && !continuationExecution) {
      throw new ConflictError(`Negotiation ${negotiationId} continuation fence is no longer current`);
    }

    const material = await conversationDatabaseAdapter.getClaimedNegotiationConsultationMaterial({
      taskId: negotiationId,
      claimedByAgentId: agentId,
      recipientUserId: userId,
      recipientIntentId: eligibility.coordinates.recipientIntentId,
      opportunityId: eligibility.coordinates.opportunityId,
      networkId: eligibility.coordinates.networkId,
      counterpartyUserId: eligibility.coordinates.counterpartyUserId,
      counterpartyIntentId: eligibility.coordinates.counterpartyIntentId,
    });
    if (
      !material
      || material.counterpartyUserId !== eligibility.coordinates.counterpartyUserId
      || material.counterpartyIntentId !== eligibility.coordinates.counterpartyIntentId
    ) {
      throw new ConflictError(`Negotiation ${negotiationId} consultation binding is no longer current`);
    }

    const settlementId = negotiationQuestionSettlementId(negotiationId);
    const consultationAttemptId = crypto.randomUUID();
    const expiryPayload = {
      claimedByAgentId: agentId,
      settlementId,
      opportunityId: eligibility.coordinates.opportunityId,
      userId,
      recipientIntentId: eligibility.coordinates.recipientIntentId,
      networkId: eligibility.coordinates.networkId,
      ...material,
    };
    await negotiationTimeoutQueue.enqueueAskUserExpiry(
      negotiationId,
      consultationAttemptId,
      expiryPayload,
      askUserAnswerWindowMs(),
    );

    let paused;
    try {
      paused = await conversationDatabaseAdapter.pauseClaimedNegotiationForConsultation({
        taskId: negotiationId,
        claimedByAgentId: agentId,
        recipientUserId: userId,
        recipientIntentId: eligibility.coordinates.recipientIntentId,
        opportunityId: eligibility.coordinates.opportunityId,
        networkId: eligibility.coordinates.networkId,
        settlementId,
        consultationAttemptId,
        expectedTurnCount: messages.length,
        expectedMaterial: material,
        safeAskUser,
        consultationPolicyReason: eligibility.policy.reason,
        principal,
        ...(runAuthority ? { runAuthority } : {}),
        ...(continuationExecution ? { continuationExecution } : {}),
      });
    } catch (error) {
      await negotiationTimeoutQueue.cancelAskUserExpiry(negotiationId, consultationAttemptId);
      throw error;
    }
    if (!paused) {
      await negotiationTimeoutQueue.cancelAskUserExpiry(negotiationId, consultationAttemptId);
      if (runAuthority && await conversationDatabaseAdapter.isHermesRunMutationReplay(
        negotiationId,
        principal,
        runAuthority,
      )) {
        return { success: true, status: 'input_required', settlementId };
      }
      throw new ConflictError(`Negotiation ${negotiationId} is no longer held by this claim`);
    }

    if (task.claimedAt) {
      await negotiationClaimTimeoutQueue.cancelTimeout(negotiationId, task.claimedAt.toISOString());
    }
    const payload = buildExternalConsultationQuestionerPayload({
      negotiationId,
      userId,
      coordinates: eligibility.coordinates,
      reason: eligibility.policy.reason,
    });
    await questionerEnqueue(payload).catch((error) => {
      logger.error('Failed to enqueue external owner consultation; expiry recovery remains armed', {
        negotiationId,
        consultationAttemptId,
        error,
      });
    });
    logger.info('External owner consultation paused', {
      negotiationId,
      consultationAttemptId,
      settlementId,
    });
    return { success: true, status: 'input_required', settlementId };
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
    principal: NegotiationCredentialPrincipal,
  ): Promise<{ success: true }> {
    if (!await this.authorization.authorizeRespond(agentId, userId)) {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }
    // Legacy agent-bound responses retain their existing adapter flow. The
    // dedicated Hermes endpoint below uses the single-transaction response seam.
    return this.respondLegacy(agentId, userId, negotiationId, input, principal);
  }

  async respondHermes(
    agentId: string,
    userId: string,
    negotiationId: string,
    input: HermesNegotiationResponse,
    principal: NegotiationCredentialPrincipal,
    runAuthority: HermesRunMutationAuthority,
  ): Promise<{ success: true }> {
    if (!await this.authorization.authorizeRespond(agentId, userId)) {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is not the selected negotiation executor`);
    }

    const replay = await this.responsePersistence.getHermesResponseReplay(
      negotiationId,
      principal,
      runAuthority,
    );
    if (replay) {
      if (!replay.outboxDelivered) {
        this.telemetry.increment('outbox_replay_attempted', { reason: 'outbox_pending' });
        await this.deliverHermesResponseOutbox(negotiationId, replay);
      }
      return { success: true };
    }

    const preflight = await this.responsePersistence.getTask(negotiationId);
    if (!preflight) throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    const metadata = preflight.metadata as NegotiationTaskMetadata | null;
    if (metadata?.type !== 'negotiation') throw new NotFoundError(`Task ${negotiationId} is not a negotiation`);
    if (metadata.sourceUserId !== userId && metadata.candidateUserId !== userId) {
      throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    }
    const protocolVersion = (readProtocolVersion(metadata) ?? 'v1') as NegotiationProtocolVersion;
    const seat = resolveSeat(userId, metadata);
    const messages = await negotiationMessagesFor(this.responsePersistence, preflight);
    if (expectedNegotiationSpeaker(metadata, messages) !== userId) {
      throw new SeatViolationError('It is not this owner\'s turn to respond in the negotiation');
    }
    const newTurnCount = messages.length + 1;
    const isFinalTurn = isNegotiationTurnCapReached(newTurnCount, metadata.maxTurns);
    const allowed = allowedActionsFor(protocolVersion, seat, isFinalTurn);
    const turn = buildHermesNegotiationTurn(input, allowed);
    if (!turn) throw new SeatViolationError('Closed Hermes action is not available for this negotiation turn');

    const finalState = isTerminalAction(turn.action) || isFinalTurn
      ? 'completed'
      : 'waiting_for_agent';
    const currentSpeaker: 'source' | 'candidate' = metadata.sourceUserId === userId ? 'source' : 'candidate';
    const history = this.parseHistory(messages);
    const outcome = finalState === 'completed'
      ? this.buildOutcome(
          [...history, turn],
          newTurnCount,
          turn.action,
          metadata.sourceUserId,
          metadata.candidateUserId,
          currentSpeaker === 'source' ? 'candidate' : 'source',
        )
      : undefined;
    const opportunityStatus = finalState === 'completed' && metadata.opportunityId
      ? turn.action === 'accept'
        ? 'pending'
        : isRejectLikeAction(turn.action)
          ? 'rejected'
          : 'stalled'
      : null;
    const continuationOutcome = finalState === 'completed'
      ? turn.action === 'accept'
        ? 'accepted'
        : isRejectLikeAction(turn.action)
          ? 'rejected'
          : 'stalled'
      : undefined;

    const result = await this.responsePersistence.respondHermesNegotiationAtomically({
      agentId,
      ownerId: userId,
      taskId: negotiationId,
      principal,
      authority: runAuthority,
      expectedConversationId: preflight.conversationId,
      expectedTaskUpdatedAt: preflight.updatedAt,
      expectedTurnCount: messages.length,
      turn,
      finalState,
      ...(outcome ? { outcome } : {}),
      ...(metadata.opportunityId && opportunityStatus
        ? { opportunity: { id: metadata.opportunityId, status: opportunityStatus } }
        : {}),
      ...(continuationOutcome ? { continuationOutcome } : {}),
      parkTimeoutMs: AMBIENT_PARK_WINDOW_MS,
      identity: hermesResponseIdentity(negotiationId, runAuthority.capability),
    });
    if (result.kind === 'unauthorized') {
      this.telemetry.increment('auth_denied', { reason: 'invalid_credential' });
      throw new UnauthorizedError(`Agent ${agentId} is no longer the selected negotiation executor`);
    }
    if (result.kind === 'not_found') throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    if (result.kind === 'conflict') {
      this.telemetry.increment('conflict', { reason: 'runtime_conflict' });
      if (result.claimedByAgentId && result.claimedByAgentId !== agentId) {
        throw new ConflictError(`Negotiation ${negotiationId} is claimed by a different agent`);
      }
      throw new ConflictError(`Negotiation ${negotiationId} is in state '${result.state ?? 'unknown'}', expected 'claimed'`);
    }

    await this.deliverHermesResponseOutbox(negotiationId, result);
    logger.info(finalState === 'completed' ? 'Negotiation finalized' : 'Turn submitted, waiting for next agent', {
      negotiationId,
      action: turn.action,
      turnCount: newTurnCount,
    });
    return { success: true };
  }

  private async deliverHermesResponseOutbox(
    negotiationId: string,
    result: Extract<AtomicHermesResponseResult, { kind: 'committed' | 'replay' }>,
  ): Promise<void> {
    if (result.outboxDelivered) return;
    try {
      await negotiationClaimTimeoutQueue.cancelTimeout(
        negotiationId,
        result.queueIntent.claimGeneration,
      );
      if (result.queueIntent.rearmParkTimeout) {
        await negotiationTimeoutQueue.enqueueTimeout(
          negotiationId,
          result.queueIntent.rearmParkTimeout.turnNumber,
          remainingDeadlineDelayMs(result.queueIntent.rearmParkTimeout.deadlineAt, this.now()),
          result.queueIntent.rearmParkTimeout.parkGeneration,
          result.queueIntent.rearmParkTimeout.continuation,
        );
      }
      if (!await this.responsePersistence.markHermesResponseOutboxDelivered(
        negotiationId,
        result.receipt.receiptId,
      )) throw new Error('Hermes response outbox receipt changed before delivery acknowledgement');
    } catch (error) {
      this.telemetry.increment('server_error', { reason: 'outbox_delivery' });
      // The database response is already committed. Keep the outbox pending and
      // reject this request; a future independent pickup will retry the same
      // queue IDs before claiming work, including after a process restart.
      logger.error('Failed to deliver committed Hermes response queue outbox', {
        negotiationId,
        receiptId: result.receipt.receiptId,
        error,
      });
      throw error;
    }
  }

  private async respondLegacy(
    agentId: string,
    userId: string,
    negotiationId: string,
    input: RespondInput,
    principal: NegotiationCredentialPrincipal,
  ): Promise<{ success: true }> {
    // 1. Seat + version validation (v2 client-advocate protocol) — BEFORE the
    //    CAS transition, so a rejected action leaves the claim intact and the
    //    agent can retry with a valid one. The action must be within the
    //    caller's seat vocabulary; seat attribution keys on
    //    metadata.initiatorUserId — never on turn parity, which misattributes
    //    seats when a continuation starts with the counterparty speaking first.
    //    v1 tasks are grandfathered: the legacy vocabulary stays valid.
    const preflight = await conversationDatabaseAdapter.getTask(negotiationId);
    if (!preflight) {
      throw new NotFoundError(`Negotiation ${negotiationId} not found`);
    }
    const preflightMeta = preflight.metadata as NegotiationTaskMetadata | null;
    if (preflightMeta?.type !== 'negotiation') {
      throw new NotFoundError(`Task ${negotiationId} is not a negotiation`);
    }
    const protocolVersion = (readProtocolVersion(preflightMeta) ?? 'v1') as NegotiationProtocolVersion;
    const seat = resolveSeat(userId, preflightMeta);
    const preflightMessages = await negotiationMessagesFor(conversationDatabaseAdapter, preflight);
    if (expectedNegotiationSpeaker(preflightMeta, preflightMessages) !== userId) {
      throw new SeatViolationError('It is not this owner\'s turn to respond in the negotiation');
    }
    const isFinalTurn = isNegotiationTurnCapReached(preflightMessages.length + 1, preflightMeta.maxTurns);
    if (!allowedActionsFor(protocolVersion, seat, isFinalTurn).includes(input.action)) {
      throw new SeatViolationError(seatViolationMessage(input.action, seat, protocolVersion));
    }

    // 2. Atomically transition out of 'claimed' to 'working' with CAS on
    //    claimedByAgentId. This prevents the claim-timeout worker and respond
    //    from both observing 'claimed' and both appending a turn.
    const hasContinuation = hasContinuationIdentity(preflight.metadata);
    const continuationExecution = hasContinuation
      ? await readClaimedContinuationExecution(db, negotiationId)
      : null;
    // A stale/expired/malformed continuation fence must never fall through to
    // the generic CAS; that would permit unfenced task and opportunity writes.
    if (hasContinuation && !continuationExecution) {
      throw new ConflictError(`Negotiation ${negotiationId} continuation fence is no longer current`);
    }
    const task = await conversationDatabaseAdapter.transitionClaimedTaskToWorking(
      negotiationId,
      agentId,
      continuationExecution ?? undefined,
      principal,
      userId,
    );

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

    // 3. Cancel 6h claim timeout (the CAS already fenced it off, but remove the
    //    delayed job so it doesn't wake up and short-circuit on state mismatch).
    if (preflight.claimedAt) {
      await negotiationClaimTimeoutQueue.cancelTimeout(negotiationId, preflight.claimedAt.toISOString());
    }

    // 4. The caller IS the current speaker (they claimed the turn) — attribute
    //    the message to them directly rather than deriving from turn parity.
    const messages = await negotiationMessagesFor(conversationDatabaseAdapter, task);
    const currentTurnCount = messages.length;
    const currentSpeaker: 'source' | 'candidate' = meta.sourceUserId === userId ? 'source' : 'candidate';
    const senderId = `agent:${userId}`;

    // 5. Persist the turn as a message
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
      ...(continuationExecution ? { continuationExecution } : {}),
    });

    const newTurnCount = currentTurnCount + 1;

    // 6. Evaluate: terminal action (accept/reject/withdraw/decline) or maxTurns
    //    -> finalize, else -> waiting_for_agent + re-arm timeout
    if (isTerminalAction(input.action) || isNegotiationTurnCapReached(newTurnCount, meta.maxTurns)) {
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

      await conversationDatabaseAdapter.updateTaskState(task.id, 'completed', undefined, continuationExecution ?? undefined);
      await conversationDatabaseAdapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: outcome }],
        metadata: {
          hasOpportunity: outcome.hasOpportunity, turnCount: newTurnCount,
          ...(continuationExecution ? { continuationOutcome: input.action === 'accept' ? 'accepted' : isRejectLikeAction(input.action) ? 'rejected' : 'stalled' } : {}),
        },
        ...(continuationExecution ? { continuationExecution } : {}),
      });

      const outcomeStr = input.action === 'accept' ? 'accepted'
        : isRejectLikeAction(input.action) ? 'rejected'
        : 'turn_cap';

      if (meta.opportunityId) {
        const nextStatus = input.action === 'accept' ? 'pending'
          : isRejectLikeAction(input.action) ? 'rejected'
          : 'stalled';
        await conversationDatabaseAdapter.updateOpportunityStatus(meta.opportunityId, nextStatus, undefined, continuationExecution ?? undefined).catch((err) => {
          logger.error('Failed to update opportunity status on finalization', {
            opportunityId: meta.opportunityId,
            nextStatus,
            error: err,
          });
        });
      }

      if (continuationExecution) {
        await completeContinuationExecution(db, continuationExecution, {
          priorTaskId: continuationExecution.taskId,
          settlementId: continuationExecution.settlementId,
          successorTaskId: continuationExecution.successorTaskId,
          fence: continuationExecution.fence,
          outcome: input.action === 'accept' ? 'accepted' : isRejectLikeAction(input.action) ? 'rejected' : 'stalled',
        });
      }
      logger.info('Negotiation finalized', {
        negotiationId,
        outcome: outcomeStr,
        turnCount: newTurnCount,
      });
    } else {
      // Continue: persist and arm one exact park generation.
      const parkGeneration = crypto.randomUUID();
      await conversationDatabaseAdapter.updateTaskState(
        task.id,
        'waiting_for_agent',
        undefined,
        continuationExecution ?? undefined,
        parkGeneration,
      );
      if (continuationExecution) await parkContinuationExecution(db, continuationExecution);

      await negotiationTimeoutQueue.enqueueTimeout(
        negotiationId,
        newTurnCount,
        AMBIENT_PARK_WINDOW_MS,
        parkGeneration,
        continuationExecution
          ? {
              priorTaskId: continuationExecution.taskId,
              settlementId: continuationExecution.settlementId,
              successorTaskId: continuationExecution.successorTaskId,
              token: continuationExecution.token,
              fence: continuationExecution.fence,
            }
          : undefined,
      );

      logger.info('Turn submitted, waiting for next agent', {
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

  private projectHermesPickup(
    result: PickupResult,
    runCapability: string | undefined,
  ): HermesPickupResult {
    if (!runCapability) {
      throw new ConflictError('Hermes pickup did not produce a run-bound capability');
    }
    return {
      negotiationId: result.negotiationId,
      taskId: result.taskId,
      opportunity: result.opportunity
        ? { id: result.opportunity.id, status: result.opportunity.status }
        : null,
      turn: {
        number: result.turn.number,
        deadline: result.turn.deadline,
        history: result.turn.history.map(({ turnNumber, agent, action }) => ({ turnNumber, agent, action })),
        counterpartyAction: result.turn.counterpartyAction,
      },
      seat: result.seat,
      protocolVersion: result.protocolVersion,
      allowedActions: allowedHermesActionsFor(result.allowedActions),
      canConsultOwner: result.canConsultOwner,
      ownerDirective: HERMES_OWNER_DIRECTIVE,
      runCapability,
    };
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

    // Load turn history — this negotiation's own turns
    const messages = await negotiationMessagesFor(conversationDatabaseAdapter, task);
    const turnNumber = messages.length;

    const history: PickupResult['turn']['history'] = messages.map((m, idx) => {
      const dp = (m.parts as Array<{ kind?: string; data?: NegotiationTurn }>)?.find(
        (p) => p.kind === 'data',
      );
      const turnData = dp?.data;
      // Speaker from senderId, not parity — continuations can start with
      // either side speaking first.
      const speaker: 'source' | 'candidate' = m.senderId
        ? (m.senderId === `agent:${meta.sourceUserId}` ? 'source' : 'candidate')
        : (idx % 2 === 0 ? 'source' : 'candidate');
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

    // Announce the claiming user's seat + allowed actions (v2 client-advocate
    // protocol) so agents don't have to guess the valid vocabulary. Final turns
    // use the terminal-cap vocabulary and never advertise consultation.
    const protocolVersion = (readProtocolVersion(meta) ?? 'v1') as NegotiationProtocolVersion;
    const seat = resolveSeat(userId, meta);
    const isFinalTurn = isNegotiationTurnCapReached(turnNumber + 1, meta.maxTurns);
    const questionerEnqueue = parkedQuestionEnqueue();
    const consultation = assessExternalConsultationEligibility({
      task: {
        id: task.id,
        state: task.state,
        claimedByAgentId: task.claimedByAgentId,
        metadata: meta as unknown as Record<string, unknown>,
      },
      messages: this.persistedTurns(messages),
      userId,
      agentId: task.claimedByAgentId ?? '',
      policyMode: negotiationConsultationPolicyMode(),
      wiring: {
        askUserEnabled: configuredAskUserEnabled(),
        questionerEnabled: Boolean(questionerEnqueue),
        expiryEnabled: typeof negotiationTimeoutQueue.enqueueAskUserExpiry === 'function',
      },
    });

    // P5.3: the claiming user's OWN negotiator memories. Keyed on the claiming
    // userId — the counterparty's memory is unreachable by construction. The
    // adapter resolves [] when the flag is off or retrieval fails.
    const counterpartyUserId = meta.sourceUserId === userId ? meta.candidateUserId : meta.sourceUserId;
    const memoryQueryText = [
      context?.seedAssessment?.reasoning ?? opportunity?.reasoning ?? '',
      context?.discoveryQuery ? `Search: ${context.discoveryQuery}` : '',
      context?.otherUser?.profile?.name ?? '',
      context?.otherUser?.profile?.bio ?? '',
    ].filter(Boolean).join('\n');
    const negotiatorMemory = await negotiatorMemoryRetrievalAdapter.retrieveForNegotiation({
      userId,
      counterpartyUserId,
      queryText: memoryQueryText,
      scope: 'turn',
    });

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
      seat,
      protocolVersion,
      allowedActions: [...allowedActionsFor(protocolVersion, seat, isFinalTurn)],
      canConsultOwner: consultation.eligible,
      context,
      ...(negotiatorMemory.length > 0 && { negotiatorMemory }),
      ...(meta.turnContext?.privateConsultation?.recipientUserId === userId ? {
        privateConsultation: {
          kind: meta.turnContext.privateConsultation.kind,
          selectedOptions: [...meta.turnContext.privateConsultation.selectedOptions],
          ...(meta.turnContext.privateConsultation.freeText ? { freeText: meta.turnContext.privateConsultation.freeText } : {}),
        },
      } : {}),
    };
  }

  /** Project persisted data turns into the pure consultation policy input. */
  private persistedTurns(messages: Array<{ senderId: string; parts: unknown[] }>): ExternalConsultationPersistedTurn[] {
    return messages.flatMap((message) => {
      const part = (message.parts as Array<{ kind?: unknown; data?: unknown }> | undefined)
        ?.find((candidate) => candidate.kind === 'data');
      if (!part?.data || typeof part.data !== 'object' || Array.isArray(part.data)) return [];
      const turn = part.data as Record<string, unknown>;
      const assessment = turn.assessment && typeof turn.assessment === 'object' && !Array.isArray(turn.assessment)
        ? turn.assessment as Record<string, unknown>
        : undefined;
      const roles = assessment?.suggestedRoles && typeof assessment.suggestedRoles === 'object' && !Array.isArray(assessment.suggestedRoles)
        ? assessment.suggestedRoles as Record<string, unknown>
        : undefined;
      return [{
        senderId: message.senderId,
        turn: {
          action: typeof turn.action === 'string' ? turn.action : '',
          ...(roles ? { assessment: { suggestedRoles: {
            ...(typeof roles.ownUser === 'string' ? { ownUser: roles.ownUser } : {}),
            ...(typeof roles.otherUser === 'string' ? { otherUser: roles.otherUser } : {}),
          } } } : {}),
        },
      }];
    });
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
    // Non-terminal last action at finalization means the turn cap was hit.
    const atCap = !isTerminalAction(lastAction);

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

const negotiationPollingAuthorization = new NegotiationPollingAuthorization({
  async getAgentWithRelations(agentId) {
    const { agentDatabaseAdapter } = await import('../adapters/agent.database.adapter');
    return agentDatabaseAdapter.getAgentWithRelations(agentId);
  },
});

/** Singleton negotiation polling service instance. */
export const negotiationPollingService = new NegotiationPollingService();
