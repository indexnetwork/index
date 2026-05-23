/**
 * Unit tests for IntegrationSyncQueue. Uses injected deps to avoid Redis/Composio/DB.
 */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, expect, it, afterAll } from 'bun:test';
import { mock } from 'bun:test';

const mockAdd = mock(async (name: string, data: unknown) => ({ id: 'job-1', name, data }));
const mockCreateWorker = mock(() => ({}));

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({ add: mockAdd, close: async () => {} }),
    createWorker: mockCreateWorker,
  },
}));

afterAll(() => {
  mock.restore();
});

import {
  IntegrationSyncQueue,
  QUEUE_NAME,
} from '../integration.queue';
import type { IntegrationSyncQueueDeps } from '../integration.queue';

/** Helper to build a mock DB adapter with sensible defaults. */
function makeDbAdapter(overrides: Partial<IntegrationSyncQueueDeps['dbAdapter'] & object> = {}) {
  return {
    getActiveIntegrationSyncs: mock(async () => []),
    updateIntegrationSyncConfig: mock(async () => {}),
    getNetworkMetadata: mock(async () => ({})),
    updateNetworkMetadata: mock(async () => {}),
    ...overrides,
  };
}

/** Helper to build a mock integration adapter. */
function makeIntegrationAdapter(overrides: Partial<IntegrationSyncQueueDeps['integrationAdapter'] & object> = {}) {
  return {
    executeToolAction: mock(async () => ({
      successful: true,
      data: { items: [] },
      error: undefined,
    })),
    ...overrides,
  };
}

describe('IntegrationSyncQueue', () => {
  it('exports the correct queue name', () => {
    expect(QUEUE_NAME).toBe('integration-sync-queue');
  });

  describe('handleTick — interval gating', () => {
    it('skips syncs that are within their interval window', async () => {
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: {
            status: 'active',
            intervalMs: 900_000,
            lastSyncAt: new Date().toISOString(), // just synced
            calendarId: 'primary',
          },
          ownerUserId: 'user-1',
        }]),
      });
      const integrationAdapter = makeIntegrationAdapter();
      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });

      await queue.processJob('tick', { trigger: 'tick' });

      // Should NOT have called executeToolAction because interval hasn't elapsed
      expect(integrationAdapter.executeToolAction).not.toHaveBeenCalled();
    });

    it('syncs when lastSyncAt is past the interval', async () => {
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: {
            status: 'active',
            intervalMs: 900_000,
            lastSyncAt: new Date(Date.now() - 1_000_000).toISOString(), // well past interval
            calendarId: 'primary',
          },
          ownerUserId: 'user-1',
        }]),
        getNetworkMetadata: mock(async () => ({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z' })),
      });
      const integrationAdapter = makeIntegrationAdapter();
      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });

      await queue.processJob('tick', { trigger: 'tick' });

      expect(integrationAdapter.executeToolAction).toHaveBeenCalled();
      expect(dbAdapter.updateNetworkMetadata).toHaveBeenCalled();
      expect(dbAdapter.updateIntegrationSyncConfig).toHaveBeenCalled();
    });
  });

  describe('handleTick — NaN lastSyncAt', () => {
    it('treats invalid lastSyncAt as never-synced and proceeds', async () => {
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: {
            status: 'active',
            intervalMs: 900_000,
            lastSyncAt: 'not-a-date',
            calendarId: 'primary',
          },
          ownerUserId: 'user-1',
        }]),
        getNetworkMetadata: mock(async () => ({})),
      });
      const integrationAdapter = makeIntegrationAdapter();
      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });

      await queue.processJob('tick', { trigger: 'tick' });

      // Should proceed with sync since invalid date means never-synced
      expect(integrationAdapter.executeToolAction).toHaveBeenCalled();
    });
  });

  describe('syncGoogleCalendar — event mapping', () => {
    it('maps Google Calendar events to the expected shape', async () => {
      const calendarEvents = [
        {
          id: 'evt-1',
          summary: 'Team Standup',
          start: { dateTime: '2026-01-15T09:00:00Z' },
          end: { dateTime: '2026-01-15T09:30:00Z' },
          location: 'Room A',
          description: 'Daily standup meeting',
        },
        {
          id: 'evt-2',
          summary: 'All-day Workshop',
          start: { date: '2026-01-20' },
          end: { date: '2026-01-21' },
        },
      ];

      let capturedMetadata: Record<string, unknown> | null = null;
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: { status: 'active', lastSyncAt: '2025-01-01T00:00:00Z', calendarId: 'primary' },
          ownerUserId: 'user-1',
        }]),
        getNetworkMetadata: mock(async () => ({ startDate: '2026-01-01T00:00:00Z', endDate: '2026-02-01T00:00:00Z' })),
        updateNetworkMetadata: mock(async (_networkId: string, metadata: Record<string, unknown>) => {
          capturedMetadata = metadata;
        }),
      });
      const integrationAdapter = makeIntegrationAdapter({
        executeToolAction: mock(async () => ({
          successful: true,
          data: { items: calendarEvents },
          error: undefined,
        })),
      });

      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });
      await queue.processJob('tick', { trigger: 'tick' });

      expect(capturedMetadata).not.toBeNull();
      const events = (capturedMetadata as Record<string, unknown>).events as Array<Record<string, unknown>>;
      expect(events).toHaveLength(2);

      expect(events[0].externalId).toBe('evt-1');
      expect(events[0].title).toBe('Team Standup');
      expect(events[0].startTime).toBe('2026-01-15T09:00:00Z');
      expect(events[0].endTime).toBe('2026-01-15T09:30:00Z');
      expect(events[0].location).toBe('Room A');
      expect(events[0].description).toBe('Daily standup meeting');

      // All-day event uses date instead of dateTime
      expect(events[1].externalId).toBe('evt-2');
      expect(events[1].startTime).toBe('2026-01-20');
      expect(events[1].endTime).toBe('2026-01-21');
      expect(events[1].location).toBeUndefined();
    });
  });

  describe('syncGoogleCalendar — preserves existing sync config', () => {
    it('merges lastSyncAt/status into existing config without overwriting intervalMs', async () => {
      let capturedSyncConfig: Record<string, unknown> | null = null;
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: {
            status: 'active',
            intervalMs: 300_000, // user set 5-min interval
            lastSyncAt: '2025-01-01T00:00:00Z',
            calendarId: 'work',
          },
          ownerUserId: 'user-1',
        }]),
        getNetworkMetadata: mock(async () => ({})),
        updateIntegrationSyncConfig: mock(async (_networkId: string, _toolkit: string, syncConfig: Record<string, unknown>) => {
          capturedSyncConfig = syncConfig;
        }),
      });
      const integrationAdapter = makeIntegrationAdapter();
      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });

      await queue.processJob('tick', { trigger: 'tick' });

      expect(capturedSyncConfig).not.toBeNull();
      // User's custom intervalMs should be preserved
      expect(capturedSyncConfig!.intervalMs).toBe(300_000);
      expect(capturedSyncConfig!.calendarId).toBe('work');
      expect(capturedSyncConfig!.status).toBe('active');
      expect(capturedSyncConfig!.lastSyncAt).toBeDefined();
    });
  });

  describe('syncGoogleCalendar — error handling', () => {
    it('sets sync status to error when API call fails', async () => {
      let capturedSyncConfig: Record<string, unknown> | null = null;
      const dbAdapter = makeDbAdapter({
        getActiveIntegrationSyncs: mock(async () => [{
          networkId: 'net-1',
          toolkit: 'google_calendar',
          connectedAccountId: 'conn-1',
          syncConfig: { status: 'active', lastSyncAt: '2025-01-01T00:00:00Z', calendarId: 'primary' },
          ownerUserId: 'user-1',
        }]),
        getNetworkMetadata: mock(async () => ({})),
        updateIntegrationSyncConfig: mock(async (_networkId: string, _toolkit: string, syncConfig: Record<string, unknown>) => {
          capturedSyncConfig = syncConfig;
        }),
      });
      const integrationAdapter = makeIntegrationAdapter({
        executeToolAction: mock(async () => ({
          successful: false,
          data: undefined,
          error: 'Auth token expired',
        })),
      });

      const queue = new IntegrationSyncQueue({ dbAdapter, integrationAdapter });
      await queue.processJob('tick', { trigger: 'tick' });

      expect(capturedSyncConfig).not.toBeNull();
      expect(capturedSyncConfig!.status).toBe('error');
    });
  });

  describe('processJob — unknown job name', () => {
    it('does not throw for unknown job names', async () => {
      const queue = new IntegrationSyncQueue({ dbAdapter: makeDbAdapter() });
      // Should log a warning but not throw
      await queue.processJob('unknown-job', { trigger: 'tick' });
    });
  });
});
