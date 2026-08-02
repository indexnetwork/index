import type { RunExecutor } from "./ops.executor.js";
import type { RunStore } from "./ops.store.js";
import type { RunRecord } from "./ops.types.js";

/**
 * Concurrency defaults to 1: evals cost real tokens and share provider rate
 * limits, so concurrent runs make both logs and spend unattributable.
 */
export function resolveConcurrency(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.EVAL_OPS_MAX_CONCURRENT_RUNS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export interface RunQueueOptions {
  executor: RunExecutor;
  store: RunStore;
  concurrency?: number;
}

/** FIFO queue that bounds how many harness processes run at once. */
export class RunQueue {
  private readonly executor: RunExecutor;
  private readonly store: RunStore;
  private readonly concurrency: number;
  private readonly pending: RunRecord[] = [];
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: RunQueueOptions) {
    this.executor = options.executor;
    this.store = options.store;
    this.concurrency = options.concurrency ?? resolveConcurrency();
  }

  get depth(): number {
    return this.pending.length + this.inFlight.size;
  }

  enqueue(record: RunRecord): void {
    this.pending.push(record);
    this.pump();
  }

  /** Resolves when every queued and in-flight run has settled. */
  async drain(): Promise<void> {
    while (this.depth > 0) {
      await Promise.race([...this.inFlight, Bun.sleep(5)]);
    }
  }

  private pump(): void {
    while (this.inFlight.size < this.concurrency && this.pending.length > 0) {
      const record = this.pending.shift() as RunRecord;
      const task = this.run(record).finally(() => {
        this.inFlight.delete(task);
        this.pump();
      });
      this.inFlight.add(task);
    }
  }

  private async run(record: RunRecord): Promise<void> {
    try {
      await this.executor.start(record);
    } catch (error) {
      // A failed spawn must not stall the queue or leave the record claiming to run.
      await this.store.update(record.id, {
        status: "crashed",
        endedAt: new Date().toISOString(),
      });
      console.error(`[eval-ops] run ${record.id} failed to execute:`, error);
    }
  }
}
