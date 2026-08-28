/**
 * The all-paused → reflect trigger.
 *
 * Every pause/resume/completion is appended to the batch's round-log
 * (`negotiation.round-log.ts`). The graph's apply/resolve/close/expire steps
 * end by folding that log; if it says the batch is settled, one reflect job
 * is enqueued, keyed by the fold's own dedupe key so redelivery — or a second,
 * genuinely distinct settle after a resume — behaves correctly. The consumer
 * invokes the PersonalAgent with `{ userId, intentId, event: 'all_paused',
 * batchId }`.
 *
 * Not to be confused with `negotiation.reflect.ts`'s `NegotiationReflector`,
 * the unrelated memory-distillation pass.
 */
import type { NegotiationRoundLogDatabase } from "../../platform/database/negotiation.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { foldNegotiationRoundLog, type NegotiationRoundLogEvent } from "./negotiation.round-log.js";

const logger = protocolLogger("NegotiationRoundReflect");

const ENQUEUE_ATTEMPTS = 3;
const ENQUEUE_RETRY_DELAY_MS = 100;

export interface NegotiationRoundReflectJobData {
  /** The signal's owner — the principal whose PersonalAgent reflects. */
  userId: string;
  intentId: string;
  batchId: string;
  /** The fold's dedupe key for this settle — distinct across two settles of the same batch. */
  dedupeKey: string;
}

export type NegotiationRoundReflectCheck = Omit<NegotiationRoundReflectJobData, "dedupeKey">;

/** Deterministic job id: duplicate delivery of one durable settle collapses. */
export function negotiationRoundReflectJobId(intentId: string, batchId: string, dedupeKey: string): string {
  // BullMQ rejects custom ids containing `:`. Keep the durable components,
  // but use a safe separator so a real all-paused check can reach its agent.
  return `reflect.${intentId}.${batchId}.${dedupeKey}`;
}

/**
 * Injected enqueue callback. The protocol package has no BullMQ access;
 * services/api wires this at its composition roots. Called fire-and-forget:
 * a failed enqueue must never affect the negotiation's own pause.
 */
export type NegotiationRoundReflectEnqueueFn = (job: NegotiationRoundReflectJobData) => Promise<void>;

/**
 * Enqueue exactly one reflect job if this batch's event log folds settled.
 * Never throws: the caller's own transition is already durable and must not
 * fail over a trigger. Returns false only when the check or enqueue
 * exhausted its retries, so a durable recovery marker can remain pending.
 */
export async function maybeEnqueueRoundReflect(
  roundLog: NegotiationRoundLogDatabase,
  enqueue: NegotiationRoundReflectEnqueueFn | undefined,
  check: NegotiationRoundReflectCheck,
): Promise<boolean> {
  if (!enqueue) {
    logger.warn("Skipping all-paused reflect because no enqueue handler is configured", {
      intentId: check.intentId,
      batchId: check.batchId,
    });
    return true;
  }
  try {
    const events = await roundLog.readNegotiationRoundLogEvents(check.intentId, check.batchId);
    const fold = foldNegotiationRoundLog(events as NegotiationRoundLogEvent[]);
    if (!fold.settled || fold.dedupeKey === undefined) {
      logger.info("Deferring all-paused reflect because the batch is not settled", {
        intentId: check.intentId,
        batchId: check.batchId,
        eventCount: events.length,
      });
      return true;
    }
    const job: NegotiationRoundReflectJobData = { ...check, dedupeKey: fold.dedupeKey };
    // The pause this runs behind is already persisted, so throwing would
    // report a failure for work that is durably done. But a swallowed enqueue
    // on the batch's LAST pause is a batch that never reflects and has no
    // second chance — nothing pauses again to re-check it. Retry a few times
    // before giving up, and give up loudly.
    let failure: unknown;
    for (let attempt = 0; attempt < ENQUEUE_ATTEMPTS; attempt++) {
      try {
        await enqueue(job);
        logger.info("Enqueued all-paused reflect", {
          intentId: check.intentId,
          batchId: check.batchId,
          dedupeKey: fold.dedupeKey,
        });
        return true;
      } catch (err) {
        failure = err;
        await new Promise((resolve) => setTimeout(resolve, ENQUEUE_RETRY_DELAY_MS * (attempt + 1)));
      }
    }
    throw failure;
  } catch (err) {
    logger.error("Failed to check all-paused / enqueue reflect — this batch will not reflect", {
      intentId: check.intentId,
      batchId: check.batchId,
      error: err,
    });
    return false;
  }
}
