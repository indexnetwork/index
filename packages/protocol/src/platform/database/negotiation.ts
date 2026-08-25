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

import type { Opportunity } from './entities.js';
import type { Database } from '../database.js';

/** Negotiation task lifecycle. `paused` carries a reason in `metadata.pause`. */
export type NegotiationTaskState = 'submitted' | 'working' | 'paused' | 'completed';

/** One seat's binding to a signal, and that signal's kickoff round. */
export interface NegotiationSeatBinding {
  /** The seat that owns the signal this entry is keyed by. */
  userId: string;
  /** The round of that signal's kickoff which last targeted this negotiation. */
  round: number;
}

export interface NegotiationTaskMetadata {
  type: 'negotiation';
  opportunityId: string;
  sourceUserId: string;
  candidateUserId: string;
  /** The seat that opened this negotiation; only its opening turn may be `outreach`. */
  initiatorUserId: string;
  networkId: string;
  /**
   * The signals this negotiation belongs to — ONE ENTRY PER SEAT, keyed by
   * intent id.
   *
   * Never a single value. A negotiation genuinely belongs to two signals, one
   * per seat, exactly as `briefs` does: the design doc's terminator rule is
   * that a side which wants out pauses `ready_for_verdict(reject)` and ITS
   * OWN IS-A rejects, and an IS-A can only decide a negotiation its own
   * signal can see. With one owning intent the counterparty's agent could
   * speak here but never promote or reject, which deletes half the loop's
   * terminators — and a re-kick from that side would either overwrite the
   * opener's round or be refused.
   *
   * Creation binds both seats after verifying each actor's intent ownership;
   * a later kickoff updates only its own seat's round.
   */
  seats: Record<string, NegotiationSeatBinding>;
  /**
   * Monotonic generation of this task's paused lifecycle. The opening run is
   * generation 0; the first persisted turn after each pause increments it.
   * An all-paused drain is deduplicated by the durable vector of these values,
   * so reopening a task creates a new drain without duplicating one pause.
   */
  drainGeneration: number;
  /** True between atomic verdict completion and a successful round-reflect check. */
  watchdogReflectPending?: boolean;
  /** Fairness cursor for bounded watchdog sweeps; ISO-8601 when last checked. */
  watchdogRecoveryCheckedAt?: string;
  /**
   * `payload` is private to `pausedBy` — the seat whose turn produced this
   * pause. It is never persisted into a shared message or returned from a
   * generic invoke; only a read scoped to `pausedBy`'s own principal may see
   * it. Everyone else sees the reason only.
   */
  pause?: { reason: 'counterparty_silent' | 'needs_principal' | 'ready_for_verdict' | 'turn_cap' | 'open_failed'; payload?: unknown; pausedBy?: string; failure?: string } | null;
}

export interface NegotiationTaskRow {
  id: string;
  conversationId: string;
  state: NegotiationTaskState;
  /**
   * One brief PER SEAT, keyed by the seat's userId.
   *
   * Never one shared string: a brief is what a seat's own IS-A tells it about
   * its own principal, so handing the initiator's to the counterparty makes
   * the counterparty argue someone else's constraints as if they were its
   * client's. A seat with no entry here has its own agent author one at its
   * first turn.
   */
  briefs: Record<string, string>;
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
  /**
   * Atomically opens the one live negotiation for an eligible opportunity.
   * `knownTaskId` is the task the caller observed before this write, if any:
   * the result distinguishes that genuine re-kick from a task another opener
   * created after the caller's read. The write boundary revalidates eligibility.
   */
  openNegotiationTask(input: {
    opportunityId: string;
    sourceUserId: string;
    candidateUserId: string;
    brief: string;
    seats: Record<string, NegotiationSeatBinding>;
    networkId: string;
    knownTaskId?: string;
  }): Promise<{ task: NegotiationTaskRow; disposition: 'created' | 'existing' | 'raced' } | null>;

  /** The one open negotiation task for an opportunity, or its latest completed task when requested. */
  getNegotiationTaskForOpportunity(opportunityId: string, options?: { includeCompleted?: boolean }): Promise<NegotiationTaskRow | null>;

  getNegotiationTask(taskId: string): Promise<NegotiationTaskRow | null>;

  /** Every negotiation task where the given user is source or candidate. */
  getNegotiationTasksForUser(userId: string): Promise<NegotiationTaskRow[]>;

  /**
   * Transitions state and, for `paused`, records the reason/payload. Moving a
   * paused task back to `working` also increments its durable drain generation.
   */
  updateNegotiationTaskState(
    taskId: string,
    state: 'working' | 'paused' | 'completed',
    pause?: NegotiationTaskMetadata['pause'],
  ): Promise<NegotiationTaskRow>;

  /** Completes a still-paused task and expires its opportunity atomically. */
  expirePausedNegotiation(input: {
    taskId: string;
    expectedUpdatedAt: Date;
    reason: 'counterparty_silent' | 'needs_principal';
  }): Promise<NegotiationTaskRow | null>;

  /** Writes ONE seat's brief, leaving the other seat's untouched. */
  setNegotiationBrief(taskId: string, userId: string, brief: string): Promise<void>;

  /**
   * Binds ONE seat's signal and round to this negotiation, leaving every other
   * seat's binding untouched. Written at open and at every re-kick.
   */
  bindNegotiationSeat(taskId: string, intentId: string, binding: NegotiationSeatBinding): Promise<void>;

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

  /**
   * Atomically records an outcome and completes its task. A pause verdict also
   * locks the opportunity and updates it only while it is still non-terminal;
   * an owner verdict requires a terminal host write, while expiry requires the
   * opportunity to be expired and records no owner outcome. Returns null when
   * the task or opportunity changed before the transaction acquired its locks.
   */
  completeNegotiation(input: {
    taskId: string;
  } & (
    | {
      kind: 'pause_verdict' | 'owner_verdict';
      verdict: 'pending' | 'reject';
      reasoning?: string;
      resolvedByUserId: string;
    }
    | { kind: 'opportunity_expired' }
  )): Promise<NegotiationTaskRow | null>;

  /** Clears the durable post-verdict reflect marker after a successful check. */
  clearNegotiationReflectPending(taskId: string): Promise<void>;

  /** Reads back artifacts persisted for a task (e.g. the resolve outcome). */
  getArtifactsForTask(taskId: string): Promise<Array<{ id: string; name: string | null; parts: unknown[]; metadata: Record<string, unknown> | null }>>;

  /** Every negotiation task bound to one intent's given round, whatever its state. The round-settling read. */
  getNegotiationTasksForIntentRound(intentId: string, round: number): Promise<NegotiationTaskRow[]>;

  /**
   * Every PAUSED, unresolved negotiation of one signal, whatever round it
   * belongs to — what IS-A reasons over.
   *
   * Deliberately not round-scoped. A negotiation a later kickoff left behind
   * (a spent turn budget, most often) keeps its old round and would vanish
   * from a round-scoped read forever: never promoted, never rejected, its
   * opportunity negotiating for good and its principal never told.
   */
  getPausedNegotiationTasksForIntent(intentId: string): Promise<NegotiationTaskRow[]>;

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
