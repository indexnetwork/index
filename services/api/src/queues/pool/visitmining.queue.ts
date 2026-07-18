/**
 * Visit-triggered pool mining (IND-439 visibility-audit slice).
 *
 * The 2026-07-18 audit found the question funnel empties permanently once all
 * pending questions expire past the 7-day TTL, because mining only fires on
 * discovery-run completion. This queue adds a *when*, never a *whether*: when
 * an intent owner's intent-page pending-questions fetch finds no live pending
 * pool_discovery question, a debounced mining pass is enqueued for that
 * intent. The worker re-mines the existing pool via the exact shared hook
 * every discovery completion already uses, so ALL existing gates apply
 * unchanged (POOL_QUESTIONS_MODE, QUESTIONER_ENABLED, k-anonymity pool floor,
 * VoI threshold, per-intent pending budgets, fingerprint/Jaccard freshness,
 * push budgets). Expired rows are never resurrected — if the pool still
 * supports a question, a fresh one is minted.
 *
 * Flag: POOL_QUESTIONS_VISIT_TRIGGER=off|on (default off — fully inert).
 * Debounce: BullMQ deduplication, one visit-triggered run per caller+intent
 * per POOL_VISIT_MINING_DEBOUNCE_MS (6h). No new tables.
 */
import type { Job } from 'bullmq';

import { POOL_VISIT_MINING_DEBOUNCE_MS, poolQuestionsMode, poolQuestionsVisitTrigger } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { minePoolDiscriminatorsOnCompletion, type PoolMiningTrigger } from './mining.shared';

export const POOL_VISIT_MINING_QUEUE_NAME = 'pool-visit-mining-queue';
const VISIT_MINING_JOB_NAME = 'mine_pool_on_visit';

const logger = log.queue.from('PoolVisitMiningQueue');

/** Minimal payload; all authoritative state is re-read by the worker. */
export interface PoolVisitMiningJobData {
  userId: string;
  intentId: string;
}

/**
 * Deterministic per-caller+intent deduplication id. Scoping by caller keeps a
 * non-owner's fetch from consuming the owner's 6h debounce slot; ownership is
 * still enforced authoritatively in the worker. BullMQ custom ids must not
 * contain colons.
 */
export function poolVisitMiningDeduplicationId(userId: string, intentId: string): string {
  return `pool-visit-mine-${userId}-${intentId}`;
}

type VisitMiningIntentReader = Pick<typeof chatDatabaseAdapter, 'getIntent'>;

export interface PoolVisitMiningQueueDeps {
  /** Injectable mining hook (defaults to the shared completion path). */
  mine?: (trigger: PoolMiningTrigger) => Promise<void>;
  /** Injectable intent reader for the worker's ownership/lifecycle check. */
  database?: VisitMiningIntentReader;
}

/** Debounced worker that re-mines an intent's pool on owner page visits. */
export class PoolVisitMiningQueue {
  static readonly QUEUE_NAME = POOL_VISIT_MINING_QUEUE_NAME;

  private readonly mine: (trigger: PoolMiningTrigger) => Promise<void>;
  private readonly database: VisitMiningIntentReader;
  private queueInstance: ReturnType<typeof QueueFactory.createQueue<PoolVisitMiningJobData>> | null = null;
  private worker: ReturnType<typeof QueueFactory.createWorker<PoolVisitMiningJobData>> | null = null;

  constructor(deps?: PoolVisitMiningQueueDeps) {
    this.mine = deps?.mine ?? minePoolDiscriminatorsOnCompletion;
    this.database = deps?.database ?? chatDatabaseAdapter;
  }

  /** Lazily created so importing this module never opens a Redis connection. */
  private get queue(): ReturnType<typeof QueueFactory.createQueue<PoolVisitMiningJobData>> {
    this.queueInstance ??= QueueFactory.createQueue<PoolVisitMiningJobData>(POOL_VISIT_MINING_QUEUE_NAME);
    return this.queueInstance;
  }

  /**
   * Enqueue one debounced visit-mining pass. BullMQ deduplication drops any
   * further add with the same id until the 6h ttl elapses, so at most one
   * visit-triggered mining run exists per caller+intent per window.
   */
  addVisitJob(data: PoolVisitMiningJobData): Promise<Job<PoolVisitMiningJobData>> {
    return this.queue.add(VISIT_MINING_JOB_NAME, data, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
      deduplication: {
        id: poolVisitMiningDeduplicationId(data.userId, data.intentId),
        ttl: POOL_VISIT_MINING_DEBOUNCE_MS,
      },
    });
  }

  /**
   * Process one visit-mining job; exposed for focused hermetic tests.
   *
   * Re-checks the flags (they may have flipped since enqueue) and enforces
   * ownership + lifecycle admission mirroring discovery: only the owner's
   * active, non-archived intents mine, matching the paths that already call
   * the shared hook today.
   */
  async processJob(data: PoolVisitMiningJobData): Promise<void> {
    if (poolQuestionsVisitTrigger() !== 'on' || poolQuestionsMode() !== 'on') {
      logger.debug('Visit mining skipped: flags off at processing time', {
        intentId: data.intentId,
      });
      return;
    }
    const intent = await this.database.getIntent(data.intentId);
    if (!intent || intent.userId !== data.userId) {
      logger.debug('Visit mining skipped: intent missing or caller is not the owner', {
        intentId: data.intentId,
      });
      return;
    }
    if (intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) {
      logger.debug('Visit mining skipped: intent not active', {
        intentId: data.intentId,
        status: intent.status ?? 'ACTIVE',
        archived: Boolean(intent.archivedAt),
      });
      return;
    }
    await this.mine({
      source: 'intent_visit',
      userId: data.userId,
      intentId: data.intentId,
    });
  }

  /** Start the worker once. Called by the composition root. */
  startWorker(): void {
    if (this.worker) return;
    this.worker = QueueFactory.createWorker<PoolVisitMiningJobData>(
      POOL_VISIT_MINING_QUEUE_NAME,
      async (job) => {
        try {
          await this.processJob(job.data);
        } catch (error) {
          logger.warn('Visit mining job failed', {
            jobId: job.id,
            intentId: job.data.intentId,
            error,
          });
          throw error;
        }
      },
    );
  }

  /** Close queue and worker connections. */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queueInstance) {
      await this.queueInstance.close();
      this.queueInstance = null;
    }
  }
}

/** Runtime singleton wired by the composition root. */
export const poolVisitMiningQueue = new PoolVisitMiningQueue();

/** Enqueue dependency surface (injectable for hermetic controller tests). */
export interface VisitPoolMiningEnqueueDeps {
  addVisitJob: (data: PoolVisitMiningJobData) => Promise<unknown>;
}

/**
 * Fire-and-forget gate called from the intent-scoped pending-questions read
 * path. Inert unless BOTH POOL_QUESTIONS_VISIT_TRIGGER=on and
 * POOL_QUESTIONS_MODE=on (the visit trigger exists to mint questions, never
 * to widen shadow mining), and only when the caller currently sees no live
 * pending pool_discovery question for the intent. Never throws — a Redis
 * hiccup must not fail the questions fetch.
 */
export function maybeEnqueueVisitPoolMining(
  input: { userId: string; intentId: string; hasLivePoolQuestion: boolean },
  deps: VisitPoolMiningEnqueueDeps = { addVisitJob: (data) => poolVisitMiningQueue.addVisitJob(data) },
): void {
  if (poolQuestionsVisitTrigger() !== 'on') return;
  if (poolQuestionsMode() !== 'on') return;
  if (input.hasLivePoolQuestion) return;
  void Promise.resolve()
    .then(() => deps.addVisitJob({ userId: input.userId, intentId: input.intentId }))
    .catch((error) => {
      logger.warn('Visit mining enqueue failed', {
        intentId: input.intentId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
