/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock, afterAll } from "bun:test";

import type { Opportunity } from "@indexnetwork/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// IND-254: the default opportunity list (no explicit status) must hide
// terminal-stale `expired`/`rejected` while still honoring an explicit
// `?status=expired` for a history view. The service expresses this by passing a
// live-status allow-list to the adapter when no single status is requested.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_LIVE_STATUSES = ["latent", "negotiating", "pending", "stalled", "accepted"];

// Mock adapters that the OpportunityService constructor initializes
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
mock.module("../../adapters/cache.adapter", () => ({
  RedisCacheAdapter: class {
    mget() { return Promise.resolve([]); }
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve(); }
    del() { return Promise.resolve(); }
  },
}));

afterAll(() => {
  mock.restore();
});

const { OpportunityService } = await import("../opportunity.service");

type Captured = { opts?: Record<string, unknown> };

function createService() {
  const service = new OpportunityService();
  const userCall: Captured = {};
  const networkCall: Captured = {};
  (service as unknown as Record<string, unknown>).db = {
    getOpportunitiesForUser: mock((_userId: string, opts?: Record<string, unknown>) => {
      userCall.opts = opts;
      return Promise.resolve([] as Opportunity[]);
    }),
    getOpportunitiesForNetwork: mock((_networkId: string, opts?: Record<string, unknown>) => {
      networkCall.opts = opts;
      return Promise.resolve([] as Opportunity[]);
    }),
    getUser: mock(() => Promise.resolve(null)),
    isIndexOwner: mock(() => Promise.resolve(true)),
    isNetworkMember: mock(() => Promise.resolve(true)),
  };
  return { service, userCall, networkCall };
}

describe("OpportunityService list status filtering (IND-254)", () => {
  describe("getOpportunitiesForUser", () => {
    it("defaults to live statuses (no expired/rejected) when no status is given", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1");

      expect(userCall.opts?.statuses).toEqual(EXPECTED_LIVE_STATUSES);
      expect(userCall.opts?.statuses).not.toContain("expired");
      expect(userCall.opts?.statuses).not.toContain("rejected");
      expect(userCall.opts?.status).toBeUndefined();
    });

    it("honors an explicit terminal status (history view) without injecting the allow-list", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1", { status: "expired" });

      expect(userCall.opts?.status).toBe("expired");
      expect(userCall.opts?.statuses).toBeUndefined();
    });

    it("preserves other options (networkId) alongside the default allow-list", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1", { networkId: "net-1" });

      expect(userCall.opts?.networkId).toBe("net-1");
      expect(userCall.opts?.statuses).toEqual(EXPECTED_LIVE_STATUSES);
    });
  });

  describe("getOpportunitiesForNetwork", () => {
    it("defaults to live statuses when no status is given", async () => {
      const { service, networkCall } = createService();
      await service.getOpportunitiesForNetwork("net-1", "user-1");

      expect(networkCall.opts?.statuses).toEqual(EXPECTED_LIVE_STATUSES);
      expect(networkCall.opts?.status).toBeUndefined();
    });

    it("honors an explicit terminal status without injecting the allow-list", async () => {
      const { service, networkCall } = createService();
      await service.getOpportunitiesForNetwork("net-1", "user-1", { status: "rejected" });

      expect(networkCall.opts?.status).toBe("rejected");
      expect(networkCall.opts?.statuses).toBeUndefined();
    });
  });
});
