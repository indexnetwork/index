/**
 * The all-paused → reflect trigger (rewrite, #1494).
 *
 * Every pause is a DB transition. The graph's apply step ends by checking
 * whether any active negotiation remains for `(intentId, round)`; if not, it
 * enqueues one reflect job, keyed so ten pauses produce one job and a late
 * pause from an earlier round cannot re-trigger the current one.
 *
 * The consumer is a stub in this PR (log + ack) — IS-A's reflect phase lands
 * in step 2. Not to be confused with `negotiation.reflect.ts`'s
 * `NegotiationReflector`, the unrelated pre-existing memory-distillation
 * pass.
 */

export interface NegotiationRoundReflectJobData {
  intentId: string;
  round: number;
}

/** Deterministic job id: ten pauses of the same round collapse to one job. */
export function negotiationRoundReflectJobId(intentId: string, round: number): string {
  return `reflect:${intentId}:${round}`;
}

/**
 * Injected enqueue callback. The protocol package has no BullMQ access;
 * services/api wires this at its composition roots. Called fire-and-forget
 * from the apply node: a failed enqueue must never affect the negotiation's
 * own pause.
 */
export type NegotiationRoundReflectEnqueueFn = (job: NegotiationRoundReflectJobData) => Promise<void>;
