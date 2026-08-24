/**
 * Negotiation-specific persistence (rewrite, #1494).
 *
 * A negotiation is its own conversation and its own task — never a pair-wide
 * shared thread. `metadata` carries the negotiation's identity (opportunity,
 * actors, initiator, the intent + round that drove kickoff) and its current
 * pause (reason + payload), so a resumed process reads the same state a live
 * one holds. `brief` is a dedicated field: the one thing IS-A writes at every
 * kickoff and resume.
 */

import type { Opportunity, OpportunityStatus } from './entities.js';
import type { Database } from '../database.js';

/** Negotiation task lifecycle. `paused` carries a reason in `metadata.pause`. */
export type NegotiationTaskState = 'working' | 'paused' | 'completed';

export interface NegotiationTaskMetadata {
  type: 'negotiation';
  opportunityId: string;
  sourceUserId: string;
  candidateUserId: string;
  /** The seat that opened this negotiation; only its opening turn may be `outreach`. */
  initiatorUserId: string;
  networkId: string;
  /** The intent that drove kickoff — the reflect trigger's key, alongside `round`. */
  intentId: string;
  /** Bumped by the caller at every kickoff of a fresh round for `intentId`. */
  round: number;
  /**
   * `payload` is private to `pausedBy` — the seat whose turn produced this
   * pause. It is never persisted into a shared message or returned from a
   * generic invoke; only a read scoped to `pausedBy`'s own principal may see
   * it. Everyone else sees the reason only.
   */
  pause?: { reason: 'counterparty_silent' | 'needs_principal' | 'ready_for_verdict' | 'turn_cap' | 'open_failed'; payload?: unknown; pausedBy?: string } | null;
}

export interface NegotiationTaskRow {
  id: string;
  conversationId: string;
  state: NegotiationTaskState;
  brief: string;
  metadata: NegotiationTaskMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface NegotiationMessageRow {
  id: string;
  senderId: string;
  parts: unknown[];
  createdAt: Date;
}

/**
 * Database dependency for the negotiation graph. Composes generic
 * opportunity/intent/profile reads with the negotiation-specific task and
 * message persistence.
 *
 * Access layer: ConversationDatabaseAdapter
 */
export type NegotiationGraphDatabase = Pick<Database, 'getOpportunity' | 'getIntent' | 'getUserContext'> & {
  /** Creates the negotiation's own conversation — never a pair-shared one. */
  createNegotiationConversation(sourceUserId: string, candidateUserId: string): Promise<{ id: string }>;

  /** Creates the negotiation task. Called once, at open. */
  createNegotiationTask(input: {
    conversationId: string;
    brief: string;
    metadata: NegotiationTaskMetadata;
  }): Promise<NegotiationTaskRow>;

  /** The one open (non-completed) negotiation task for an opportunity, if any. */
  getNegotiationTaskForOpportunity(opportunityId: string): Promise<NegotiationTaskRow | null>;

  getNegotiationTask(taskId: string): Promise<NegotiationTaskRow | null>;

  /** Every negotiation task where the given user is source or candidate. */
  getNegotiationTasksForUser(userId: string): Promise<NegotiationTaskRow[]>;

  /** Transitions state and, for `paused`, records the reason/payload. Merges into metadata; other keys are untouched. */
  updateNegotiationTaskState(
    taskId: string,
    state: NegotiationTaskState,
    pause?: NegotiationTaskMetadata['pause'],
  ): Promise<NegotiationTaskRow>;

  /** Overwrites the brief at resume. */
  setNegotiationBrief(taskId: string, brief: string): Promise<void>;

  /** Stamps metadata.round when an open re-targets an existing task into a freshly bumped round. */
  setNegotiationRound(taskId: string, round: number): Promise<void>;

  /**
   * Persists one turn, fenced against a concurrent duplicate submission:
   * inserts only if the task's current message count still equals
   * `expectedMessageCount` (read by the caller immediately before deciding
   * what to apply). Returns null when the fence fails — the caller must
   * treat that as "someone else already applied a turn," not retry blindly.
   */
  createNegotiationMessage(input: {
    conversationId: string;
    taskId: string;
    senderId: string;
    parts: unknown[];
    expectedMessageCount: number;
  }): Promise<NegotiationMessageRow | null>;

  /** This negotiation's own turns, oldest first. */
  getNegotiationMessages(taskId: string): Promise<NegotiationMessageRow[]>;

  /** Persists the resolve outcome artifact. */
  createNegotiationOutcomeArtifact(taskId: string, outcome: { verdict: 'pending' | 'reject'; reasoning?: string }): Promise<void>;

  /** Reads back artifacts persisted for a task (e.g. the resolve outcome). */
  getArtifactsForTask(taskId: string): Promise<Array<{ id: string; name: string | null; parts: unknown[]; metadata: Record<string, unknown> | null }>>;

  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<{ id: string; status: OpportunityStatus } | null>;

  /** Every negotiation task of one intent's round, whatever its state. Reflect's own read. */
  getNegotiationTasksForIntentRound(intentId: string, round: number): Promise<NegotiationTaskRow[]>;

  /**
   * Opens a new round: bumps `intents.negotiation_round`, clears
   * `negotiation_round_size` and stamps `negotiation_kickoff_started_at`, all
   * in one write. Only kickoff bumps a round, so the bump IS the beginning of
   * a kickoff and there is no gap in which a crash could leave the round
   * begun-but-unmarked. Returns the new round.
   */
  bumpIntentNegotiationRound(intentId: string): Promise<number>;

  /**
   * The intent's round lifecycle: which round it is on, when a kickoff for
   * that round BEGAN (null if none ever did — including every intent that
   * predates round stamping), and the settled size (null until the kickoff
   * finished). `kickoffStartedAt` set with `roundSize` null is the one
   * signature of a kickoff that died mid-round.
   */
  getIntentNegotiationRound(intentId: string): Promise<{ round: number; roundSize: number | null; kickoffStartedAt: Date | null }>;

  /**
   * Stamps how many negotiations this round actually opened. Written once, by
   * kickoff, after every open has settled — the gate the all-paused check
   * waits on. A no-op if the intent has already moved to a later round.
   */
  stampIntentNegotiationRoundSize(intentId: string, round: number, size: number): Promise<void>;

  /** Count of this intent's round-`round` negotiations not yet `paused` or `completed`. Drives the all-paused → reflect trigger. */
  countActiveNegotiationsForRound(intentId: string, round: number): Promise<number>;
};

export type { Opportunity };
