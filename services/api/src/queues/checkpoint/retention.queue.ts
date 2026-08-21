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

/** Retention window for PostgresSaver checkpoint threads, in whole days. */
const RETENTION_DAYS = 7;
/** Threads deleted per batch. */
export const BATCH_SIZE = 100;
/** Cap batches per run so a huge backlog drains over a few runs instead of one long transaction storm. */
const MAX_BATCHES_PER_RUN = 10;
/** Hourly, offset from the top of the hour to avoid stacking with other crons. */
const CRON_EXPRESSION = '43 * * * *';

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
   */
  async prune(): Promise<CheckpointRetentionRunResult> {
    const totals: CheckpointRetentionRunResult = {
      threads: 0,
      checkpoints: 0,
      blobs: 0,
      writes: 0,
      batches: 0,
    };
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const batch = await this.deps.pruneStaleCheckpointThreads({ retentionDays: RETENTION_DAYS, batchSize: BATCH_SIZE });
      totals.batches += 1;
      totals.threads += batch.threads;
      totals.checkpoints += batch.checkpoints;
      totals.blobs += batch.blobs;
      totals.writes += batch.writes;
      if (batch.threads < BATCH_SIZE) break;
    }
    return totals;
  }

  start(): void {
    if (this.task) return;
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
    this.logger.info('Checkpoint retention cron scheduled (hourly)', { retentionDays: RETENTION_DAYS });
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }
}

export const checkpointRetentionCron = new CheckpointRetentionCron();
