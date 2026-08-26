/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock, afterAll } from "bun:test";

import type { OpportunityCache } from '@indexnetwork/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — must be set up before importing OpportunityService
// ─────────────────────────────────────────────────────────────────────────────

mock.module("../../lib/opportunity/discovery", () => ({
  intentDiscovery: { addJob: mock(() => Promise.resolve({ id: "job-1" })) },
}));

const MockChatDatabaseAdapter = class {
  getHydeDocument() { return null; }
};
mock.module("../../adapters/database.adapter", () => ({
  ChatDatabaseAdapter: MockChatDatabaseAdapter,
  chatDatabaseAdapter: new MockChatDatabaseAdapter(),
}));
mock.module("../../adapters/embedder.adapter", () => ({
  EmbedderAdapter: class {},
}));
const MockRedisCacheAdapter = class {
  get = mock(() => Promise.resolve(null));
  set = mock(() => Promise.resolve());
  mget = mock(() => Promise.resolve([]));
};
mock.module("../../adapters/cache.adapter", () => ({
  RedisCacheAdapter: MockRedisCacheAdapter,
  cacheAdapter: new MockRedisCacheAdapter(),
}));

afterAll(() => {
  mock.restore();
});

// ─────────────────────────────────────────────────────────────────────────────
// Import service AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

const { OpportunityService } = await import("../opportunity.service");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const USER_ID = "user-rediscovery-001";

function createMockCache(): OpportunityCache {
  return {
    get: mock((_key: string) => Promise.resolve(null)) as unknown as OpportunityCache['get'],
    set: mock((_key: string, _value: unknown, _options?: { ttl?: number }) => Promise.resolve()) as unknown as OpportunityCache['set'],
    mget: mock((_keys: string[]) => Promise.resolve([])) as unknown as OpportunityCache['mget'],
  };
}

function createService(opts: {
  radarGraphResult?: Record<string, unknown>;
  withMaintenanceGraph?: boolean;
}) {
  const cache = createMockCache();
  const service = new OpportunityService(undefined, cache);

  const graphResult = opts.radarGraphResult ?? { items: [], meta: { totalOpportunities: 0 } };
  (service as unknown as Record<string, unknown>).radarGraph = {
    invoke: mock(() => Promise.resolve(graphResult)),
  };

  const mockMaintenanceInvoke = mock(() => Promise.resolve({}));
  if (opts.withMaintenanceGraph !== false) {
    (service as unknown as Record<string, unknown>).maintenanceGraph = {
      invoke: mockMaintenanceInvoke,
    };
  } else {
    (service as unknown as Record<string, unknown>).maintenanceGraph = undefined;
  }

  return { service, mockMaintenanceInvoke };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OpportunityService.getRadarView — rediscovery trigger", () => {
  it("triggers maintenance graph on every radar view request", async () => {
    const { service, mockMaintenanceInvoke } = createService({});

    await service.getRadarView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockMaintenanceInvoke).toHaveBeenCalledTimes(1);
    const calls = mockMaintenanceInvoke.mock.calls as unknown as Array<[{ userId: string }]>;
    expect(calls[0][0]).toEqual({ userId: USER_ID });
  });

  it("sets maintenanceTriggered:true in meta", async () => {
    const { service } = createService({});

    const result = await service.getRadarView(USER_ID);

    expect('meta' in result).toBe(true);
    expect((result as { meta: { maintenanceTriggered: boolean } }).meta.maintenanceTriggered).toBe(true);
  });

  it("does NOT trigger maintenance graph when networkId scoped", async () => {
    const { service, mockMaintenanceInvoke } = createService({});

    await service.getRadarView(USER_ID, { networkId: "some-network-id" });
    await new Promise((r) => setTimeout(r, 50));

    expect(mockMaintenanceInvoke).not.toHaveBeenCalled();
  });

  it("does NOT trigger maintenance graph when maintenanceGraph is absent", async () => {
    const { service, mockMaintenanceInvoke } = createService({ withMaintenanceGraph: false });

    await service.getRadarView(USER_ID);
    await new Promise((r) => setTimeout(r, 50));

    expect(mockMaintenanceInvoke).not.toHaveBeenCalled();
  });

  it("still returns radar view even when maintenance graph throws", async () => {
    const { service, mockMaintenanceInvoke } = createService({
      radarGraphResult: {
        items: [{ id: "opp-1" }],
        meta: { totalOpportunities: 1 },
      },
    });
    mockMaintenanceInvoke.mockImplementation(() => Promise.reject(new Error("Maintenance failed")));

    const result = await service.getRadarView(USER_ID);

    expect('items' in result).toBe(true);
    expect((result as { items: unknown[] }).items).toHaveLength(1);
  });
});
