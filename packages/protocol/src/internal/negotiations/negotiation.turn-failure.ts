/**
 * Failed negotiation turns: the durable trace and the bound that ends a run.
 *
 * A failed turn is not a decision (that rule shipped with the checklist
 * negotiations) and it is not a TURN either. A provider timeout, a dropped
 * connection or a throw in the park machinery says nothing about the match, so
 * it must not spend the dialogue budget the two agents were given to reach an
 * agreement — and it must leave something behind, because a failure that
 * writes nothing can only be investigated by timing arithmetic over the rows
 * that DID get written.
 *
 * What replaces the spent turn is a consecutive-failure count: the same seat
 * retries, and a run that cannot get a turn out of its agent after
 * {@link MAX_CONSECUTIVE_TURN_FAILURES} attempts ends error-stalled rather
 * than running the budget down into a fake "out of turns" outcome. The bound
 * is the terminator — the retry edge has no other exit.
 */

import type { NegotiationSeat } from "../../protocol/schemas/negotiation-state.schema.js";

/**
 * Consecutive failed turns tolerated before a negotiation ends error-stalled.
 *
 * Two, not more: the failures this bounds are correlated (a provider outage,
 * an oversized prompt, a throw on data this negotiation carries), so a third
 * attempt mostly buys latency. One retry is what turns the common case — a
 * single tail-latency abort — into an ordinary turn.
 */
export const MAX_CONSECUTIVE_TURN_FAILURES = 2;

/** How many failure records a task keeps. Diagnosis needs the tail, not a log. */
export const MAX_RECORDED_TURN_FAILURES = 5;

/** Longest error text kept per record; enough to identify the class. */
const MAX_RECORDED_ERROR_LENGTH = 300;

/** One failed turn, as recorded on the task. */
export interface NegotiationTurnFailure {
  /** ISO timestamp of the failure. */
  at: string;
  /** Seat whose turn failed — the acting side, not the initiator. */
  seat: NegotiationSeat;
  /** Turn index the failure happened AT; the count does not advance past it. */
  turnIndex: number;
  /** Error message, truncated. */
  error: string;
}

/**
 * Append a failure to the recorded trace, keeping the most recent
 * {@link MAX_RECORDED_TURN_FAILURES}. The tail is what ended the run, so it is
 * the half worth keeping when the cap bites.
 */
export function appendTurnFailure(
  recorded: readonly NegotiationTurnFailure[],
  failure: NegotiationTurnFailure,
): NegotiationTurnFailure[] {
  const next = [...recorded, { ...failure, error: failure.error.slice(0, MAX_RECORDED_ERROR_LENGTH) }];
  return next.slice(-MAX_RECORDED_TURN_FAILURES);
}

/** Whether this many consecutive failures ends the negotiation. */
export function turnFailureBoundReached(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_TURN_FAILURES;
}

/**
 * Whether a failure text is a timeout/abort.
 *
 * `AbortSignal.timeout` rejects with "The operation timed out." — which the
 * previous `/timeout/i` test missed, so the one failure class the negotiator
 * times out on was never classified as a timeout anywhere downstream.
 */
export function isTimeoutFailure(error: string | null | undefined): boolean {
  return !!error && /timed\s*out|timeout|abort/i.test(error);
}
