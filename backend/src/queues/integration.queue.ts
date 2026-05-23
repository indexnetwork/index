import { Job } from 'bullmq';
import { log } from '../lib/log';
import { QueueFactory } from '../lib/bullmq/bullmq';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { ComposioIntegrationAdapter } from '../adapters/integration.adapter';
import type { ToolActionResponse } from '../adapters/integration.adapter';

/** BullMQ queue name for periodic integration sync jobs. */
export const QUEUE_NAME = 'integration-sync-queue';

/** Payload for the repeatable sync tick. */
export interface IntegrationSyncPayload {
  trigger: 'tick';
}

/** Minimal interface for the integration adapter used by the sync worker. */
interface SyncIntegrationAdapter {
  executeToolAction(slug: string, userId: string, args: Record<string, unknown>): Promise<ToolActionResponse>;
}

/** Minimal interface for the database adapter used by the sync worker. */
interface SyncDatabaseAdapter {
  getActiveIntegrationSyncs(): Promise<Array<{
    networkId: string;
    toolkit: string;
    connectedAccountId: string;
    syncConfig: Record<string, unknown>;
    ownerUserId: string;
  }>>;
  updateIntegrationSyncConfig(networkId: string, toolkit: string, syncConfig: Record<string, unknown>): Promise<void>;
  getNetworkMetadata(networkId: string): Promise<Record<string, unknown> | null>;
  updateNetworkMetadata(networkId: string, metadata: Record<string, unknown>): Promise<void>;
}

/** Optional dependencies for testing. */
export interface IntegrationSyncQueueDeps {
  dbAdapter?: SyncDatabaseAdapter;
  integrationAdapter?: SyncIntegrationAdapter;
}

/**
 * Integration sync queue: BullMQ repeatable job that ticks every 5 minutes,
 * finds active integrations past their per-row interval, pulls events via
 * Composio, and upserts into the network's metadata JSONB.
 *
 * @remarks
 * Workers are started only by the protocol server via {@link IntegrationSyncQueue.startWorker}.
 * Handlers orchestrate by calling adapters — no business logic here.
 */
export class IntegrationSyncQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<IntegrationSyncPayload>(QUEUE_NAME);

  private readonly logger = log.job.from('IntegrationSyncJob');
  private readonly queueLogger = log.queue.from('IntegrationSyncQueue');
  private readonly deps: IntegrationSyncQueueDeps | undefined;
  private worker: ReturnType<typeof QueueFactory.createWorker<IntegrationSyncPayload>> | null = null;

  constructor(deps?: IntegrationSyncQueueDeps) {
    this.deps = deps;
  }

  /**
   * Start the BullMQ worker and register the repeatable tick job.
   * Idempotent; call from the protocol server only.
   */
  startWorker(): void {
    if (this.worker) return;

    this.queue.add('tick', { trigger: 'tick' }, {
      repeat: { every: 5 * 60 * 1000 },
      jobId: 'integration-sync-tick',
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    }).catch((err) => {
      this.queueLogger.error('Failed to register repeatable sync tick', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    const processor = async (job: Job<IntegrationSyncPayload>) => {
      this.queueLogger.info(`[IntegrationSyncProcessor] Processing job ${job.id} (${job.name})`);
      await this.processJob(job.name, job.data);
    };

    this.worker = QueueFactory.createWorker<IntegrationSyncPayload>(QUEUE_NAME, processor);
    this.queueLogger.verbose('Integration sync worker started');
  }

  /**
   * Run the job handler. Used by the worker and by tests with injected deps.
   */
  async processJob(name: string, _data: IntegrationSyncPayload): Promise<void> {
    switch (name) {
      case 'tick':
        await this.handleTick();
        break;
      default:
        this.queueLogger.warn(`[IntegrationSyncProcessor] Unknown job name: ${name}`);
    }
  }

  /**
   * Gracefully close the worker and queue connections.
   */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  private getDbAdapter(): SyncDatabaseAdapter {
    return this.deps?.dbAdapter ?? new ChatDatabaseAdapter();
  }

  private getIntegrationAdapter(): SyncIntegrationAdapter {
    return this.deps?.integrationAdapter ?? new ComposioIntegrationAdapter();
  }

  private async handleTick(): Promise<void> {
    const dbAdapter = this.getDbAdapter();
    const activeSyncs = await dbAdapter.getActiveIntegrationSyncs();
    const now = Date.now();

    for (const sync of activeSyncs) {
      const config = sync.syncConfig as {
        intervalMs?: number;
        lastSyncAt?: string;
        calendarId?: string;
        status?: string;
      };
      const interval = config.intervalMs ?? 900_000;
      const parsed = config.lastSyncAt ? new Date(config.lastSyncAt).getTime() : 0;
      const lastSync = Number.isNaN(parsed) ? 0 : parsed;

      if (now - lastSync < interval) continue;

      try {
        if (sync.toolkit === 'google_calendar') {
          await this.syncGoogleCalendar(
            sync.networkId,
            sync.ownerUserId,
            config.calendarId ?? 'primary',
            config,
            dbAdapter,
          );
        }
      } catch (err) {
        this.logger.error('Sync failed', {
          networkId: sync.networkId,
          toolkit: sync.toolkit,
          error: err instanceof Error ? err.message : String(err),
        });
        await dbAdapter.updateIntegrationSyncConfig(
          sync.networkId,
          sync.toolkit,
          { ...config, status: 'error' },
        );
      }
    }
  }

  private async syncGoogleCalendar(
    networkId: string,
    ownerUserId: string,
    calendarId: string,
    existingSyncConfig: Record<string, unknown>,
    dbAdapter: SyncDatabaseAdapter,
  ): Promise<void> {
    this.logger.verbose('Syncing Google Calendar', { networkId, calendarId });

    const rawMeta = await dbAdapter.getNetworkMetadata(networkId);
    if (rawMeta === null) return; // network doesn't exist

    const meta = rawMeta as { startDate?: string; endDate?: string; events?: unknown[] };
    const timeMin = meta?.startDate ?? new Date().toISOString();
    const timeMax = meta?.endDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const integrationAdapter = this.getIntegrationAdapter();
    const allEvents: Array<Record<string, unknown>> = [];
    let pageToken: string | undefined;

    do {
      const result = await integrationAdapter.executeToolAction(
        'GOOGLESUPER_GOOGLE_CALENDAR_LIST_EVENTS',
        ownerUserId,
        {
          time_min: timeMin,
          time_max: timeMax,
          calendar_id: calendarId,
          single_events: true,
          max_results: 250,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      );

      if (!result.successful) {
        throw new Error(`Google Calendar API error: ${result.error}`);
      }

      const data = typeof result.data === 'string' ? JSON.parse(result.data as string) : result.data;
      const items = (data?.response_data?.items ?? data?.items ?? []) as Array<Record<string, unknown>>;
      allEvents.push(...items);
      pageToken = (data?.response_data?.nextPageToken ?? data?.nextPageToken) as string | undefined;
    } while (pageToken);

    const mappedEvents = allEvents.map((item) => ({
      externalId: String(item.id ?? ''),
      title: String(item.summary ?? 'Untitled'),
      startTime: String((item.start as Record<string, unknown>)?.dateTime ?? (item.start as Record<string, unknown>)?.date ?? ''),
      endTime: String((item.end as Record<string, unknown>)?.dateTime ?? (item.end as Record<string, unknown>)?.date ?? ''),
      location: item.location ? String(item.location) : undefined,
      description: item.description ? String(item.description).slice(0, 500) : undefined,
      tags: [] as string[],
      syncedAt: new Date().toISOString(),
    }));

    const updatedMetadata = {
      ...(meta ?? {}),
      events: mappedEvents,
    };

    await dbAdapter.updateNetworkMetadata(networkId, updatedMetadata);

    await dbAdapter.updateIntegrationSyncConfig(
      networkId,
      'google_calendar',
      {
        ...existingSyncConfig,
        lastSyncAt: new Date().toISOString(),
        calendarId,
      },
    );

    this.logger.verbose('Google Calendar sync complete', {
      networkId,
      eventCount: mappedEvents.length,
    });
  }
}

/** Singleton integration sync queue instance. */
export const integrationSyncQueue = new IntegrationSyncQueue();
