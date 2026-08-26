/**
 * The all-paused → reflect trigger.
 *
 * Every pause is a DB transition. The graph's apply step ends by checking
 * whether any active negotiation remains for `(intentId, round)`; if not, it
 * enqueues one reflect job keyed by the durable task-generation vector. Ten
 * deliveries of one drain produce one job, while a later pause after a reopen
 * produces a new one even when the seat binding still names the same round. The consumer
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
  /** Exact durable all-paused state this job drains. */
  generation: string;
}

export type NegotiationRoundReflectCheck = Omit<NegotiationRoundReflectJobData, "generation">;

/** Deterministic job id: duplicate delivery of one durable drain collapses. */
export function negotiationRoundReflectJobId(intentId: string, round: number, generation: string): string {
  return `reflect:${intentId}:${round}:${generation}`;
}

/**
 * Injected callback. The protocol package has no host scheduler;
 * services/api wires this at its composition roots. Called fire-and-forget:
 * a failed start must never affect the negotiation's own pause.
 */
export type NegotiationRoundReflectEnqueueFn = (job: NegotiationRoundReflectJobData) => Promise<void>;

/** The database reads the all-paused check needs. */
export type NegotiationRoundReflectDatabase = Pick<
  NegotiationGraphDatabase,
  "getIntentNegotiationRound" | "getNegotiationTasksForIntentRound"
>;

/**
 * Enqueue exactly one reflect job if this round's task set is complete and
 * every negotiation in it has stopped. Never throws: the caller's own transition is
 * already durable and must not fail over a trigger. Returns false only when
 * the check or enqueue exhausted its retries, so a durable recovery marker
 * can remain pending.
 */
export async function maybeEnqueueRoundReflect(
  database: NegotiationRoundReflectDatabase,
  enqueue: NegotiationRoundReflectEnqueueFn | undefined,
  check: NegotiationRoundReflectCheck,
): Promise<boolean> {
  if (!enqueue) return true;
  try {
    const stamp = await database.getIntentNegotiationRound(check.intentId);
    // A current kickoff has not finished binding all of its tasks yet. A
    // passive/counterparty seat (no kickoff marker) and a superseded round
    // already have their complete durable task sets and need no size gate.
    if (stamp.round === check.round && stamp.roundSize === null && stamp.kickoffStartedAt !== null) return true;
    const tasks = await database.getNegotiationTasksForIntentRound(check.intentId, check.round);
    if (tasks.length === 0 || tasks.some((task) => task.state !== "paused" && task.state !== "completed")) return true;
    const generation = tasks
      .map((task) => `${task.id}.${task.metadata.drainGeneration}`)
      .sort()
      .join("_");
    const job: NegotiationRoundReflectJobData = { ...check, generation };
    // The pause this runs behind is already persisted, so throwing would
    // report a failure for work that is durably done. But a swallowed enqueue
    // on the round's LAST pause is a round that never reflects and has no
    // second chance — nothing pauses again to re-check it. Retry a few times
    // before giving up, and give up loudly.
    let failure: unknown;
    for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt++) {
      try {
        await enqueue(job);
        return true;
      } catch (err) {
        failure = err;
        await new Promise((resolve) => setTimeout(resolve, ENQUEUE_RETRY_DELAY_MS * (attempt + 1)));
      }
    }
    throw failure;
  } catch (err) {
    logger.error("Failed to check all-paused / enqueue reflect — this round will not reflect", {
      intentId: check.intentId,
      round: check.round,
      error: err,
    });
    return false;
  }
}
