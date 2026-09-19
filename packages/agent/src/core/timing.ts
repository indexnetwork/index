/** Metadata is limited to operation names, IDs, counts and outcomes, never model content. */
export type TimingMetadata = Record<string, string | number | boolean | undefined>;
export type TimingOutcome = 'completed' | 'error' | 'cancelled' | 'interrupted' | 'superseded' | 'rejected';

/** A start or terminal observation of one operation within an activation. */
export interface TimingEvent {
  type: 'agent.timing';
  wakeId: string;
  operation: string;
  operationId: string;
  parentOperationId?: string;
  phase: 'started' | 'finished';
  durationMs?: number;
  outcome?: TimingOutcome;
  metadata: TimingMetadata;
}

/** Request-local monotonic timings; observer failures cannot change agent execution. */
export class WakeTiming {
  private readonly startedAt = performance.now();
  private readonly operationId = crypto.randomUUID();
  private finished = false;

  constructor(
    readonly wakeId: string,
    private readonly observe: ((event: TimingEvent) => void) | undefined,
    private readonly operation: string,
    private readonly parentOperationId?: string,
    private readonly metadata: TimingMetadata = {},
  ) {
    this.emit({ phase: 'started' });
  }

  /** @param operation - Stable stage name. @param metadata - Non-content details. @returns A nested timing. */
  start(operation: string, metadata: TimingMetadata = {}): WakeTiming {
    return new WakeTiming(this.wakeId, this.observe, operation, this.operationId, metadata);
  }

  /** @param outcome - Terminal state. @param metadata - Final counts or outcome details. @returns Nothing. */
  finish(outcome: TimingOutcome = 'completed', metadata: TimingMetadata = {}): void {
    if (this.finished) return;
    this.finished = true;
    this.emit({ phase: 'finished', durationMs: Math.round((performance.now() - this.startedAt) * 100) / 100, outcome, metadata: { ...this.metadata, ...metadata } });
  }

  /** @param operation - Stable stage name. @param run - Original operation, unchanged. @param signal - Cancellation state. @param metadata - Non-content details. @returns The original result. @throws The original operation error. */
  async measure<T>(operation: string, run: (timing: WakeTiming) => Promise<T>, signal?: AbortSignal, metadata: TimingMetadata = {}): Promise<T> {
    const timing = this.start(operation, metadata);
    try {
      const result = await run(timing);
      timing.finish(signal?.aborted ? 'cancelled' : 'completed');
      return result;
    } catch (error) {
      timing.finish(signal?.aborted ? 'cancelled' : 'error');
      throw error;
    }
  }

  private emit(fields: Partial<TimingEvent>): void {
    try {
      this.observe?.({ type: 'agent.timing', wakeId: this.wakeId, operation: this.operation, operationId: this.operationId,
        parentOperationId: this.parentOperationId, phase: 'started', metadata: this.metadata, ...fields });
    } catch { /* Instrumentation must not affect the work being observed. */ }
  }
}
