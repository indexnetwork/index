/**
 * IntentAgent events and acts (docs/plans/2026-08-21-holistic-intent-agent.md).
 *
 * An EVENT is what wakes the agent; an ACT is what it decided; an EXECUTED
 * ACT is the decision plus the durable effects code performed for it. The
 * ledger stores (event, act) pairs — every judgment answers "who decided
 * this?" with "the agent did, here, in response to this".
 */

/** A user message landed in the signal's negotiator DM. */
export interface IntentAgentUserMessageEvent {
  kind: 'user_message';
  userId: string;
  intentId: string;
  /** The DM session the message landed in. */
  sessionId: string;
  /** Persisted id of the user's message; keys the inbox job's dedup. */
  messageId: string;
  /** The message, verbatim. */
  text: string;
}

/** A negotiation turn emitted ask_user and parked awaiting this user. */
export interface IntentAgentNeedsInputEvent {
  kind: 'negotiation_needs_input';
  userId: string;
  intentId: string;
  opportunityId: string;
  /** The parked exact task, when the park family carries one. */
  taskId?: string;
}

/**
 * An answer arrived through a tool lane rather than the inbox — the
 * negotiator persona's `answer_pending_question` or its MCP twin. Not an
 * inbox event: the executor runs directly (the spine below it is
 * settlement-keyed and idempotent), but the ledger still records what woke
 * the act.
 */
export interface IntentAgentAnswerToolEvent {
  kind: 'answer_tool';
  userId: string;
  intentId: string;
  opportunityId: string;
  source: 'persona_tool' | 'mcp_tool';
}

export type IntentAgentInboxEvent = IntentAgentUserMessageEvent | IntentAgentNeedsInputEvent;
export type IntentAgentEvent = IntentAgentInboxEvent | IntentAgentAnswerToolEvent;

// ─── Decided acts (model output, ids already resolved from indices) ─────────

export type IntentAgentDecidedAct =
  | { tool: 'message_user'; text: string }
  | { tool: 'answer_negotiation'; opportunityId: string; answer: string }
  | { tool: 'note_dossier'; text: string }
  | { tool: 'retire_dossier'; entryId: string }
  | { tool: 'wait'; reason?: string };

// ─── Executed acts (decision + durable effects) ─────────────────────────────

export type NegotiationAnswerOutcome =
  | 'resumed_inflight'
  | 'resumed_retry'
  | 'recorded_unresumable'
  | 'not_parked'
  | 'no_negotiation'
  | 'wrong_recipient';

export type IntentAgentExecutedAct =
  | { tool: 'message_user'; text: string; sessionId: string; messageId: string }
  | {
    tool: 'answer_negotiation';
    opportunityId: string;
    answer: string;
    /** The dossier entry the resume was fed from (source 'answer'). */
    dossierEntryId: string;
    outcome: NegotiationAnswerOutcome;
    /** Fixed honest copy delivered when the negotiation cannot continue. */
    unresumableCopyMessageId?: string;
  }
  | { tool: 'note_dossier'; text: string; entryId: string }
  | { tool: 'retire_dossier'; entryId: string; retired: boolean }
  | { tool: 'wait'; reason?: string };

/** One completed turn: what the agent did, plus what the client should see. */
export interface IntentAgentTurnResult {
  acts: IntentAgentExecutedAct[];
  /**
   * Every text delivered into the DM by this turn, in delivery order — the
   * agent's own messages plus any fixed honest copy the executor appended.
   * The chat controller emits these as the turn's response.
   */
  messages: string[];
}
