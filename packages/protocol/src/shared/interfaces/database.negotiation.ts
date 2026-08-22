/**
 * Negotiation-specific persistence: continuation receipts, private
 * consultations, and the queries the negotiation graph depends on.
 */

import type { NegotiationOpportunityLifecycle, Opportunity, OpportunityStatus } from './database.entities.js';
import type { Database, SystemDatabase, UserDatabase } from './database.port.js';


/**
 * Negotiation-specific query operations not covered by generic
 * conversation/task primitives.
 */
/** A user's ordinary follow-up answer stored on established shared opportunity metadata. */
export interface NegotiationUserAnswer {
  questionId: string;
  selectedOptions: string[];
  freeText?: string;
  answeredAt: string;
}

export interface NegotiationPrivateConsultation {
  recipientUserId: string;
  recipientIntentId: string;
  kind: 'answer' | 'dismiss' | 'timeout';
  selectedOptions: string[];
  freeText?: string;
}

/**
 * How a negotiation's counterparty is bound to the opportunity.
 *
 * An opportunity actor carries EITHER a stated intent or a premise — premise
 * discovery produces the second kind, and in dev it produces most of them. The
 * park's durable coordinates carry the same polymorphism rather than flattening
 * it to an intent id: requiring an intent made `captureNegotiationAskUserBinding`
 * throw "actor binding is ambiguous" for every premise-bound counterparty, which
 * failed the turn and ended the negotiation as a withdrawal — asking was the one
 * move that could not be made against most of the pool.
 *
 * The kind is what the resume path verifies against. An intent must still be
 * ACTIVE and assigned to the network; a premise must still be ACTIVE, not
 * retracted, and assigned to the network. Both can go stale while a client
 * takes 24h to answer, and both are checked — which is why this is a
 * discriminated binding rather than a nullable id.
 */
export type NegotiationCounterpartyBinding =
  | { kind: 'intent'; id: string }
  | { kind: 'premise'; id: string };

export interface NegotiationContinuationExecution {
  taskId: string;
  settlementId: string;
  opportunityId: string;
  userId: string;
  recipientIntentId: string;
  networkId: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  counterpartyBinding: NegotiationCounterpartyBinding;
  successorTaskId: string;
  conversationId: string;
  token: string;
  fence: number;
  leaseExpiresAt: string;
  consultation: NegotiationPrivateConsultation;
}

export interface NegotiationContinuationReceipt {
  priorTaskId: string;
  settlementId: string;
  successorTaskId: string;
  fence: number;
  outcome: 'accepted' | 'rejected' | 'stalled' | 'waiting_for_agent' | 'input_required';
}

export interface NegotiationQueries {
  /** Capture canonical material binding before arming an ask-user timeout. */
  captureNegotiationAskUserBinding(input: {
    taskId: string;
    turnContext: Record<string, unknown>;
    settlementId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    continuationExecution?: NegotiationContinuationExecution;
  }): Promise<{
    version: 2;
    settlementId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    intentFingerprint: string;
    opportunityStatus: string;
    opportunityUpdatedAt: string;
    counterpartyUserId: string;
    counterpartyBinding: NegotiationCounterpartyBinding;
  }>;

  /**
   * Persists the full negotiation turn context (source/candidate user contexts,
   * seed assessment, index context, discovery query) onto the task metadata so
   * that polling agents can reconstruct the same context the system agent sees
   * in-process. Merges into `metadata.turnContext`, leaving other keys intact.
   * @param taskId - Task whose metadata to enrich
   * @param turnContext - Absolute (source/candidate) view of the negotiation context
   */
  setTaskTurnContext(taskId: string, turnContext: Record<string, unknown>, continuationExecution?: NegotiationContinuationExecution): Promise<void>;

  /**
   * Merges an applied deadlock→bargaining shift record (IND-428) into
   * `metadata.deadlockShift`, leaving other metadata keys intact. Internal
   * analytics only — API surfaces must never project this key. Optional so
   * existing fakes/wireups remain valid; when absent the turn node logs the
   * shift and proceeds without persisting.
   * @param taskId - Task whose metadata to enrich
   * @param deadlockShift - DeadlockShiftRecord (run length, threshold, turn, seat, timing)
   */
  setTaskDeadlockShift?(taskId: string, deadlockShift: Record<string, unknown>, continuationExecution?: NegotiationContinuationExecution): Promise<void>;

  /**
   * Replaces `metadata.failedTurns` with this session's capped failure trace,
   * leaving other metadata keys intact. A failed turn persists no message and
   * no turn, so without this write the failure leaves nothing behind at all
   * and the class can only be reconstructed from timestamps.
   *
   * Replace rather than append: the graph holds the whole capped list in
   * state, so a retried write is idempotent and no read-modify-write race
   * exists. Optional so existing fakes/wireups remain valid; when absent the
   * turn node logs the failure and proceeds.
   * @param taskId - Task whose metadata to enrich
   * @param failedTurns - NegotiationTurnFailure records (at, seat, turnIndex, error)
   */
  setTaskFailedTurns?(taskId: string, failedTurns: Array<Record<string, unknown>>, continuationExecution?: NegotiationContinuationExecution): Promise<void>;

  /**
   * Returns the most-recently-created task whose metadata carries
   * `type: 'negotiation'` and `opportunityId: <id>`. Returns null if no
   * negotiation has been started for that opportunity yet.
   */
  getNegotiationTaskForOpportunity(opportunityId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;

  /**
   * Returns the most-recently-created task whose metadata carries
   * `type: 'negotiation'` on the given conversation, regardless of
   * opportunityId or direction. Used by the init node's conversation-scoped
   * tie-break: symmetric concurrent starts carry different opportunityIds, so
   * the opportunity-scoped lookup above cannot see the competing task.
   * Optional so existing fakes/wireups remain valid; when absent the
   * tie-break is skipped (pre-stamp behavior).
   */
  getLatestNegotiationTaskForConversation?(conversationId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;

  /**
   * Returns user answers collected by the questioner system for a given
   * opportunity. Reads `metadata.userAnswers` from the opportunities table.
   * Used by the negotiation graph to inject between-session context into
   * continuation prompts.
   */
  getOpportunityUserAnswers(opportunityId: string): Promise<NegotiationUserAnswer[]>;
}

/**
 * Database dependency for the negotiation graph (A2A conversation/task/artifact
 * persistence). Composes generic conversation ops with negotiation-specific queries.
 *
 * Access layer: ConversationDatabaseAdapter
 */
export type NegotiationGraphDatabase = Pick<
  Database,
  | 'getOrCreateDM'
  // Global user_context paragraph for questioner negotiation prompts
  | 'getUserContext'
> & NegotiationQueries & {
  /**
   * Update the status of an opportunity. Called from the negotiation graph to
   * advance the opportunity lifecycle (negotiating -> pending/rejected/stalled).
   * Returns only the narrow { id, status } needed by the graph, not the full Opportunity.
   */
  updateOpportunityStatus(
    id: string,
    status: OpportunityStatus,
    acceptedBy?: string,
    continuationExecution?: NegotiationContinuationExecution,
  ): Promise<{ id: string; status: OpportunityStatus } | null>;
  /** Persists a negotiation turn message within a conversation. */
  createMessage(data: {
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId?: string;
    metadata?: Record<string, unknown> | null;
    continuationExecution?: NegotiationContinuationExecution;
  }): Promise<{ id: string; senderId: string; role: 'user' | 'agent'; parts: unknown; createdAt: Date }>;

  /**
   * Atomically claims an exact persisted opportunity attempt, promotes it to
   * negotiating, and creates its task. Returns null when the status/version is
   * stale or another qualifying task already owns the attempt.
   */
  createNegotiationTaskForAttempt(input: {
    conversationId: string;
    opportunityId: string;
    expectedStatus: OpportunityStatus;
    expectedUpdatedAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; conversationId: string; state: string } | null>;

  /** Creates a generic task to track a non-attempt-bound lifecycle. */
  createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversationId: string; state: string }>;

  /**
   * Under a deterministic settlement lock, validate the exact canceled ask_user
   * task and return its existing successor or create one. Never consults a
   * latest-task lookup.
   */
  getOrCreateNegotiationContinuationTask(input: {
    priorTaskId: string;
    settlementId: string;
    conversationId: string;
    opportunityId: string;
    metadata: Record<string, unknown>;
  }): Promise<{ id: string; conversationId: string; state: string; created: boolean } | null>;

  /** Transitions a task to a new state (e.g. working, completed, failed). */
  updateTaskState(
    taskId: string,
    state: string,
    statusMessage?: unknown,
    continuationExecution?: NegotiationContinuationExecution,
    parkGeneration?: string,
  ): Promise<{ id: string; conversationId: string; state: string }>;

  /** Persists a negotiation outcome artifact attached to a task. */
  createArtifact(data: { taskId: string; name?: string; parts: unknown[]; metadata?: Record<string, unknown> | null; continuationExecution?: NegotiationContinuationExecution }): Promise<{ id: string }>;

  /** Lists negotiation tasks where the given user is source or candidate. */
  getTasksForUser(userId: string, options?: { state?: string }): Promise<Array<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>>;

  /**
   * Resolves each opportunity to the intent carried by the given user's actor.
   * Missing opportunities or actor intents are returned as null so callers can
   * enforce fail-closed scope filtering for legacy task metadata.
   */
  getIntentIdsForOpportunities(opportunityIds: string[], userId: string): Promise<Record<string, string | null>>;

  /**
   * Batch-loads current opportunity lifecycle evidence for negotiation
   * narration. Implementations must omit opportunities that do not contain the
   * authenticated owner actor. Optional for backward-compatible hosts; callers
   * must treat a missing implementation as unavailable evidence, never as acceptance.
   */
  getOpportunityLifecyclesForNegotiations?(
    opportunityIds: string[],
    ownerUserId: string,
  ): Promise<Record<string, NegotiationOpportunityLifecycle>>;

  /** Gets a specific task by ID. */
  getTask(taskId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;

  /**
   * Gets all messages for a conversation, ordered by creation time.
   *
   * `taskId` is the originating negotiation task (IND-569). Optional so legacy
   * hosts remain valid; when omitted, prior negotiation turns cannot be
   * attributed to their opportunity and degrade to the unattributed
   * prior-dialogue block rather than being mixed into the current opportunity.
   */
  getMessagesForConversation(conversationId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
    taskId?: string | null;
  }>>;

  /**
   * Gets the messages belonging to ONE negotiation — those written by tasks
   * carrying `type: 'negotiation'` and the given `opportunityId` — ordered by
   * creation time.
   *
   * A negotiation is keyed by opportunity, not by task: an `ask_user` pause
   * parks its task and resumes into a pre-claimed successor, so one negotiation
   * spans several tasks. This is the read behind every question ABOUT a
   * negotiation (whose turn it is, whether it has opened, how many turns it has
   * run). `getMessagesForConversation` remains the read for conversation-wide
   * CONTEXT — prior matches between the same pair — which must never determine
   * a negotiation's own state.
   *
   * Messages with no `taskId`, or whose task carries no opportunityId, are not
   * part of any negotiation and are never returned here.
   */
  getNegotiationMessages(opportunityId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
    taskId?: string | null;
  }>>;

  /** Gets artifacts for a task (e.g. negotiation outcome). */
  getArtifactsForTask(taskId: string): Promise<Array<{
    id: string;
    name: string | null;
    parts: unknown[];
    metadata: Record<string, unknown> | null;
  }>>;
};

/**
 * Database interface for opportunity controller (API).
 *
 * Access layer: Both UserDatabase + SystemDatabase (API handles auth)
 */
/**
 * Optional atomic outbox for Lens B outcome capture (IND-434). Passed to a
 * winning owner-action transition so the append-only outcome event is written
 * in the SAME transaction as the status change:
 *   - a rolled-back action leaves NO event;
 *   - a committed eligible action produces EXACTLY one event;
 *   - `result.inserted` is set to true by the adapter only when a NEW row was
 *     written (idempotent retries / duplicates set it false), so the caller can
 *     gate post-commit mining on a genuine first insert.
 *
 * `event` is typed `unknown` (the api-side outcome-event insert row, cast by the
 * adapter) to keep the protocol layer free of database-schema imports. The
 * actor-resolution mode is a transaction-time precondition: selected-intent
 * captures require that exact actor intent, while unscoped captures require the
 * recipient to still have one unambiguous actor-intent scope.
 */
