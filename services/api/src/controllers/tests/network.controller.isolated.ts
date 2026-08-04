/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";

const sendEmailSpy = mock(async () => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendEmailSpy,
}));

import { eq, inArray } from "drizzle-orm/sql";

// ---------------------------------------------------------------------------
// Restore mocks after all tests
// ---------------------------------------------------------------------------
afterAll(() => {
  mock.restore();
});

import { NetworkController } from "../network.controller";
import db from "../../lib/drizzle/drizzle";
import * as schema from "../../schemas/database.schema";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { deleteNetworkAndMembers } from "./test-helpers";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("NetworkController Integration", () => {
  const controller = new NetworkController();
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  let createdIndexId: string;
  const additionalNetworkIds: string[] = [];
  const testEmail = `test-index-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Index User",
      intro: "Test",
      location: "City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    for (const id of additionalNetworkIds) await deleteNetworkAndMembers(id);
    if (createdIndexId) await deleteNetworkAndMembers(createdIndexId);
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Index User",
  });

  describe("GET '' (list)", () => {
    test("should return 200 with indexes array", async () => {
      const req = new Request("http://localhost/networks");
      const res = await controller.list(req, mockUser());
      const data = (await res.json()) as { networks?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.networks)).toBe(true);
    });
  });

  describe("POST '' (create)", () => {
    test("should return 400 when title is missing", async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("title is required");
    });

    test("should return 200 and create network when title provided", async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Test Index", prompt: "A test index" }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string; title: string } };

      expect(res.status).toBe(200);
      expect(data.network).toBeDefined();
      expect(data.network!.title).toBe("Test Index");
      createdIndexId = data.network!.id;
    });

    test("should return 200 and pass through metadata on create", async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Test Event",
          metadata: {
            startDate: "2026-06-01T00:00:00Z",
            endDate: "2026-06-30T23:59:59Z",
            timezone: "America/Los_Angeles",
            location: "San Francisco",
          },
        }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string; metadata: Record<string, unknown> } };

      expect(res.status).toBe(200);
      expect(data.network).toBeDefined();
      expect(data.network!.metadata.startDate).toBe("2026-06-01T00:00:00Z");
      additionalNetworkIds.push(data.network!.id);
    });
  });

  describe("GET /:id", () => {
    test("should return 200 and index when member", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId);
      const res = await controller.get(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { network?: { id: string; title: string } };

      expect(res.status).toBe(200);
      expect(data.network).toBeDefined();
      expect(data.network!.id).toBe(createdIndexId);
      expect(data.network!.title).toBe("Test Index");
    });

    test("should return 404 when network id does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request("http://localhost/networks/" + fakeId);
      const res = await controller.get(req, mockUser(), { id: fakeId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Network not found");
    });
  });

  describe("GET /search-users", () => {
    test("should return 200 with users array", async () => {
      const req = new Request("http://localhost/networks/search-users?q=test");
      const res = await controller.searchPersonalNetworkMembers(req, mockUser());
      const data = (await res.json()) as { users?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.users)).toBe(true);
    });
  });

  describe("GET /discovery/public", () => {
    test("should return 200 with indexes array", async () => {
      const req = new Request("http://localhost/networks/discovery/public");
      const res = await controller.getPublicNetworks(req, mockUser());
      const data = (await res.json()) as { networks?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.networks)).toBe(true);
    });
  });

  describe("PUT /:id", () => {
    test("should return 200 and updated index when owner", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Updated Test Index" }),
      });
      const res = await controller.update(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { network?: { title: string } };

      expect(res.status).toBe(200);
      expect(data.network).toBeDefined();
      expect(data.network!.title).toBe("Updated Test Index");
    }, 30_000);

    test("should return 200 when updating with valid contextInjection", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextInjection: { discovery: false } }),
      });
      const res = await controller.update(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { network?: { permissions: { contextInjection?: { discovery: boolean } } } };

      expect(res.status).toBe(200);
      expect(data.network!.permissions.contextInjection?.discovery).toBe(false);
    });

    test("should persist hidden when updating with { hidden: true }", async () => {
      const put = async (hidden: boolean) => controller.update(
        new Request("http://localhost/networks/" + createdIndexId, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hidden }),
        }),
        mockUser(),
        { id: createdIndexId },
      );
      const getHidden = async () => {
        const res = await controller.get(new Request("http://localhost/networks/" + createdIndexId), mockUser(), { id: createdIndexId });
        const data = (await res.json()) as { network?: { hidden: boolean } };
        return data.network!.hidden;
      };

      const res = await put(true);
      expect(res.status).toBe(200);
      expect(await getHidden()).toBe(true);

      const restore = await put(false);
      expect(restore.status).toBe(200);
      expect(await getHidden()).toBe(false);
    }, 30_000);
  });

  describe("GET /:id/members", () => {
    test("should return 200 with members array when owner", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId + "/members");
      const res = await controller.getMembers(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { members?: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.members)).toBe(true);
    });
  });

  describe("GET /:id/member-settings", () => {
    test("should return 200 with settings when member", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId + "/member-settings");
      const res = await controller.getMemberSettings(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as Record<string, unknown>;

      expect(res.status).toBe(200);
      expect(data).toBeDefined();
    });
  });

  describe("POST /:id/members/invite (owner-only, any network)", () => {
    let inviteNetworkId: string;
    let otherUserId: string;
    const inviteeUserIds: string[] = [];

    beforeAll(async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Invite Test Network" }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string } };
      inviteNetworkId = data.network!.id;

      const other = await userAdapter.create({
        email: `test-invite-outsider-${Date.now()}@example.com`,
        name: "Invite Outsider",
      });
      otherUserId = other.id;
    });

    afterAll(async () => {
      if (inviteeUserIds.length > 0) {
        // FK chain: agent_permissions.user_id and apikey.user_id cascade on user
        // delete; networkMembers and personalNetworks do NOT, so clean those
        // explicitly before dropping the users.
        const personalRows = await db
          .select({ networkId: schema.personalNetworks.networkId })
          .from(schema.personalNetworks)
          .where(inArray(schema.personalNetworks.userId, inviteeUserIds));
        const personalNetworkIds = personalRows.map((r) => r.networkId);

        await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.userId, inviteeUserIds));
        await db.delete(schema.personalNetworks).where(inArray(schema.personalNetworks.userId, inviteeUserIds));
        await db.delete(schema.users).where(inArray(schema.users.id, inviteeUserIds));
        if (personalNetworkIds.length > 0) {
          await db.delete(schema.networks).where(inArray(schema.networks.id, personalNetworkIds));
        }
      }
      if (inviteNetworkId) await deleteNetworkAndMembers(inviteNetworkId);
      if (otherUserId) await userAdapter.deleteById(otherUserId);
    });

    test("returns 400 when email is missing", async () => {
      const req = new Request(`http://localhost/networks/${inviteNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: inviteNetworkId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("email is required");
    });

    test("returns 400 when email format is invalid", async () => {
      const req = new Request(`http://localhost/networks/${inviteNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: inviteNetworkId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid email format");
    });

    test("returns 403 when the caller is not the network owner", async () => {
      const req = new Request(`http://localhost/networks/${inviteNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `target-${Date.now()}@example.com` }),
      });
      const outsider: AuthenticatedUser = {
        id: otherUserId,
        email: `test-invite-outsider-${Date.now()}@example.com`,
        name: "Invite Outsider",
      };
      const res = await controller.inviteMember(req, outsider, { id: inviteNetworkId });

      expect(res.status).toBe(403);
    });

    test("returns 201 with provisioned flags for a new email", async () => {
      sendEmailSpy.mockClear();
      const inviteeEmail = `invitee-${Date.now()}@example.com`;
      const req = new Request(`http://localhost/networks/${inviteNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteeEmail }),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: inviteNetworkId });
      const data = (await res.json()) as {
        user?: { id: string; email: string };
        created?: boolean;
        alreadyMember?: boolean;
        agentProvisioned?: boolean;
      };

      expect(res.status).toBe(201);
      expect(data.created).toBe(true);
      expect(data.alreadyMember).toBe(false);
      expect(data.agentProvisioned).toBe(true);
      expect(data.user?.email).toBe(inviteeEmail);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      if (data.user?.id) inviteeUserIds.push(data.user.id);
    }, 45_000);
  });

  describe("POST /:id/master-key (enable)", () => {
    let enableNetworkId: string;

    beforeAll(async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Enable Master Key Test" }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string } };
      enableNetworkId = data.network!.id;
    });

    afterAll(async () => {
      if (enableNetworkId) await deleteNetworkAndMembers(enableNetworkId);
    });

    test("returns 201 with a plaintext masterKey for the owner", async () => {
      const req = new Request(`http://localhost/networks/${enableNetworkId}/master-key`, {
        method: "POST",
      });
      const res = await controller.enableMasterKey(req, mockUser(), { id: enableNetworkId });
      const data = (await res.json()) as { masterKey?: string };

      expect(res.status).toBe(201);
      expect(data.masterKey).toBeTruthy();
      expect(data.masterKey!.length).toBe(64);
    });

    test("forces joinPolicy invite_only while preserving invitationLink", async () => {
      // Seed non-consent-safe permissions with an invitation link to preserve.
      await db.update(schema.networks)
        .set({
          permissions: {
            joinPolicy: 'anyone',
            invitationLink: { code: 'preserve-me' },
            allowGuestVibeCheck: true,
            profileEnrichment: 'auto',
          },
        })
        .where(eq(schema.networks.id, enableNetworkId));

      const req = new Request(`http://localhost/networks/${enableNetworkId}/master-key`, {
        method: "POST",
      });
      const res = await controller.enableMasterKey(req, mockUser(), { id: enableNetworkId });
      expect(res.status).toBe(201);

      const [net] = await db
        .select({ permissions: schema.networks.permissions })
        .from(schema.networks)
        .where(eq(schema.networks.id, enableNetworkId));
      expect(net.permissions.joinPolicy).toBe('invite_only');
      expect(net.permissions.allowGuestVibeCheck).toBe(false);
      expect(net.permissions.profileEnrichment).toBe('consent_required');
      expect(net.permissions.invitationLink).toEqual({ code: 'preserve-me' });
    });

    test("returns 403 or 404 when network does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request(`http://localhost/networks/${fakeId}/master-key`, {
        method: "POST",
      });
      const res = await controller.enableMasterKey(req, mockUser(), { id: fakeId });
      // assertOwner returns 404 for null networks but 403 for any other access failure → accept either
      expect([403, 404]).toContain(res.status);
    });
  });

  describe("POST /:id/rotate-master-key", () => {
    let rotateNetworkId: string;

    beforeAll(async () => {
      const createReq = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Rotate Master Key Test" }),
      });
      const createRes = await controller.create(createReq, mockUser());
      const createData = (await createRes.json()) as { network?: { id: string } };
      rotateNetworkId = createData.network!.id;

      // Rotation requires an existing master key — enable it first.
      const enableReq = new Request(`http://localhost/networks/${rotateNetworkId}/master-key`, {
        method: "POST",
      });
      const enableRes = await controller.enableMasterKey(enableReq, mockUser(), { id: rotateNetworkId });
      expect(enableRes.status).toBe(201);
    });

    afterAll(async () => {
      if (rotateNetworkId) await deleteNetworkAndMembers(rotateNetworkId);
    });

    test("returns 200 with a fresh masterKey for the owner", async () => {
      const req = new Request(`http://localhost/networks/${rotateNetworkId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: rotateNetworkId });
      const data = (await res.json()) as { masterKey?: string };

      expect(res.status).toBe(200);
      expect(data.masterKey).toBeTruthy();
      expect(data.masterKey!.length).toBe(64);
    });

    test("throws when the network has no master key", async () => {
      const req = new Request(`http://localhost/networks/${createdIndexId}/rotate-master-key`, {
        method: "POST",
      });
      await expect(controller.rotateMasterKey(req, mockUser(), { id: createdIndexId }))
        .rejects.toThrow("Network has no master key");
    });

    test("returns 404 when network does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request(`http://localhost/networks/${fakeId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: fakeId });
      // assertOwner returns 404 for null networks but 403 for any other access failure → accept either
      expect([403, 404]).toContain(res.status);
    });
  });

  describe("DELETE /:id", () => {
    test("should return 200 and success when owner", async () => {
      const req = new Request("http://localhost/networks/" + createdIndexId, { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: createdIndexId });
      const data = (await res.json()) as { success?: boolean };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      // Keep createdIndexId so afterAll can run deleteNetworkAndMembers (drops index_members), then deleteById(user) won't hit FK
    });
  });
});
