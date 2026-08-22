/**
 * Characterization: privacy/scope intersection policy.
 *
 * Verifies the effective-scope rules enforced by NetworkGraphFactory (read mode):
 * - In a network-scoped chat, only the focused network + personal network are shown.
 * - Non-members receive an empty result when queried in scope.
 * - showAll: true bypasses the scope restriction (full membership list).
 * - Unscoped read returns all memberships, owned networks, and public networks.
 *
 * IND-546: policy characterization spec for communities domain-first module.
 */
import { describe, expect, it } from "bun:test";

import { NetworkGraphFactory } from "../network.graph.js";
import type { NetworkGraphDatabase } from "../../../platform/database.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCOPED_NET = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PERSONAL_NET = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const OTHER_NET = "cccccccc-cccc-4ccc-cccc-cccccccccccc";

const ALL_MEMBERSHIPS = [
  { networkId: SCOPED_NET, networkTitle: "Scoped Net", indexPrompt: "AI", autoAssign: true, isPersonal: false, joinedAt: new Date() },
  { networkId: PERSONAL_NET, networkTitle: "My Contacts", indexPrompt: null, autoAssign: false, isPersonal: true, joinedAt: new Date() },
  { networkId: OTHER_NET, networkTitle: "Other Net", indexPrompt: null, autoAssign: false, isPersonal: false, joinedAt: new Date() },
];

function makeDb(overrides: Partial<NetworkGraphDatabase> = {}): NetworkGraphDatabase {
  return {
    getNetworkMemberships: async () => ALL_MEMBERSHIPS,
    getOwnedIndexes: async () => [],
    getPublicIndexesNotJoined: async () => ({ networks: [] }),
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getNetwork: async () => null,
    createNetwork: async () => ({ id: "new-net", title: "New" }),
    addMemberToNetwork: async () => ({ success: true, alreadyMember: false }),
    updateIndexSettings: async () => {},
    softDeleteNetwork: async () => {},
    getNetworkMemberCount: async () => 1,
    ...overrides,
  } as unknown as NetworkGraphDatabase;
}

function makeGraph(overrides: Partial<NetworkGraphDatabase> = {}) {
  return new NetworkGraphFactory(makeDb(overrides)).createGraph();
}

// ── Scoped chat effective-scope intersection ───────────────────────────────────

describe("scope policy: network-scoped read", () => {
  it("returns only the scoped network and personal network when networkId is set", async () => {
    const graph = makeGraph();
    const result = await graph.invoke({
      userId: "user-1",
      networkId: SCOPED_NET,
      operationMode: "read" as const,
      showAll: false,
    });
    expect(result.readResult).toBeDefined();
    const memberOfIds = result.readResult!.memberOf.map((m) => m.networkId);
    expect(memberOfIds).toContain(SCOPED_NET);
    expect(memberOfIds).toContain(PERSONAL_NET);
    // other memberships must be excluded by scope intersection
    expect(memberOfIds).not.toContain(OTHER_NET);
    // publicNetworks is omitted in scoped mode
    expect(result.readResult!.publicNetworks).toBeUndefined();
  });

  it("returns empty membership when the user is not a member of the scoped network", async () => {
    const graph = makeGraph({
      isNetworkMember: async () => false,
    });
    const result = await graph.invoke({
      userId: "outsider-1",
      networkId: SCOPED_NET,
      operationMode: "read" as const,
      showAll: false,
    });
    expect(result.readResult?.memberOf).toHaveLength(0);
    expect(result.readResult?.stats.scopeNote).toContain("not a member");
  });

  it("includes a scopeNote in the stats when network-scoped", async () => {
    const graph = makeGraph();
    const result = await graph.invoke({
      userId: "user-1",
      networkId: SCOPED_NET,
      operationMode: "read" as const,
      showAll: false,
    });
    expect(result.readResult?.stats.scopeNote).toContain("showAll");
  });

  it("returns only the scoped network when it is also the personal network", async () => {
    const personalOnlyMemberships = [
      { networkId: SCOPED_NET, networkTitle: "Personal Net", indexPrompt: null, autoAssign: false, isPersonal: true, joinedAt: new Date() },
    ];
    const graph = makeGraph({
      getNetworkMemberships: async () => personalOnlyMemberships,
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: SCOPED_NET,
      operationMode: "read" as const,
      showAll: false,
    });
    const memberOfIds = result.readResult!.memberOf.map((m) => m.networkId);
    expect(memberOfIds).toHaveLength(1);
    expect(memberOfIds[0]).toBe(SCOPED_NET);
  });
});

// ── showAll bypass ────────────────────────────────────────────────────────────

describe("scope policy: showAll bypass", () => {
  it("returns all memberships when showAll is true even with a networkId set", async () => {
    const graph = makeGraph();
    const result = await graph.invoke({
      userId: "user-1",
      networkId: SCOPED_NET,
      operationMode: "read" as const,
      showAll: true,
    });
    const memberOfIds = result.readResult!.memberOf.map((m) => m.networkId);
    expect(memberOfIds).toContain(SCOPED_NET);
    expect(memberOfIds).toContain(OTHER_NET);
    expect(memberOfIds).toContain(PERSONAL_NET);
  });
});

// ── Unscoped read ─────────────────────────────────────────────────────────────

describe("scope policy: unscoped read", () => {
  it("returns all memberships, owned networks, and public networks when unscoped", async () => {
    const graph = makeGraph({
      getPublicIndexesNotJoined: async () => ({
        networks: [
          { id: "pub-net", title: "Public Network", prompt: "Open to all", memberCount: 10, owner: null },
        ],
      }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: undefined,
      operationMode: "read" as const,
    });
    expect(result.readResult?.memberOf).toHaveLength(3);
    expect(result.readResult?.publicNetworks).toHaveLength(1);
    expect(result.readResult?.publicNetworks?.[0].networkId).toBe("pub-net");
  });

  it("includes publicNetworksCount in stats when unscoped", async () => {
    const graph = makeGraph({
      getPublicIndexesNotJoined: async () => ({
        networks: [
          { id: "pub-net", title: "Public", prompt: null, memberCount: 3, owner: null },
        ],
      }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      operationMode: "read" as const,
    });
    expect(result.readResult?.stats.publicNetworksCount).toBe(1);
  });
});

// ── Network lifecycle ownership ───────────────────────────────────────────────

describe("scope policy: network lifecycle ownership", () => {
  it("blocks non-owner from updating network settings", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => false,
    });
    const result = await graph.invoke({
      userId: "member-1",
      networkId: SCOPED_NET,
      operationMode: "update" as const,
      updateInput: { title: "New Title" },
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("own");
  });

  it("blocks deletion when network has other members", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => true,
      getNetworkMemberCount: async () => 3,
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: SCOPED_NET,
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("other members");
  });

  it("allows owner to delete when sole member", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => true,
      getNetworkMemberCount: async () => 1,
      softDeleteNetwork: async () => {},
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: SCOPED_NET,
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
  });
});
