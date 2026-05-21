/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock, beforeEach } from "bun:test";

import type { Opportunity } from '@indexnetwork/protocol';

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

const VIEWER_ID = "user-viewer-001";
const PEER_ID = "user-peer-002";
const INTRODUCER_ID = "user-introducer-003";
const OPP_ID_DIRECT = "opp-direct-001";
const OPP_ID_INTRODUCED = "opp-introduced-002";

const directOpportunity: Opportunity = {
  id: OPP_ID_DIRECT,
  detection: { source: "opportunity_graph", timestamp: new Date().toISOString() },
  actors: [
    { networkId: "idx-1", userId: VIEWER_ID, role: "patient" },
    { networkId: "idx-1", userId: PEER_ID, role: "agent" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Both users share interests in distributed systems and TypeScript.",
    confidence: 0.85,
    signals: [{ type: "semantic_match", weight: 0.9, detail: "Overlapping skills" }],
  },
  context: { networkId: "idx-1" },
  confidence: "0.85",
  status: "accepted",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

const introducedOpportunity: Opportunity = {
  id: OPP_ID_INTRODUCED,
  detection: {
    source: "manual",
    createdBy: INTRODUCER_ID,
    createdByName: "Alice Introducer",
    timestamp: new Date().toISOString(),
  },
  actors: [
    { networkId: "idx-1", userId: VIEWER_ID, role: "party" },
    { networkId: "idx-1", userId: PEER_ID, role: "party" },
    { networkId: "idx-1", userId: INTRODUCER_ID, role: "introducer" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Alice Introducer connected you because both parties work on AI agents.",
    confidence: 0.9,
    signals: [{ type: "curator_judgment", weight: 1, detail: "Manual match by curator" }],
  },
  context: { networkId: "idx-1" },
  confidence: "0.9",
  status: "accepted",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

/** Opportunity where the viewer IS the introducer (should be filtered out). */
const viewerIsIntroducerOpportunity: Opportunity = {
  id: "opp-viewer-introducer-003",
  detection: {
    source: "manual",
    createdBy: VIEWER_ID,
    createdByName: "Viewer Name",
    timestamp: new Date().toISOString(),
  },
  actors: [
    { networkId: "idx-1", userId: VIEWER_ID, role: "introducer" },
    { networkId: "idx-1", userId: PEER_ID, role: "party" },
    { networkId: "idx-1", userId: "user-third-004", role: "party" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Viewer introduced these two people.",
    confidence: 0.8,
  },
  context: { networkId: "idx-1" },
  confidence: "0.8",
  status: "accepted",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

/** Opportunity where the peer IS the introducer (should also be filtered out). */
const peerIsIntroducerOpportunity: Opportunity = {
  id: "opp-peer-introducer-004",
  detection: {
    source: "manual",
    createdBy: PEER_ID,
    createdByName: "Peer Name",
    timestamp: new Date().toISOString(),
  },
  actors: [
    { networkId: "idx-1", userId: PEER_ID, role: "introducer" },
    { networkId: "idx-1", userId: VIEWER_ID, role: "party" },
    { networkId: "idx-1", userId: "user-fifth-005", role: "party" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Peer introduced these two people.",
    confidence: 0.8,
  },
  context: { networkId: "idx-1" },
  confidence: "0.8",
  status: "accepted",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

const peerUser = { id: PEER_ID, name: "Peer Person", email: "peer@example.com", avatar: "https://example.com/peer.jpg" };

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockPresent = mock(() =>
  Promise.resolve({
    headline: "A great connection for you",
    personalizedSummary: "You both share deep expertise in distributed systems.",
    suggestedAction: "Send a message to start the conversation.",
  })
);

const mockGatherPresenterContext = mock(() =>
  Promise.resolve({
    viewerContext: "Name: Viewer\nBio: Developer",
    otherPartyContext: "Name: Peer\nBio: Engineer",
    matchReasoning: "Both share interests in distributed systems.",
    category: "collaboration",
    confidence: 0.85,
    signalsSummary: "semantic_match: Overlapping skills",
    indexName: "Test Index",
    viewerRole: "patient",
    introducerName: undefined,
  })
);

// Mock the presenter module — spread real module to preserve all other exports
const realProtocol = await import("@indexnetwork/protocol");
mock.module("@indexnetwork/protocol", () => ({
  ...realProtocol,
  OpportunityPresenter: class {
    present = mockPresent;
    presentHomeCard = mock(() => {
      throw new Error("presentHomeCard should not be called in chat context");
    });
  },
  gatherPresenterContext: mockGatherPresenterContext,
}));

// Mock adapters that OpportunityService constructor tries to initialize
mock.module("../../adapters/database.adapter", () => ({
  ChatDatabaseAdapter: class {
    findOpportunitiesByActors: unknown;
    getUser: unknown;
    getHydeDocument() { return null; }
  },
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

// ─────────────────────────────────────────────────────────────────────────────
// Import service AFTER mocks
// ─────────────────────────────────────────────────────────────────────────────

const { OpportunityService } = await import("../opportunity.service");

function createService(rows: Opportunity[]) {
  const service = new OpportunityService();
  // Override the db methods used by getChatContext
  (service as unknown as Record<string, unknown>).db = {
    findOpportunitiesByActors: mock(() => Promise.resolve(rows)),
    getUser: mock(() => Promise.resolve(peerUser)),
  };
  return service;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OpportunityService.getChatContext", () => {
  beforeEach(() => {
    mockPresent.mockClear();
    mockGatherPresenterContext.mockClear();
  });

  describe("introducer filtering", () => {
    it("should keep direct (non-introducer) opportunities", async () => {
      const service = createService([directOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].opportunityId).toBe(OPP_ID_DIRECT);
    });

    it("should keep opportunities where a third party is the introducer", async () => {
      const service = createService([introducedOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].opportunityId).toBe(OPP_ID_INTRODUCED);
    });

    it("should filter out opportunities where the viewer is the introducer", async () => {
      const service = createService([directOpportunity, viewerIsIntroducerOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].opportunityId).toBe(OPP_ID_DIRECT);
    });

    it("should filter out opportunities where the peer is the introducer", async () => {
      const service = createService([directOpportunity, peerIsIntroducerOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].opportunityId).toBe(OPP_ID_DIRECT);
    });

    it("should filter out both viewer-introducer and peer-introducer opportunities", async () => {
      const service = createService([
        directOpportunity,
        viewerIsIntroducerOpportunity,
        peerIsIntroducerOpportunity,
      ]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities[0].opportunityId).toBe(OPP_ID_DIRECT);
    });

    it("should return empty when all opportunities involve chat participants as introducers", async () => {
      const service = createService([viewerIsIntroducerOpportunity, peerIsIntroducerOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities).toHaveLength(0);
    });
  });

  describe("presenter usage", () => {
    it("should call present() not presentHomeCard()", async () => {
      const service = createService([directOpportunity]);
      await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(mockPresent).toHaveBeenCalledTimes(1);
    });

    it("should set opportunityStatus to accepted on presenter input", async () => {
      const service = createService([directOpportunity]);
      await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(mockPresent).toHaveBeenCalledTimes(1);
      const presenterInput = (mockPresent.mock.calls as unknown[][])[0]?.[0] as Record<string, unknown> | undefined;
      expect(presenterInput?.opportunityStatus).toBe("accepted");
    });

    it("should return headline and personalizedSummary from presenter", async () => {
      const service = createService([directOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].headline).toBe("A great connection for you");
      expect(result.opportunities[0].personalizedSummary).toBe(
        "You both share deep expertise in distributed systems."
      );
    });

    it("should return empty narratorRemark (not used in chat context)", async () => {
      const service = createService([directOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].narratorRemark).toBe("");
    });

    it("should return peer info from database", async () => {
      const service = createService([directOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].peerName).toBe("Peer Person");
      expect(result.opportunities[0].peerAvatar).toBe("https://example.com/peer.jpg");
    });
  });

  describe("fallback sanitization", () => {
    it("should sanitize UUIDs from reasoning on presenter failure", async () => {
      mockPresent.mockImplementationOnce(() => Promise.reject(new Error("LLM timeout")));

      const oppWithUuid: Opportunity = {
        ...directOpportunity,
        interpretation: {
          ...directOpportunity.interpretation,
          reasoning: "User abc12345-1234-1234-1234-123456789abc has relevant skills in TypeScript.",
        },
      };
      const service = createService([oppWithUuid]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].personalizedSummary).not.toContain("abc12345-1234-1234-1234-123456789abc");
      expect(result.opportunities[0].personalizedSummary).toContain("relevant skills in TypeScript");
    });

    it("should strip introducer mentions from reasoning on presenter failure", async () => {
      mockPresent.mockImplementationOnce(() => Promise.reject(new Error("LLM timeout")));

      // gatherPresenterContext won't be called on fallback, so introducer comes from actors
      const service = createService([introducedOpportunity]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].personalizedSummary).not.toContain("Alice Introducer connected you");
      expect(result.opportunities[0].introducerName).toBe("Alice Introducer");
    });

    it("should use 'Connection opportunity' when reasoning is empty on fallback", async () => {
      mockPresent.mockImplementationOnce(() => Promise.reject(new Error("LLM timeout")));

      const oppEmpty: Opportunity = {
        ...directOpportunity,
        interpretation: { ...directOpportunity.interpretation, reasoning: "" },
      };
      const service = createService([oppEmpty]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].headline).toBe("Connection opportunity");
    });

    it("should truncate headline to 80 chars on fallback", async () => {
      mockPresent.mockImplementationOnce(() => Promise.reject(new Error("LLM timeout")));

      const longReasoning = "A".repeat(200);
      const oppLong: Opportunity = {
        ...directOpportunity,
        interpretation: { ...directOpportunity.interpretation, reasoning: longReasoning },
      };
      const service = createService([oppLong]);
      const result = await service.getChatContext(VIEWER_ID, PEER_ID);

      expect(result.opportunities[0].headline.length).toBe(80);
      expect(result.opportunities[0].personalizedSummary.length).toBe(200);
    });
  });
});
