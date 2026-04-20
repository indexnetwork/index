import { describe, expect, test } from "bun:test";

import { NetworkGraphFactory } from "../network.graph.js";

describe("NetworkGraphFactory MCP Batch 1 read serialization", () => {
  test("returns memberOf.isPersonal and publicNetworks for unscoped reads", async () => {
    const graph = new NetworkGraphFactory({
      getNetworkMemberships: async () => [{
        networkId: "11111111-1111-4111-8111-111111111111",
        networkTitle: "Personal Index",
        networkPrompt: "Private network",
        permissions: ["owner"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: true,
        joinedAt: new Date("2026-04-20T00:00:00Z"),
      }],
      getOwnedNetworks: async () => [],
      getPublicNetworksNotJoined: async () => ({
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
