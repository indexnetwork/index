import cron from 'node-cron';
import { log } from '../log';
import { ChatDatabaseAdapter } from '../../adapters/database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { HydeGraphDatabase } from '@indexnetwork/protocol';

/** Age in ms after which HyDE documents are considered stale (30 days). Used for weekly refresh. */
const STALE_HYDE_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Minimal database interface for HyDE maintenance (used when deps provided in tests). */
export type HydeMaintenanceDatabase = Pick<
  ChatDatabaseAdapter,
  | 'deleteExpiredHydeDocuments'
  | 'getStaleHydeDocuments'
  | 'getIntentForIndexing'
  | 'deleteHydeDocumentsForSource'
>;

/**
 * Optional dependencies for testing. Use abstractions (`Pick<Adapter, ...>` or protocol interfaces)
 * to stub the database.
 */
export interface HydeMaintenanceDeps {
  database?: HydeMaintenanceDatabase;
  invokeHyde?: (input: {
    sourceText: string;
    sourceType: 'intent';
    sourceId: string;
    forceRegenerate: true;
  }) => Promise<unknown>;
}

/**
 * HyDE maintenance: cron-scheduled cleanup and refresh.
 *
 * Provides expired-document cleanup and stale-document refresh. Call {@link HydeMaintenance.startCrons}
 * from the protocol server to schedule daily cleanup (03:00) and weekly refresh (Sunday 04:00).
 *
 * @remarks
 * Handlers orchestrate by calling adapters and the HyDE graph—no business logic here.
 */
export class HydeMaintenance {
  private readonly logger = log.job.from('HydeJob');
  private readonly cleanupLogger = log.job.from('HydeJob:Cleanup');
  private readonly refreshLogger = log.job.from('HydeJob:Refresh');
  private readonly database: HydeMaintenanceDatabase | ChatDatabaseAdapter;
  private readonly invokeHydeOverride?: HydeMaintenanceDeps['invokeHyde'];

  /**
   * @param deps - Optional overrides for database (for tests).
   */
  constructor(deps?: HydeMaintenanceDeps) {
    this.database = deps?.database ?? new ChatDatabaseAdapter();
    this.invokeHydeOverride = deps?.invokeHyde;
    // When deps is omitted, default adapter implements the same interface.
  }

  /**
   * Delete all expired HyDE documents from the database.
   * @returns Number of documents deleted
   */
  async cleanupExpiredHyde(): Promise<number> {
    const db = this.database;
    this.cleanupLogger.verbose('Starting expired HyDE cleanup');
    const deletedCount = await db.deleteExpiredHydeDocuments();
    this.cleanupLogger.info('Deleted expired HyDE documents', { deletedCount });
    return deletedCount;
  }

  /**
   * Refresh HyDE documents older than the stale threshold (30 days). Re-invokes the HyDE graph per document.
   * @returns Number of documents refreshed
   */
  async refreshStaleHyde(): Promise<number> {
    const db = this.database;
    this.refreshLogger.verbose('Starting stale HyDE refresh');
    const staleThreshold = new Date(Date.now() - STALE_HYDE_DAYS_MS);
    const staleDocuments = await db.getStaleHydeDocuments(staleThreshold);
    this.refreshLogger.verbose('Found stale HyDE documents', { count: staleDocuments.length });

    let hydeGraph: ReturnType<HydeGraphFactory['createGraph']> | null = null;
    const invokeHyde = async (input: {
      sourceText: string;
      sourceType: 'intent';
      sourceId: string;
      forceRegenerate: true;
    }): Promise<void> => {
      if (this.invokeHydeOverride) {
        await this.invokeHydeOverride(input);
        return;
      }
      if (!hydeGraph) {
        const embedder = new EmbedderAdapter();
        const cache = new RedisCacheAdapter();
        const inferrer = new LensInferrer();
        const generator = new HydeGenerator();
        const graphDb = this.database as unknown as HydeGraphDatabase;
        hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, inferrer, generator).createGraph();
      }
      await hydeGraph.invoke(input);
    };

    let refreshedCount = 0;
    for (const doc of staleDocuments) {
      if (!doc.sourceId) continue;
      if (doc.sourceType !== 'intent') continue;

      const intent = await db.getIntentForIndexing(doc.sourceId);
      if (!intent) {
        await db.deleteHydeDocumentsForSource(doc.sourceType, doc.sourceId);
        continue;
      }
      if (
        !intent.userId
        || intent.archivedAt
        || intent.status === 'PAUSED'
        || intent.status === 'FULFILLED'
        || intent.status === 'EXPIRED'
      ) {
        this.refreshLogger.verbose('Skipping stale HyDE refresh for inactive intent', {
          sourceId: doc.sourceId,
          status: intent.status,
          archived: Boolean(intent.archivedAt),
          hasOwner: Boolean(intent.userId),
        });
        continue;
      }

      try {
        await invokeHyde({
          sourceText: intent.payload,
          sourceType: 'intent',
          sourceId: doc.sourceId,
          forceRegenerate: true,
        });
        refreshedCount++;
      } catch (error) {
        this.refreshLogger.error('Failed to refresh HyDE', {
          sourceId: doc.sourceId,
          strategy: doc.strategy,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.refreshLogger.info('Refreshed HyDE documents', { refreshedCount });
    return refreshedCount;
  }

  /**
   * Schedule daily cleanup (03:00) and weekly refresh (Sunday 04:00). Call from protocol server only.
   */
  startCrons(): void {
    cron.schedule('0 3 * * *', () => {
      this.cleanupExpiredHyde().catch((err) =>
        this.cleanupLogger.error('Cron failed', { error: err })
      );
    });
    this.logger.info('📅 Cleanup scheduled (daily at 03:00)');

    cron.schedule('0 4 * * 0', () => {
      this.refreshStaleHyde().catch((err) =>
        this.refreshLogger.error('Cron failed', { error: err })
      );
    });
    this.logger.info('📅 Refresh scheduled (weekly Sunday at 04:00)');
  }
}

/** Singleton HyDE maintenance instance. Use for cleanup/refresh and starting crons. */
export const hydeMaintenance = new HydeMaintenance();
