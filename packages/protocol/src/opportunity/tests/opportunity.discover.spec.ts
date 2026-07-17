/**
 * Unit tests for opportunity discover: runDiscoverFromQuery with mocked opportunity graph.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect } from "bun:test";
import { runDiscoverFromQuery } from "../opportunity.discover.js";
import type { FormattedDiscoveryCandidate } from "../opportunity.discover.js";
import type { ChatGraphCompositeDatabase } from "../../shared/interfaces/database.interface.js";

describe("opportunity.discover", () => {
  const mockDatabase: ChatGraphCompositeDatabase = {
    getProfile: async () => null,
    getUser: async () => null,
    getUserContext: async () => null,
  } as unknown as ChatGraphCompositeDatabase;

  describe("runDiscoverFromQuery", () => {
    test("returns message when query is empty", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "   ",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toBeDefined();
    });

    test("returns message when indexScope is empty", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: [],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("network");
    });

    test("returns found: false when graph returns no opportunities", async () => {
      const mockGraph = {
        invoke: async () => ({ opportunities: [] }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("No matching");
    });

    test("returns enriched opportunities when graph returns matches", async () => {
      const candidateId = "candidate-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-1",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: candidateId, role: "agent" },
              ],
              interpretation: {
                reasoning: "Strong match for mentorship.",
                confidence: 0.85,
              },
            },
          ],
        }),
      };
      const dbWithProfile = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? {
                identity: { name: "Jane Mentor", bio: "Experienced advisor." },
                attributes: {},
                narrative: {},
                embedding: [0.1, 0.2, 0.3],
              }
            : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithProfile,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
        limit: 5,
      });

      expect(result.found).toBe(true);
      expect(result.count).toBe(1);
      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities![0]).toMatchObject({
        opportunityId: "opp-1",
        userId: candidateId,
        name: "Jane Mentor",
        bio: "Experienced advisor.",
        matchReason: "Strong match for mentorship.",
        score: 0.85,
      });
    });

    test("does not expose unsupported claims through public matchReason", async () => {
      const candidateId = "candidate-unsafe";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [{
            id: "opp-unsafe",
            actors: [
              { networkId: "idx-1", userId: "u1", role: "patient" },
              { networkId: "idx-1", userId: candidateId, role: "agent" },
            ],
            interpretation: {
              reasoning: "Jane attended the same event as the viewer.",
              confidence: 0.85,
            },
          }],
        }),
      };
      const dbWithProfile = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? { identity: { name: "Jane Mentor", bio: "Advisor." } }
            : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as Parameters<typeof runDiscoverFromQuery>[0]["opportunityGraph"],
        database: dbWithProfile,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });

      expect(result.opportunities?.[0].matchReason).toBe("A suggested connection.");
      expect(result.opportunities?.[0].matchReason).not.toContain("attended");
    });

    test("on graph throw, returns found: false with generic message", async () => {
      const mockGraph = {
        invoke: async () => {
          throw new Error("Network error");
        },
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.count).toBe(0);
      expect(result.message).toContain("Failed");
    });

    test("invokes opportunity graph with options.initialStatus: 'latent'", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find me a mentor",
        indexScope: ["idx1"],
      });
      expect(capturedInvokeArg.options).toBeDefined();
      expect((capturedInvokeArg.options as { initialStatus?: string }).initialStatus).toBe("latent");
    });

    test("invokes opportunity graph with initialStatus 'draft' and conversationId when chatSessionId provided", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
        chatSessionId: "session-abc",
      });
      expect(capturedInvokeArg.options).toBeDefined();
      const options = capturedInvokeArg.options as { initialStatus?: string; conversationId?: string };
      expect(options.initialStatus).toBe("draft");
      expect(options.conversationId).toBe("session-abc");
    });

    test("passes triggerIntentId to graph when provided", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
        triggerIntentId: "intent-123",
      });
      expect(capturedInvokeArg.triggerIntentId).toBe("intent-123");
    });

    test("falls back to user record name when profile has no identity.name", async () => {
      const candidateId = "candidate-no-profile-name";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-fallback",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: candidateId, role: "agent" },
              ],
              interpretation: {
                reasoning: "Yuki Tanaka is a visual artist looking for clients.",
                confidence: 0.8,
              },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      // Profile exists but has NO identity.name; user record has name
      const dbWithUserFallback = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? { identity: { bio: "Visual artist and illustrator." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] }
            : null,
        getUser: async (userId: string) =>
          userId === candidateId
            ? { name: "Yuki Tanaka", avatar: "https://example.com/yuki.jpg" }
            : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithUserFallback,
        userId: "u1",
        query: "find designers",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      expect(result.opportunities).toHaveLength(1);
      // Should use the user record name, not undefined/"Someone"
      expect(result.opportunities![0].name).toBe("Yuki Tanaka");
    });

    test("passes onBehalfOfUserId to graph invoke when provided", async () => {
      let capturedInvokeArg: Record<string, unknown> = {};
      const mockGraph = {
        invoke: async (arg: Record<string, unknown>) => {
          capturedInvokeArg = arg;
          return { opportunities: [] };
        },
      };
      await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "introducer-user",
        query: "find a designer for my friend",
        indexScope: ["idx1"],
        onBehalfOfUserId: "target-user",
      });
      expect(capturedInvokeArg.onBehalfOfUserId).toBe("target-user");
      expect(capturedInvokeArg.userId).toBe("introducer-user");
    });

    test("enriches introducer discovery cards with correct viewerRole, headline, and action label (minimalForChat)", async () => {
      const introducerId = "introducer-user";
      const targetId = "target-user";
      const candidateId = "candidate-match";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-intro-1",
              actors: [
                { networkId: "idx-1", userId: targetId, role: "patient" },
                { networkId: "idx-1", userId: candidateId, role: "agent" },
                { networkId: "idx-1", userId: introducerId, role: "introducer" },
              ],
              interpretation: {
                reasoning: "Great match for collaboration.",
                confidence: 0.9,
              },
              detection: { source: "manual", createdBy: introducerId, timestamp: new Date().toISOString() },
              status: "draft",
            },
          ],
        }),
      };
      const dbWithProfiles = {
        ...mockDatabase,
        getProfile: async (userId: string) => {
          if (userId === targetId)
            return { identity: { name: "Alice Target", bio: "Product designer." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] };
          if (userId === candidateId)
            return { identity: { name: "Bob Candidate", bio: "UX researcher." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] };
          return null;
        },
        getUser: async (userId: string) => {
          if (userId === introducerId) return { name: "Carol Introducer", avatar: null };
          if (userId === targetId) return { name: "Alice Target", avatar: null };
          if (userId === candidateId) return { name: "Bob Candidate", avatar: null };
          return null;
        },
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithProfiles,
        userId: introducerId,
        query: "find someone for Alice",
        indexScope: ["idx1"],
        onBehalfOfUserId: targetId,
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      expect(result.opportunities).toHaveLength(1);
      const card = result.opportunities![0];
      // Viewer is the introducer
      expect(card.viewerRole).toBe("introducer");
      // Home card presentation should have "Introduce Them" action
      expect(card.homeCardPresentation?.primaryActionLabel).toBe("Good match");
      // Headline should be "PartyName → OtherPartyName" format
      expect(card.homeCardPresentation?.headline).toContain("→");
      // Narrator chip should be "You" since viewer is the introducer
      expect(card.narratorChip?.name).toBe("You");
      expect(card.narratorChip?.userId).toBe(introducerId);
    });

    test("introducer discovery with third-party introducer shows introducer name in narrator chip", async () => {
      const viewerId = "viewer-user";
      const introducerThirdPartyId = "third-party-introducer";
      const candidateId = "candidate-match";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-third-party",
              actors: [
                { networkId: "idx-1", userId: viewerId, role: "patient" },
                { networkId: "idx-1", userId: candidateId, role: "agent" },
                { networkId: "idx-1", userId: introducerThirdPartyId, role: "introducer" },
              ],
              interpretation: {
                reasoning: "Recommended by a mutual friend.",
                confidence: 0.75,
              },
              detection: {
                source: "manual",
                createdBy: introducerThirdPartyId,
                createdByName: "Dan Introducer",
                timestamp: new Date().toISOString(),
              },
              status: "draft",
            },
          ],
        }),
      };
      const dbForThirdParty = {
        ...mockDatabase,
        getProfile: async (userId: string) => {
          if (userId === candidateId)
            return { identity: { name: "Eve Match", bio: "Engineer." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] };
          return null;
        },
        getUser: async (userId: string) => {
          if (userId === viewerId) return { name: "Viewer User", avatar: null };
          if (userId === introducerThirdPartyId) return { name: "Dan Introducer", avatar: "https://example.com/dan.jpg" };
          if (userId === candidateId) return { name: "Eve Match", avatar: null };
          return null;
        },
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbForThirdParty,
        userId: viewerId,
        query: "show connections",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      const card = result.opportunities![0];
      // Viewer is patient, not introducer
      expect(card.viewerRole).toBe("patient");
      // Standard card format (not introducer view)
      expect(card.homeCardPresentation?.primaryActionLabel).toBe("Start Chat");
      // Narrator chip should show third-party introducer name
      expect(card.narratorChip?.name).toBe("Dan Introducer");
      expect(card.narratorChip?.userId).toBe(introducerThirdPartyId);
      expect(card.narratorChip?.avatar).toBe("https://example.com/dan.jpg");
    });

    test("standard discovery without introducer shows 'Index' narrator chip", async () => {
      const candidateId = "candidate-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-standard",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: candidateId, role: "agent" },
              ],
              interpretation: {
                reasoning: "Good fit for mentoring.",
                confidence: 0.8,
              },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      const dbWithProfile = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === candidateId
            ? { identity: { name: "Frank Mentor", bio: "Senior dev." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] }
            : null,
        getUser: async (userId: string) =>
          userId === candidateId
            ? { name: "Frank Mentor", avatar: null }
            : userId === "u1"
              ? { name: "User One", avatar: null }
              : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithProfile,
        userId: "u1",
        query: "find a mentor",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      const card = result.opportunities![0];
      expect(card.narratorChip?.name).toBe("Index");
      expect(card.narratorChip?.userId).toBeUndefined();
      expect(card.homeCardPresentation?.primaryActionLabel).toBe("Start Chat");
      expect(card.homeCardPresentation?.headline).toContain("Connection with");
    });

    test("excludes soft-deleted users from enriched results", async () => {
      const deletedUserId = "deleted-user-1";
      const activeUserId = "active-user-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-deleted",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: deletedUserId, role: "agent" },
              ],
              interpretation: { reasoning: "Match with deleted user.", confidence: 0.9 },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
            {
              id: "opp-active",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: activeUserId, role: "agent" },
              ],
              interpretation: { reasoning: "Match with active user.", confidence: 0.85 },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      const dbWithDeletedUser = {
        ...mockDatabase,
        getProfile: async (userId: string) => {
          if (userId === deletedUserId)
            return { identity: { name: "Deleted Person", bio: "Gone." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] };
          if (userId === activeUserId)
            return { identity: { name: "Active Person", bio: "Here." }, attributes: {}, narrative: {}, embedding: [0.1, 0.2, 0.3] };
          return null;
        },
        getUser: async (userId: string) => {
          if (userId === deletedUserId)
            return { id: deletedUserId, name: "Deleted Person", avatar: null, deletedAt: new Date("2026-01-01") };
          if (userId === activeUserId)
            return { id: activeUserId, name: "Active Person", avatar: null, deletedAt: null };
          if (userId === "u1")
            return { id: "u1", name: "Viewer", avatar: null, deletedAt: null };
          return null;
        },
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithDeletedUser,
        userId: "u1",
        query: "find connections",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      expect(result.opportunities).toHaveLength(1);
      expect(result.opportunities![0].userId).toBe(activeUserId);
      // The deleted user should NOT appear
      const deletedMatch = result.opportunities!.find((o) => o.userId === deletedUserId);
      expect(deletedMatch).toBeUndefined();
    });

    test("ghost counterpart gets 'Start Chat' primaryActionLabel in minimalForChat path (IND-161)", async () => {
      const ghostId = "ghost-user-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-ghost",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: ghostId, role: "agent" },
              ],
              interpretation: { reasoning: "Great match.", confidence: 0.88 },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      const dbWithGhostUser = {
        ...mockDatabase,
        getProfile: async () => null,
        getUser: async (userId: string) =>
          userId === ghostId
            ? { id: ghostId, name: "Ghost User", avatar: null, isGhost: true }
            : userId === "u1"
              ? { id: "u1", name: "Viewer", avatar: null, isGhost: false }
              : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithGhostUser,
        userId: "u1",
        query: "find connections",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      const card = result.opportunities![0];
      expect(card.isGhost).toBe(true);
      expect(card.homeCardPresentation?.primaryActionLabel).toBe("Start Chat");
    });

    test("non-ghost counterpart keeps 'Start Chat' primaryActionLabel in minimalForChat path (IND-161)", async () => {
      const onboardedId = "onboarded-user-1";
      const mockGraph = {
        invoke: async () => ({
          opportunities: [
            {
              id: "opp-onboarded",
              actors: [
                { networkId: "idx-1", userId: "u1", role: "patient" },
                { networkId: "idx-1", userId: onboardedId, role: "agent" },
              ],
              interpretation: { reasoning: "Good match.", confidence: 0.82 },
              detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
              status: "latent",
            },
          ],
        }),
      };
      const dbWithOnboardedUser = {
        ...mockDatabase,
        getProfile: async (userId: string) =>
          userId === onboardedId
            ? { embedding: [0.1, 0.2, 0.3] }
            : null,
        getUser: async (userId: string) =>
          userId === onboardedId
            ? { id: onboardedId, name: "Onboarded User", avatar: null, isGhost: false }
            : userId === "u1"
              ? { id: "u1", name: "Viewer", avatar: null, isGhost: false }
              : null,
      } as unknown as ChatGraphCompositeDatabase;

      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: dbWithOnboardedUser,
        userId: "u1",
        query: "find connections",
        indexScope: ["idx1"],
        minimalForChat: true,
      });

      expect(result.found).toBe(true);
      const card = result.opportunities![0];
      expect(card.isGhost).toBe(false);
      expect(card.homeCardPresentation?.primaryActionLabel).toBe("Start Chat");
    });

    test("returns createIntentSuggested and suggestedIntentDescription when graph returns create-intent signal", async () => {
      const mockGraph = {
        invoke: async () => ({
          opportunities: [],
          createIntentSuggested: true,
          suggestedIntentDescription: "Looking for a technical co-founder",
        }),
      };
      const result = await runDiscoverFromQuery({
        opportunityGraph: mockGraph as any,
        database: mockDatabase,
        userId: "u1",
        query: "find a co-founder",
        indexScope: ["idx1"],
      });
      expect(result.found).toBe(false);
      expect(result.createIntentSuggested).toBe(true);
      expect(result.suggestedIntentDescription).toBe("Looking for a technical co-founder");
      expect(result.message).toBeDefined();
    });
  });
});

// ─── Introducer cards tests (Bug 1: secondParty) ────────────────────────────

const introducerMockDatabase: ChatGraphCompositeDatabase = {
  getProfile: async () => null,
  getUser: async () => null,
  getUserContext: async () => null,
} as unknown as ChatGraphCompositeDatabase;

describe("introducer discovery cards - secondParty (Bug 1)", () => {
  const introducerId = "introducer-user";
  const targetId = "target-user";
  const candidateId = "candidate-match";

  const dbWithProfiles = {
    ...introducerMockDatabase,
    getProfile: async (userId: string) => {
      if (userId === candidateId)
        return { embedding: [0.1, 0.2, 0.3], identity: { name: "Bob Candidate", bio: "UX researcher." }, attributes: {}, narrative: {} };
      if (userId === targetId)
        return { embedding: [0.1, 0.2, 0.3], identity: { name: "Alice Target", bio: "Product designer." }, attributes: {}, narrative: {} };
      return null;
    },
    getUser: async (userId: string) => {
      if (userId === introducerId)
        return { name: "Carol Introducer", avatar: "https://example.com/carol.jpg" };
      if (userId === targetId)
        return { name: "Alice Target", avatar: "https://example.com/alice.jpg" };
      if (userId === candidateId)
        return { name: "Bob Candidate", avatar: "https://example.com/bob.jpg" };
      return null;
    },
  } as unknown as ChatGraphCompositeDatabase;

  test("enriched introducer card includes secondParty with correct name and userId", async () => {
    const mockGraph = {
      invoke: async () => ({
        opportunities: [
          {
            id: "opp-intro-1",
            actors: [
              { indexId: "idx-1", userId: targetId, role: "patient" },
              { indexId: "idx-1", userId: candidateId, role: "agent" },
              { indexId: "idx-1", userId: introducerId, role: "introducer" },
            ],
            interpretation: {
              reasoning: "Bob and Alice share interest in AI.",
              confidence: 0.9,
            },
            detection: { source: "manual", createdBy: introducerId, timestamp: new Date().toISOString() },
            status: "draft",
          },
        ],
      }),
    };

    const result = await runDiscoverFromQuery({
      opportunityGraph: mockGraph as any,
      database: dbWithProfiles,
      userId: introducerId,
      query: "who should I connect Alice with?",
      indexScope: ["idx1"],
      onBehalfOfUserId: targetId,
      minimalForChat: true,
    });

    expect(result.found).toBe(true);
    expect(result.opportunities).toHaveLength(1);
    const card = result.opportunities![0];

    // The card's userId should be the candidate (Bob), NOT the intro target (Alice)
    expect(card.userId).toBe(candidateId);
    expect(card.name).toBe("Bob Candidate");

    // secondParty should contain the intro target's data
    expect(card.secondParty).toBeDefined();
    expect(card.secondParty!.name).toBe("Alice Target");
    expect(card.secondParty!.userId).toBe(targetId);
  });

  test("non-introducer cards do NOT include secondParty", async () => {
    const mockGraph = {
      invoke: async () => ({
        opportunities: [
          {
            id: "opp-standard",
            actors: [
              { indexId: "idx-1", userId: "u1", role: "patient" },
              { indexId: "idx-1", userId: candidateId, role: "agent" },
            ],
            interpretation: {
              reasoning: "Good match.",
              confidence: 0.85,
            },
            detection: { source: "opportunity_graph", createdBy: "agent", timestamp: new Date().toISOString() },
            status: "latent",
          },
        ],
      }),
    };

    const result = await runDiscoverFromQuery({
      opportunityGraph: mockGraph as any,
      database: {
        ...dbWithProfiles,
        getUser: async (userId: string) => {
          if (userId === candidateId)
            return { name: "Bob Candidate", avatar: null };
          if (userId === "u1")
            return { name: "User One", avatar: null };
          return null;
        },
      } as unknown as ChatGraphCompositeDatabase,
      userId: "u1",
      query: "find connections",
      indexScope: ["idx1"],
      minimalForChat: true,
    });

    expect(result.found).toBe(true);
    const card = result.opportunities![0];
    expect(card.secondParty).toBeUndefined();
  });
});
