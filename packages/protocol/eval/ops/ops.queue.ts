import type { ExecutionStep, RunExecutor } from "./ops.executor.js";
import { isProcessAlive as defaultIsProcessAlive, isTerminalStatus, type RunStore } from "./ops.store.js";
import type { OpsHarness, RunRecord } from "./ops.types.js";

/**
 * Concurrency defaults to 1: evals cost real tokens and share provider rate
 * limits, so concurrent runs make both logs and spend unattributable.
 */
export function resolveConcurrency(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.EVAL_OPS_MAX_CONCURRENT_RUNS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Harnesses of which at most one run may exist at a time, and why — null for a
 * harness that may run alongside itself.
 *
 * The reason is here rather than at the refusal because it is the same fact: a
 * message that explained a rule this table does not state, or stated one it does
 * not enforce, would be worse than no message. Every refusal composes this text
 * (see `exclusiveRefusal` in ops.server.ts), so the two cannot drift.
 *
 * `EVAL_OPS_MAX_CONCURRENT_RUNS` is the operator's answer to "how much may this
 * machine spend at once", and it is the wrong instrument here: discovery
 * resets and then runs against two *named* Neon branches (`eval-ab-a` and
 * `eval-ab-b`, AB_BRANCH_NAMES in services/api/src/cli/discovery.neon.ts),
 * which every run of it shares. Two at once would reset each other's databases
 * mid-run. No setting may make that reachable.
 *
 * The four scorecard harnesses share nothing a second run could corrupt — they
 * read a fixture and write their own artifact — so they stay bounded by
 * concurrency alone. Exhaustive by type, so a harness added later has to state
 * its answer here rather than inherit "safe to run twice".
 */
export const EXCLUSIVE_HARNESSES: Readonly<Record<OpsHarness, string | null>> = Object.freeze({
  matching: null,
  profile: null,
  premise: null,
  opportunity: null,
  discovery:
    "Every run of this harness resets and uses the same two designated Neon evaluation branches, so two at once "
    + "would reset each other's databases mid-run and both reports would describe a graph reading the other run's data.",
});

/** The harness a record runs, or null for a fixture reset, which names none. */
function harnessOf(record: RunRecord): OpsHarness | null {
  return record.spec.kind === "eval" ? record.spec.harness : null;
}

export interface RunQueueOptions {
  executor: RunExecutor;
  store: RunStore;
  concurrency?: number;
  /**
   * Injectable liveness probe, matching {@link FsRunStoreOptions.isProcessAlive}.
   * Defaults to the store's own, so a record cannot be alive to reconcile and
   * dead to the exclusivity rule.
   */
  isProcessAlive?: (pid: number) => boolean;
}

/** A queued run and the step plan, if any, it must be executed with. */
interface QueueEntry {
  record: RunRecord;
  steps: readonly ExecutionStep[] | undefined;
}

/** FIFO queue that bounds how many harness processes run at once. */
export class RunQueue {
  private readonly executor: RunExecutor;
  private readonly store: RunStore;
  private readonly concurrency: number;
  private readonly pending: QueueEntry[] = [];
  private readonly inFlight = new Set<Promise<void>>();
  /** Records currently inside executor.start(), by id. Drives the exclusivity rule. */
  private readonly executing = new Map<string, RunRecord>();
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(options: RunQueueOptions) {
    this.executor = options.executor;
    this.store = options.store;
    this.concurrency = options.concurrency ?? resolveConcurrency();
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  }

  get depth(): number {
    return this.pending.length + this.inFlight.size;
  }

  /**
   * Queues a run, optionally with the step plan it must be executed with.
   *
   * A plan is how a run that needs its own working directory or an environment
   * that must not be recorded reaches the executor: it is held in memory here
   * and never written anywhere, which is what keeps a credential out of the run
   * record. A run with no plan takes the executor's own single-command path,
   * unchanged.
   */
  enqueue(record: RunRecord, steps?: readonly ExecutionStep[]): void {
    this.pending.push({ record, steps });
    this.pump();
  }

  /**
   * The run holding `harness`'s exclusive slot — in this process **or** in the
   * store — or null.
   *
   * The store half is the whole point. The maps below are memory, and memory does
   * not survive a restart: the deployed service restarts on failure, a
   * discovery run takes double-digit minutes, and a child spawned by the dead
   * server keeps running (nothing kills it, its parent simply goes away). A queue
   * rebuilt on the new process knows about none of that, so a memory-only check
   * would admit a second run that resets `eval-ab-a` and `eval-ab-b` underneath
   * the first. The record on disk is the only thing that outlived the process, so
   * the rule reads it.
   *
   * A stored record holds the slot only while its process is genuinely alive. The
   * other restart — the container is replaced, which kills the child too — leaves
   * a `running` record whose pid is gone, and that must block nothing: a rule that
   * refused on a dead pid would make the harness unlaunchable until someone
   * deleted a file. This is the same liveness question `FsRunStore.reconcile`
   * asks, answered by the same probe, so the two cannot disagree about one record.
   *
   * Always null for a harness that has no slot (see {@link EXCLUSIVE_HARNESSES}),
   * so a caller can ask about any harness. This process's runs are reported ahead
   * of stored ones, because that is the run an operator would cancel.
   */
  async exclusiveConflict(harness: OpsHarness): Promise<RunRecord | null> {
    if (EXCLUSIVE_HARNESSES[harness] === null) return null;
    const mine = this.inProcessConflict(harness);
    if (mine !== null) return mine;
    const { records } = await this.store.list();
    return records.find((record) => this.storedRecordHoldsSlot(record, harness)) ?? null;
  }

  /**
   * The queued or executing run **in this process** holding `harness`'s slot.
   *
   * Synchronous, which is what it is for: {@link exclusiveConflict} reads the
   * store, and the launch route's last check before enqueuing must have no await
   * in it at all — two requests that both passed an awaiting check could still
   * interleave inside it. This half decides that race; the store half decides the
   * one a restart opens.
   *
   * A *queued* run counts: it has not spent anything yet, but it is spoken for,
   * and admitting a second one would only move the collision a few minutes later.
   */
  inProcessConflict(harness: OpsHarness): RunRecord | null {
    if (EXCLUSIVE_HARNESSES[harness] === null) return null;
    for (const record of this.executing.values()) {
      if (harnessOf(record) === harness) return record;
    }
    return this.pending.find((entry) => harnessOf(entry.record) === harness)?.record ?? null;
  }

  /**
   * Whether a stored record is a run of `harness` that is still going.
   *
   * A record with no pid is deliberately not a holder. It is either a run this
   * process is about to enqueue — already reported by {@link inProcessConflict} a
   * moment later, and separated from a racing launch by the route's own re-check
   * — or a `queued` record a dead process left behind, which `reconcile()` marks
   * `interrupted` at the next start. Neither is a live run holding two branches.
   */
  private storedRecordHoldsSlot(record: RunRecord, harness: OpsHarness): boolean {
    if (harnessOf(record) !== harness) return false;
    if (isTerminalStatus(record.status)) return false;
    return record.pid !== null && this.isProcessAlive(record.pid);
  }

  /** Resolves when every queued and in-flight run has settled. */
  async drain(): Promise<void> {
    while (this.depth > 0) {
      await Promise.race([...this.inFlight, Bun.sleep(5)]);
    }
  }

  private pump(): void {
    while (this.inFlight.size < this.concurrency) {
      // FIFO, with one deliberate exception: a run whose exclusive slot is taken
      // is passed over rather than allowed to block the queue behind it. Without
      // that, a queued discovery run would stall every scorecard run for as
      // long as the run ahead of it takes, and those share nothing with it.
      //
      // This cannot stall: a run is blocked only while another run is executing,
      // and that run's completion pumps again.
      const index = this.pending.findIndex((entry) => !this.isBlocked(entry.record));
      if (index === -1) break;
      const [entry] = this.pending.splice(index, 1);
      this.executing.set(entry.record.id, entry.record);
      const task = this.run(entry).finally(() => {
        this.executing.delete(entry.record.id);
        this.inFlight.delete(task);
        this.pump();
      });
      this.inFlight.add(task);
    }
  }

  /**
   * True when another run **in this process** already holds this record's slot.
   *
   * Synchronous because `pump()` is, and sufficient because it is not the only
   * guard: a run reaches `enqueue` only through the launch route, which has
   * already asked {@link exclusiveConflict} — the half that reads the store and so
   * sees a run this process never started.
   */
  private isBlocked(record: RunRecord): boolean {
    const harness = harnessOf(record);
    if (harness === null || EXCLUSIVE_HARNESSES[harness] === null) return false;
    for (const running of this.executing.values()) {
      if (harnessOf(running) === harness) return true;
    }
    return false;
  }

  private async run(entry: QueueEntry): Promise<void> {
    try {
      await this.executor.start(entry.record, entry.steps);
    } catch (error) {
      // A failed spawn must not stall the queue or leave the record claiming to run.
      await this.store.update(entry.record.id, {
        status: "crashed",
        endedAt: new Date().toISOString(),
      });
      console.error(`[eval-ops] run ${entry.record.id} failed to execute:`, error);
    }
  }
}
