import { describe, expect, test } from "bun:test";

import { NetworkGraphFactory } from "../network.graph.js";

describe("NetworkGraphFactory MCP Batch 1 read serialization", () => {
  test("scoped read includes the personal index alongside the bound network", async () => {
    // Scenario: a network-scoped agent (or a user-driven community-scoped chat)
    // calls read_networks with state.networkId set to the bound community.
    // The response must include BOTH that community AND the user's personal
    // index — the personal index is reachable in every allowed-network scope
    // so add_contact / list_contacts work, and dropping
    // it from the read_networks payload made those tools undiscoverable.
    const personalNetworkId = "11111111-1111-4111-8111-111111111111";
    const boundNetworkId = "22222222-2222-4222-8222-222222222222";

    const graph = new NetworkGraphFactory({
      getNetworkMemberships: async () => [
        {
          networkId: personalNetworkId,
          networkTitle: "My Network",
          indexPrompt: "Personal index",
          permissions: ["owner"],
          memberPrompt: null,
          autoAssign: true,
          isPersonal: true,
          joinedAt: new Date("2026-04-20T00:00:00Z"),
        },
        {
          networkId: boundNetworkId,
          networkTitle: "Experia",
          indexPrompt: "Experimental network",
          permissions: ["member"],
          memberPrompt: null,
          autoAssign: true,
          isPersonal: false,
          joinedAt: new Date("2026-04-21T00:00:00Z"),
        },
        {
          networkId: "33333333-3333-4333-8333-333333333333",
          networkTitle: "Out of scope",
          indexPrompt: "Should not surface",
          permissions: ["member"],
          memberPrompt: null,
          autoAssign: true,
          isPersonal: false,
          joinedAt: new Date("2026-04-22T00:00:00Z"),
        },
      ],
      getOwnedIndexes: async () => [
        {
          id: personalNetworkId,
          title: "My Network",
          prompt: "Personal index",
          memberCount: 0,
          intentCount: 2,
          permissions: { joinPolicy: "invite_only" },
        },
      ],
      getPublicIndexesNotJoined: async () => ({ networks: [] }),
      isNetworkMember: async () => true,
    } as any).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      networkId: boundNetworkId,
      operationMode: "read",
    });

    const memberOfIds = result.readResult.memberOf.map((m: { networkId: string }) => m.networkId);
    expect(memberOfIds).toEqual([boundNetworkId, personalNetworkId]);
    expect(result.readResult.memberOf.find((m: { isPersonal: boolean }) => m.isPersonal)).toBeDefined();
    expect(result.readResult.publicNetworks).toBeUndefined();
    expect(result.readResult.owns).toHaveLength(1);
    expect(result.readResult.owns[0].networkId).toBe(personalNetworkId);
    expect(result.readResult.stats.memberOfCount).toBe(2);
    expect(result.readResult.stats.scopeNote).toContain("personal");
  });

  test("scoped read does not duplicate the personal index when the bound network IS personal", async () => {
    const personalNetworkId = "11111111-1111-4111-8111-111111111111";

    const graph = new NetworkGraphFactory({
      getNetworkMemberships: async () => [
        {
          networkId: personalNetworkId,
          networkTitle: "My Network",
          indexPrompt: null,
          permissions: ["owner"],
          memberPrompt: null,
          autoAssign: true,
          isPersonal: true,
          joinedAt: new Date("2026-04-20T00:00:00Z"),
        },
      ],
      getOwnedIndexes: async () => [],
      getPublicIndexesNotJoined: async () => ({ networks: [] }),
      isNetworkMember: async () => true,
    } as any).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      networkId: personalNetworkId,
      operationMode: "read",
    });

    expect(result.readResult.memberOf).toHaveLength(1);
    expect(result.readResult.memberOf[0].networkId).toBe(personalNetworkId);
  });

  test("returns memberOf.isPersonal and publicNetworks for unscoped reads", async () => {
    const graph = new NetworkGraphFactory({
      getNetworkMemberships: async () => [{
        networkId: "11111111-1111-4111-8111-111111111111",
        networkTitle: "Personal Index",
        indexPrompt: "Private network",
        permissions: ["owner"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: true,
        joinedAt: new Date("2026-04-20T00:00:00Z"),
      }],
      getOwnedIndexes: async () => [],
      getPublicIndexesNotJoined: async () => ({
        networks: [{
          id: "22222222-2222-4222-8222-222222222222",
          title: "Open Builders",
          prompt: "Public builders network",
          memberCount: 7,
          owner: { name: "Nina", avatar: null },
        }],
      }),
      isNetworkMember: async () => true,
    } as any).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      operationMode: "read",
    });

    expect(result.readResult.memberOf[0].isPersonal).toBe(true);
    expect(result.readResult.publicNetworks).toHaveLength(1);
    expect(result.readResult.publicNetworks[0].networkId).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.readResult.publicIndexes).toBeUndefined();
    expect(result.readResult.stats.publicNetworksCount).toBe(1);
  });
});
