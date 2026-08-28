/**
 * The append-only event log a round's "has everything settled" answer is
 * folded from, replacing the racy quartet of separately-written fields
 * (`negotiation_round`, `negotiation_round_size`, `negotiation_kickoff_started_at`,
 * `metadata.drainGeneration`) that `negotiation.round-reflect.ts` currently
 * reads. Pure, additive logic only — nothing here is wired to a database or
 * called by anything yet.
 *
 * One log per `(intentId, batchId)`. Two things can happen to a task in a
 * batch: it opens once, and it stops (possibly more than once, since a
 * `needs_principal` pause can be answered and the task resumed). `stopped`
 * reuses `NegotiationPauseReasonName` from `negotiation.turn.ts` so this log
 * never invents a second vocabulary for why a task paused.
 *
 * Design question: does a resumed task need its own event kind, or do
 * `opened`/`stopped` alone already answer "is the batch settled" correctly
 * across a resume?
 *
 * Trace a task that pauses, gets resumed, and pauses again, WITHOUT a
 * `resumed` event: the log holds `opened(T)`, `stopped(T)`, `stopped(T)`.
 * A fold that asks "does every opened taskId have a stopped event" cannot
 * tell "T is currently stopped" from "T stopped once, is active again right
 * now, and just happens to have a stopped event somewhere in its past" — it
 * would report the batch settled *before* T's second pause actually lands,
 * which is wrong. And even where that race doesn't bite, a dedupe key built
 * from the deduped set of stopped task ids is identical across T's first and
 * second settle (both include T exactly once), so the second, genuinely
 * distinct drain would collide with the first under the old key and get
 * silently swallowed as a duplicate — the exact bug the fixed counter had.
 *
 * So `resumed` is required, not optional: it is what lets the fold tell "T's
 * most recent transition was a stop" (currently stopped) apart from "T's
 * most recent transition was a resume" (currently active, ignore its earlier
 * stop). With `resumed` in the log, a second full stop cycle produces a
 * *different* current stopped-event position for T than the first cycle did,
 * so the derived dedupe key changes across settles the same way the old
 * incremented `drainGeneration` counter did — except derived from the log
 * instead of a value every resume path had to remember to bump.
 */
import type { NegotiationPauseReasonName } from "./negotiation.turn.js";

export interface NegotiationRoundLogOpenedEvent {
  kind: "opened";
  taskId: string;
  batchId: string;
}

export interface NegotiationRoundLogStoppedEvent {
  kind: "stopped";
  taskId: string;
  batchId: string;
  via: "paused" | "completed";
  reason?: NegotiationPauseReasonName;
}

/** A previously-stopped task got a turn again (e.g. its `needs_principal` pause was answered). */
export interface NegotiationRoundLogResumedEvent {
  kind: "resumed";
  taskId: string;
  batchId: string;
}

/**
 * Appended once, after a kickoff's parallel match-opens have all settled.
 * Replaces the old `negotiation_round_size` stamp: it is the signal that no
 * more `opened` events are coming for this batch, including the zero-tasks
 * case (a kickoff that had nothing to reach out to still settles this batch
 * immediately once this lands).
 */
export interface NegotiationRoundLogOpeningCompleteEvent {
  kind: "opening_complete";
  batchId: string;
}

export type NegotiationRoundLogEvent =
  | NegotiationRoundLogOpenedEvent
  | NegotiationRoundLogStoppedEvent
  | NegotiationRoundLogResumedEvent
  | NegotiationRoundLogOpeningCompleteEvent;

export interface NegotiationRoundLogFoldResult {
  settled: boolean;
  /** Only present when `settled` is true. Distinct across two settles of the same task set. */
  dedupeKey?: string;
}

/**
 * Pure fold over one `(intentId, batchId)`'s event log: no I/O, no clock, no
 * randomness. Settled means (a) an `opening_complete` marker exists for this
 * batch — no more `opened` events are coming — AND (b) every task that ever
 * opened in this batch is, as of the last event touching it, stopped rather
 * than resumed. The dedupe key is built from where in the log each task's
 * *current* stop sits, so a second stop after a resume yields a different key
 * than the first.
 */
export function foldNegotiationRoundLog(events: NegotiationRoundLogEvent[]): NegotiationRoundLogFoldResult {
  const openedTaskIds = new Set<string>();
  // Index (position in `events`) of each task's current stopped event, i.e.
  // the most recent `stopped` not superseded by a later `resumed`. Absent
  // means the task is currently active (never stopped, or resumed since).
  const currentStopIndex = new Map<string, number>();
  let openingComplete = false;

  events.forEach((event, index) => {
    switch (event.kind) {
      case "opened":
        openedTaskIds.add(event.taskId);
        break;
      case "stopped":
        currentStopIndex.set(event.taskId, index);
        break;
      case "resumed":
        currentStopIndex.delete(event.taskId);
        break;
      case "opening_complete":
        openingComplete = true;
        break;
    }
  });

  if (!openingComplete) return { settled: false };
  for (const taskId of openedTaskIds) {
    if (!currentStopIndex.has(taskId)) return { settled: false };
  }

  const dedupeKey = Array.from(openedTaskIds)
    .sort()
    .map((taskId) => `${taskId}.${currentStopIndex.get(taskId)}`)
    .join("_") || "empty";

  return { settled: true, dedupeKey };
}
