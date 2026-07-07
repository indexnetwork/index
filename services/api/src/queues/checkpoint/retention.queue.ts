// services/api/src/queues/checkpoint/retention.queue.ts
//
// Hourly retention sweep for LangGraph PostgresSaver checkpoint tables.
//
// Every chat run checkpoints under a fresh composite thread_id
// (`sessionId:runId`), and conversation continuity is rebuilt from
// `chat_messages` — so once a run finishes, its checkpoints are unreachable
// write-only data. Without this sweep the checkpoint tables grow without
// bound (they reached ~40% of the prod database before this cron existed).
import cron from 'node-cron';
import { log } from '../../lib/log';
import { pruneStaleCheckpointThreads, type CheckpointPruneResult } from '../../adapters/checkpointer.adapter';

/** The persistence surface the cron needs: one stale-thread delete batch. */
export interface CheckpointRetentionDeps {
  pruneStaleCheckpointThreads: (opts: {
    retentionDays: number;
    batchSize: number;
  }) => Promise<CheckpointPruneResult>;
}

/** Aggregate of one cron run (possibly multiple delete batches). */
export interface CheckpointRetentionRunResult extends CheckpointPruneResult {
  /** Number of delete batches executed in this run. */
  batches: number;
}

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1000;
/** Cap batches per run so a huge backlog drains over a few runs instead of one long transaction storm. */
const MAX_BATCHES_PER_RUN = 10;
/** Hourly, offset from the top of the hour to avoid stacking with other crons. */
const CRON_EXPRESSION = '43 * * * *';

const DISABLED_VALUES = new Set(['0', 'off', 'none', 'never', 'disabled', 'false']);

/**
 * Resolve the retention window from CHECKPOINT_RETENTION_DAYS.
 *
 * @returns Whole days (>= 1), or null when retention is disabled
 *   (`0`, `off`, `none`, `never`, `disabled`, `false`, or a non-positive number).
 *   Unset or unparseable values fall back to the 7-day default.
 */
export function resolveRetentionDays(
  raw: string | undefined = process.env.CHECKPOINT_RETENTION_DAYS,
): number | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return DEFAULT_RETENTION_DAYS;
  if (DISABLED_VALUES.has(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return DEFAULT_RETENTION_DAYS;
  if (parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

/**
 * Resolve the per-batch thread limit from CHECKPOINT_PRUNE_BATCH_SIZE.
 * Unset or invalid values fall back to 100; the value is clamped to [1, 1000].
 */
export function resolveBatchSize(
  raw: string | undefined = process.env.CHECKPOINT_PRUNE_BATCH_SIZE,
): number {
  const parsed = Number(raw?.trim());
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_BATCH_SIZE;
  return Math.min(MAX_BATCH_SIZE, Math.floor(parsed));
}

export class CheckpointRetentionCron {
  private readonly logger = log.queue.from('CheckpointRetention');
  private task: ReturnType<typeof cron.schedule> | null = null;
  private readonly deps: CheckpointRetentionDeps;

  constructor(deps?: CheckpointRetentionDeps) {
    this.deps = deps ?? { pruneStaleCheckpointThreads };
  }

  /**
   * Run one retention sweep: delete stale checkpoint threads in batches until
   * a batch comes back short (backlog drained) or MAX_BATCHES_PER_RUN is hit.
   * No-op (all zeros) when retention is disabled via env.
   */
  async prune(): Promise<CheckpointRetentionRunResult> {
    const totals: CheckpointRetentionRunResult = {
      threads: 0,
      checkpoints: 0,
      blobs: 0,
      writes: 0,
      batches: 0,
    };
    const retentionDays = resolveRetentionDays();
    if (retentionDays === null) return totals;
    const batchSize = resolveBatchSize();

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const batch = await this.deps.pruneStaleCheckpointThreads({ retentionDays, batchSize });
      totals.batches += 1;
      totals.threads += batch.threads;
      totals.checkpoints += batch.checkpoints;
      totals.blobs += batch.blobs;
      totals.writes += batch.writes;
      if (batch.threads < batchSize) break;
    }
    return totals;
  }

  start(): void {
    if (this.task) return;
    const retentionDays = resolveRetentionDays();
    if (retentionDays === null) {
      this.logger.info('Checkpoint retention disabled (CHECKPOINT_RETENTION_DAYS)');
      return;
    }
    this.task = cron.schedule(CRON_EXPRESSION, () => {
      this.prune()
        .then((totals) => {
          if (totals.threads > 0) {
            this.logger.info(
              `Pruned ${totals.threads} checkpoint thread${totals.threads === 1 ? '' : 's'}`,
              { ...totals },
            );
          }
        })
        .catch((err) => this.logger.error('Checkpoint retention cron failed', { error: err }));
    });
    this.logger.info('Checkpoint retention cron scheduled (hourly)', { retentionDays });
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

export const checkpointRetentionCron = new CheckpointRetentionCron();
