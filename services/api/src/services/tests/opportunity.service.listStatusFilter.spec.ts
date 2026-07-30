/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock } from "bun:test";

import type { Opportunity, OpportunityControllerDatabase } from "@indexnetwork/protocol";
import { OpportunityService } from "../opportunity.service";

// ─────────────────────────────────────────────────────────────────────────────
// IND-254: the default opportunity list (no explicit status) must hide
// terminal-stale `expired`/`rejected` while still honoring an explicit
// `?status=expired` for a history view. The service expresses this by passing a
// live-status allow-list to the adapter when no single status is requested.
//
// The per-user list keeps `latent` (gated per-actor by the adapter's visibility
// guard); the per-network list drops `latent` too, since it has no per-actor
// guard and would otherwise leak candidate-pool opportunities to all members.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_USER_STATUSES = ["latent", "negotiating", "pending", "stalled", "accepted"];
const EXPECTED_NETWORK_STATUSES = ["negotiating", "pending", "stalled", "accepted"];

type Captured = { opts?: Record<string, unknown> };

function createService() {
  const userCall: Captured = {};
  const networkCall: Captured = {};
  const db = {
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
  } as unknown as OpportunityControllerDatabase;
  const service = new OpportunityService(db);
  return { service, userCall, networkCall };
}

function unsafeOpportunity(): Opportunity {
  const now = new Date('2026-07-18T12:00:00.000Z');
  return {
    id: 'opp-unsafe',
    detection: { source: 'opportunity_graph', timestamp: now.toISOString() },
    actors: [
      { userId: 'user-1' as never, networkId: 'net-1' as never, role: 'peer' },
      { userId: 'user-2' as never, networkId: 'net-1' as never, role: 'peer' },
    ],
    interpretation: {
      category: 'connection',
      reasoning: 'Yusuf, an attendee of the Edge Esmeralda network, is a strong match.',
      confidence: 0.9,
    },
    context: { networkId: 'net-1' as never },
    confidence: '0.9',
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  };
}

describe("OpportunityService list status filtering (IND-254)", () => {
  describe("getOpportunitiesForUser", () => {
    it("defaults to live statuses (no expired/rejected) when no status is given", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1");

      expect(userCall.opts?.statuses).toEqual(EXPECTED_USER_STATUSES);
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

    it("preserves an explicit statuses filter instead of overwriting it with the default", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1", { statuses: ["expired", "rejected"] });

      expect(userCall.opts?.statuses).toEqual(["expired", "rejected"]);
    });

    it("preserves other options (networkId and intent scope) alongside the default allow-list", async () => {
      const { service, userCall } = createService();
      await service.getOpportunitiesForUser("user-1", { networkId: "net-1", scopeType: 'intent', scopeId: "intent-1" });

      expect(userCall.opts?.networkId).toBe("net-1");
      expect(userCall.opts?.scopeType).toBe('intent');
      expect(userCall.opts?.scopeId).toBe("intent-1");
      expect(userCall.opts?.statuses).toEqual(EXPECTED_USER_STATUSES);
    });

    it('removes unsupported affiliation claims from raw REST list reasoning', async () => {
      const db = {
        getOpportunitiesForUser: mock(async () => [unsafeOpportunity()]),
        getUser: mock(async (userId: string) => ({
          id: userId,
          name: userId === 'user-1' ? 'Viewer' : 'Yusuf',
          email: `${userId}@test.com`,
          avatar: null,
          socials: [],
        })),
      } as unknown as OpportunityControllerDatabase;
      const service = new OpportunityService(db);

      const rows = await service.getOpportunitiesForUser('user-1');

      expect(rows[0]?.interpretation.reasoning).toBe('Connection opportunity');
      expect(JSON.stringify(rows[0])).not.toContain('attendee');
    });
  });

  describe("getOpportunitiesForNetwork", () => {
    it("defaults to live community statuses (no latent/expired/rejected) when no status is given", async () => {
      const { service, networkCall } = createService();
      await service.getOpportunitiesForNetwork("net-1", "user-1");

      expect(networkCall.opts?.statuses).toEqual(EXPECTED_NETWORK_STATUSES);
      expect(networkCall.opts?.statuses).not.toContain("latent");
      expect(networkCall.opts?.statuses).not.toContain("expired");
      expect(networkCall.opts?.status).toBeUndefined();
    });

    it("honors an explicit terminal status without injecting the allow-list", async () => {
      const { service, networkCall } = createService();
      await service.getOpportunitiesForNetwork("net-1", "user-1", { status: "rejected" });

      expect(networkCall.opts?.status).toBe("rejected");
      expect(networkCall.opts?.statuses).toBeUndefined();
    });

    it("preserves an explicit statuses filter instead of overwriting it with the default", async () => {
      const { service, networkCall } = createService();
      await service.getOpportunitiesForNetwork("net-1", "user-1", { statuses: ["expired"] });

      expect(networkCall.opts?.statuses).toEqual(["expired"]);
    });

    it('removes unsupported affiliation claims from raw network-list reasoning', async () => {
      const db = {
        getOpportunitiesForNetwork: mock(async () => [unsafeOpportunity()]),
        isIndexOwner: mock(async () => true),
        isNetworkMember: mock(async () => true),
      } as unknown as OpportunityControllerDatabase;
      const service = new OpportunityService(db);

      const rows = await service.getOpportunitiesForNetwork('net-1', 'user-1');

      expect(Array.isArray(rows)).toBe(true);
      if (!Array.isArray(rows)) throw new Error('Expected opportunity rows');
      expect(rows[0]?.interpretation.reasoning).toBe('Connection opportunity');
      expect(JSON.stringify(rows[0])).not.toContain('attendee');
    });
  });


});
