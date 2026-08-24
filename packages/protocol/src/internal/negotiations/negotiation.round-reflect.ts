/**
 * The all-paused → reflect trigger.
 *
 * Every pause is a DB transition. The graph's apply step ends by checking
 * whether any active negotiation remains for `(intentId, round)`; if not, it
 * enqueues one reflect job, keyed so ten pauses produce one job and a late
 * pause from an earlier round cannot re-trigger the current one. The consumer
 * invokes the PersonalAgent with `{ userId, intentId, event: 'all_paused',
 * round }`.
 *
 * The check is gated on the round's SIZE stamp. Kickoff opens a round's
 * negotiations in parallel and stamps the size only once every open has
 * settled; until then this is a no-op, because an early first pause would
 * otherwise see zero working tasks before its siblings had created theirs and
 * the deterministic job id would dedupe away the round's genuine reflect.
 * Kickoff runs one final check itself, right after stamping, to cover the
 * pauses that landed before it.
 *
 * Not to be confused with `negotiation.reflect.ts`'s `NegotiationReflector`,
 * the unrelated memory-distillation pass.
 */
import type { NegotiationGraphDatabase } from "../../platform/database/negotiation.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";

const logger = protocolLogger("NegotiationRoundReflect");

const ENQUEUE_ATTEMPTS = 3;
const ENQUEUE_RETRY_DELAY_MS = 100;

export interface NegotiationRoundReflectJobData {
  /** The signal's owner — the principal whose PersonalAgent reflects. */
  userId: string;
  intentId: string;
  round: number;
}

/** Deterministic job id: ten pauses of the same round collapse to one job. */
export function negotiationRoundReflectJobId(intentId: string, round: number): string {
  return `reflect:${intentId}:${round}`;
}

/**
 * Injected enqueue callback. The protocol package has no BullMQ access;
 * services/api wires this at its composition roots. Called fire-and-forget:
 * a failed enqueue must never affect the negotiation's own pause.
 */
export type NegotiationRoundReflectEnqueueFn = (job: NegotiationRoundReflectJobData) => Promise<void>;

/** The database reads the all-paused check needs. */
export type NegotiationRoundReflectDatabase = Pick<
  NegotiationGraphDatabase,
  "getIntentNegotiationRound" | "countActiveNegotiationsForRound"
>;

/**
 * Enqueue exactly one reflect job if this round is stamped and every one of
 * its negotiations has stopped. Never throws: the caller's own transition is
 * already durable and must not fail over a trigger.
 */
export async function maybeEnqueueRoundReflect(
  database: NegotiationRoundReflectDatabase,
  enqueue: NegotiationRoundReflectEnqueueFn | undefined,
  job: NegotiationRoundReflectJobData,
): Promise<void> {
  if (!enqueue) return;
  try {
    const stamp = await database.getIntentNegotiationRound(job.intentId);
    // Unstamped, or already superseded by a fresh kickoff: not this round's moment.
    if (stamp.round !== job.round || stamp.roundSize === null) return;
    const active = await database.countActiveNegotiationsForRound(job.intentId, job.round);
    if (active !== 0) return;
    // The pause this runs behind is already persisted, so throwing would
    // report a failure for work that is durably done. But a swallowed enqueue
    // on the round's LAST pause is a round that never reflects and has no
    // second chance — nothing pauses again to re-check it. Retry a few times
    // before giving up, and give up loudly.
    let failure: unknown;
    for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt++) {
      try {
        await enqueue(job);
        return;
      } catch (err) {
        failure = err;
        await new Promise((resolve) => setTimeout(resolve, ENQUEUE_RETRY_DELAY_MS * (attempt + 1)));
      }
    }
    throw failure;
  } catch (err) {
    logger.error("Failed to check all-paused / enqueue reflect — this round will not reflect", {
      intentId: job.intentId,
      round: job.round,
      jobId: negotiationRoundReflectJobId(job.intentId, job.round),
      error: err,
    });
  }
}
