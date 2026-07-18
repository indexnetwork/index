/**
 * Interfaces for negotiation yield/resume support.
 * Used by the negotiation graph and dispatcher to manage timeouts
 * for external agents that haven't responded yet.
 */

/**
 * Manages delayed timeout jobs for negotiations waiting on external agents.
 * When a negotiation yields, a timeout is enqueued. If the external agent
 * responds before the timeout, the job is cancelled.
 */
export interface NegotiationTimeoutQueue {
  /**
   * Enqueue a delayed timeout job.
   * @param negotiationId - The negotiation task ID
   * @param turnNumber - Current turn number (used to detect stale jobs)
   * @param delayMs - Delay in milliseconds before the timeout fires
   * @returns The BullMQ job ID for cancellation
   */
  enqueueTimeout(negotiationId: string, turnNumber: number, delayMs: number): Promise<string>;

  /**
   * Cancel a pending timeout job for a negotiation.
   * @param negotiationId - The negotiation task ID
   */
  cancelTimeout(negotiationId: string): Promise<void>;

  /**
   * Arm the answer-window timer for an `ask_user` pause (P3.2). Fires after
   * `delayMs` (typically 24 h); the worker resumes the negotiation with a
   * conservative no-disclosure default when the task is still
   * `input_required`, and no-ops otherwise (stale job).
   *
   * Optional so fakes and pre-P3.2 implementations stay valid; the graph only
   * offers `ask_user` when this method is present.
   *
   * @param negotiationId - The paused negotiation task ID
   * @param payload - Resume coordinates + observability context
   * @param delayMs - Delay before the expiry fires
   * @returns The job ID for cancellation
   */
  enqueueAskUserExpiry?(
    negotiationId: string,
    payload: AskUserExpiryPayload,
    delayMs: number,
  ): Promise<string>;

  /**
   * Cancel a pending ask_user answer-window timer (the client answered in
   * time, or the negotiation reached a terminal state another way).
   * @param negotiationId - The paused negotiation task ID
   */
  cancelAskUserExpiry?(negotiationId: string): Promise<void>;
}

/** Payload carried by an ask_user answer-window expiry job. */
export interface AskUserExpiryPayload {
  /** Opportunity to resume via the run-existing continuation path. */
  opportunityId: string;
  /** The asking side's client (the user who was asked and did not answer). */
  userId: string;
  /** What the negotiator wanted permission to share / needed to know. */
  disclosureSubject: string;
}
