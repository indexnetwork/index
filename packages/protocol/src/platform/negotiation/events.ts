/**
 * Interfaces for negotiation timeout support (rewrite, #1494).
 *
 * Used by the host to arm/cancel the delayed job that turns a stalled
 * negotiation into a `{ negotiationId, pause: 'counterparty_silent' }`
 * graph invoke.
 */

export interface NegotiationTimeoutQueue {
  /**
   * Enqueue a delayed timeout job.
   * @param negotiationId - The negotiation task ID
   * @param turnCount - Turn count at enqueue time (used to detect stale jobs)
   * @param delayMs - Delay in milliseconds before the timeout fires
   * @returns The job ID, for cancellation
   */
  enqueueTimeout(negotiationId: string, turnCount: number, delayMs: number): Promise<string>;

  /** Cancel a pending timeout job for a negotiation (a turn landed before it fired). */
  cancelTimeout(negotiationId: string, jobId: string): Promise<void>;
}
