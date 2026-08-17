/**
 * Characterization: membership authority policy.
 *
 * Verifies the membership authority rules enforced by NetworkMembershipGraphFactory:
 * - Self-join is gated on joinPolicy ('anyone' vs 'invite_only').
 * - Inviting others requires membership; invite_only also requires ownership.
 * - Removing members is owner-only; the owner themselves cannot be removed.
 * - Listing members requires the caller to be a member.
 *
 * IND-546: policy characterization spec for communities domain-first module.
 */
import { describe, expect, it } from "bun:test";

import { NetworkMembershipGraphFactory } from "../membership.graph.js";
import type { NetworkMembershipGraphDatabase } from "../../shared/interfaces/database.interface.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

type DbOverrides = Partial<NetworkMembershipGraphDatabase>;

function makeDb(overrides: DbOverrides = {}): NetworkMembershipGraphDatabase {
  return {
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getNetworkWithPermissions: async () => ({
      id: "net-1",
      title: "Test Network",
      permissions: { joinPolicy: "invite_only" as const },
    }),
    addMemberToNetwork: async () => ({ success: true, alreadyMember: false }),
    removeMemberFromIndex: async () => ({ success: true, wasOwner: false, notMember: false }),
    getNetworkMembersForMember: async () => [],
    ...overrides,
  } as unknown as NetworkMembershipGraphDatabase;
}

function makeGraph(overrides: DbOverrides = {}) {
  return new NetworkMembershipGraphFactory(makeDb(overrides)).createGraph();
}

const NET = "11111111-1111-4111-8111-111111111111";

// ── Self-join authority ────────────────────────────────────────────────────────

describe("membership authority: self-join", () => {
  it("allows self-join when joinPolicy is 'anyone'", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Open Network",
        permissions: { joinPolicy: "anyone" as const },
      }),
      addMemberToNetwork: async () => ({ success: true, alreadyMember: false }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: NET,
      targetUserId: "user-1",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.message).toContain("joined");
  });

  it("rejects self-join when joinPolicy is 'invite_only'", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Private Network",
        permissions: { joinPolicy: "invite_only" as const },
      }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: NET,
      targetUserId: "user-1",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("invite-only");
  });

  it("returns success idempotently when already a member", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Open Network",
        permissions: { joinPolicy: "anyone" as const },
      }),
      addMemberToNetwork: async () => ({ success: true, alreadyMember: true }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: NET,
      targetUserId: "user-1",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.message).toContain("already");
  });
});

// ── Invite-others authority ────────────────────────────────────────────────────

describe("membership authority: inviting others", () => {
  it("allows any member to invite when joinPolicy is 'anyone'", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Open Network",
        permissions: { joinPolicy: "anyone" as const },
      }),
      isNetworkMember: async () => true,
      isIndexOwner: async () => false,
      addMemberToNetwork: async () => ({ success: true, alreadyMember: false }),
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: NET,
      targetUserId: "user-2",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
  });

  it("allows owner to invite in 'invite_only' network", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Private Network",
        permissions: { joinPolicy: "invite_only" as const },
      }),
      isNetworkMember: async () => true,
      isIndexOwner: async () => true,
      addMemberToNetwork: async () => ({ success: true, alreadyMember: false }),
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: NET,
      targetUserId: "user-2",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
  });

  it("rejects non-owner member inviting in 'invite_only' network", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Private Network",
        permissions: { joinPolicy: "invite_only" as const },
      }),
      isNetworkMember: async () => true,
      isIndexOwner: async () => false,
    });
    const result = await graph.invoke({
      userId: "member-1",
      networkId: NET,
      targetUserId: "user-2",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("owner");
  });

  it("rejects non-member from inviting others", async () => {
    const graph = makeGraph({
      getNetworkWithPermissions: async () => ({
        id: NET,
        title: "Open Network",
        permissions: { joinPolicy: "anyone" as const },
      }),
      isNetworkMember: async () => false,
    });
    const result = await graph.invoke({
      userId: "outsider-1",
      networkId: NET,
      targetUserId: "user-2",
      operationMode: "create" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("member");
  });
});

// ── Remove-member authority ────────────────────────────────────────────────────

describe("membership authority: removing members", () => {
  it("allows owner to remove a regular member", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => true,
      removeMemberFromIndex: async () => ({ success: true, wasOwner: false, notMember: false }),
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: NET,
      targetUserId: "member-2",
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(true);
  });

  it("rejects non-owner from removing members", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => false,
    });
    const result = await graph.invoke({
      userId: "member-1",
      networkId: NET,
      targetUserId: "member-2",
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("owner");
  });

  it("prevents removing the owner from their own network", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => true,
      removeMemberFromIndex: async () => ({ success: false, wasOwner: true, notMember: false }),
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: NET,
      targetUserId: "owner-1",  // owner trying to remove themselves via wrong path
      operationMode: "delete" as const,
    });
    // Self-removal is caught by the graph before hitting the DB
    expect(result.mutationResult?.success).toBe(false);
  });

  it("rejects attempting to remove yourself via this flow", async () => {
    const graph = makeGraph({ isIndexOwner: async () => true });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: NET,
      targetUserId: "owner-1",
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("cannot remove yourself");
  });

  it("reports not-a-member when target is not in the network", async () => {
    const graph = makeGraph({
      isIndexOwner: async () => true,
      removeMemberFromIndex: async () => ({ success: false, wasOwner: false, notMember: true }),
    });
    const result = await graph.invoke({
      userId: "owner-1",
      networkId: NET,
      targetUserId: "unknown-user",
      operationMode: "delete" as const,
    });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("not a member");
  });
});

// ── List-members access control ────────────────────────────────────────────────

describe("membership authority: listing members", () => {
  it("allows a member to list network members", async () => {
    const graph = makeGraph({
      isNetworkMember: async () => true,
      getNetworkMembersForMember: async () => [
        { userId: "user-1", name: "Alice", avatar: null, permissions: ["member"], intentCount: 2, joinedAt: new Date() },
      ],
    });
    const result = await graph.invoke({
      userId: "user-1",
      networkId: NET,
      operationMode: "read" as const,
    });
    expect(result.readResult?.count).toBe(1);
    expect(result.readResult?.members[0].name).toBe("Alice");
  });

  it("denies a non-member from listing members", async () => {
    const graph = makeGraph({
      isNetworkMember: async () => false,
    });
    const result = await graph.invoke({
      userId: "outsider-1",
      networkId: NET,
      operationMode: "read" as const,
    });
    expect(result.readResult?.count).toBe(0);
    expect(result.error).toContain("not a member");
  });
});
