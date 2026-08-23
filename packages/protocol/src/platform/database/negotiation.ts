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
  pause?: { reason: 'counterparty_silent' | 'needs_principal' | 'ready_for_verdict'; payload?: unknown } | null;
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

  /** Transitions state and, for `paused`, records the reason/payload. Merges into metadata; other keys are untouched. */
  updateNegotiationTaskState(
    taskId: string,
    state: NegotiationTaskState,
    pause?: NegotiationTaskMetadata['pause'],
  ): Promise<NegotiationTaskRow>;

  /** Overwrites the brief at resume. */
  setNegotiationBrief(taskId: string, brief: string): Promise<void>;

  /** Persists one turn. */
  createNegotiationMessage(input: {
    conversationId: string;
    taskId: string;
    senderId: string;
    parts: unknown[];
  }): Promise<NegotiationMessageRow>;

  /** This negotiation's own turns, oldest first. */
  getNegotiationMessages(taskId: string): Promise<NegotiationMessageRow[]>;

  /** Persists the resolve outcome artifact. */
  createNegotiationOutcomeArtifact(taskId: string, outcome: { verdict: 'pending' | 'reject'; reasoning?: string }): Promise<void>;

  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<{ id: string; status: OpportunityStatus } | null>;

  /** Bumps `intents.negotiation_round` for `intentId` and returns the new value. Called once per kickoff. */
  bumpIntentNegotiationRound(intentId: string): Promise<number>;

  /** Count of this intent's round-`round` negotiations not yet `paused` or `completed`. Drives the all-paused → reflect trigger. */
  countActiveNegotiationsForRound(intentId: string, round: number): Promise<number>;
};

export type { Opportunity };
