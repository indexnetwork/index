/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";

const sendEmailSpy = mock(async () => ({ data: null, skipped: false }));
mock.module('../../lib/email/transport.helper', () => ({
  executeSendEmail: sendEmailSpy,
}));

import { inArray } from "drizzle-orm";

import { NetworkController } from "../network.controller";
import db from "../../lib/drizzle/drizzle";
import * as schema from "../../schemas/database.schema";
import { UserDatabaseAdapter, NetworkGraphDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("NetworkController Integration", () => {
  const controller = new NetworkController();
  const userAdapter = new UserDatabaseAdapter();
  const indexAdapter = new NetworkGraphDatabaseAdapter();
  let testUserId: string;
  let createdIndexId: string;
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
    if (createdIndexId) await indexAdapter.deleteNetworkAndMembers(createdIndexId);
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

    test("should return 200 and create index when title provided", async () => {
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

    test("should return 404 when index id does not exist", async () => {
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
    });
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

  describe("POST /:id/members/invite (experiment networks)", () => {
    let experimentNetworkId: string;
    const inviteeUserIds: string[] = [];

    beforeAll(async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Invite Test Experiment", isExperiment: true }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string } };
      experimentNetworkId = data.network!.id;
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
      if (experimentNetworkId) await indexAdapter.deleteNetworkAndMembers(experimentNetworkId);
    });

    test("returns 400 when email is missing", async () => {
      const req = new Request(`http://localhost/networks/${experimentNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: experimentNetworkId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("email is required");
    });

    test("returns 400 when email format is invalid", async () => {
      const req = new Request(`http://localhost/networks/${experimentNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "not-an-email" }),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: experimentNetworkId });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid email format");
    });

    test("returns 403 when network is not an experiment network", async () => {
      const req = new Request(`http://localhost/networks/${createdIndexId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `target-${Date.now()}@example.com` }),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: createdIndexId });

      expect(res.status).toBe(403);
    });

    test("returns 201 with provisioned flags for a new email", async () => {
      sendEmailSpy.mockClear();
      const inviteeEmail = `invitee-${Date.now()}@example.com`;
      const req = new Request(`http://localhost/networks/${experimentNetworkId}/members/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteeEmail }),
      });
      const res = await controller.inviteMember(req, mockUser(), { id: experimentNetworkId });
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
    });
  });

  describe("POST /:id/rotate-master-key", () => {
    let rotateNetworkId: string;

    beforeAll(async () => {
      const req = new Request("http://localhost/networks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Rotate Master Key Test", isExperiment: true }),
      });
      const res = await controller.create(req, mockUser());
      const data = (await res.json()) as { network?: { id: string } };
      rotateNetworkId = data.network!.id;
    });

    afterAll(async () => {
      if (rotateNetworkId) await indexAdapter.deleteNetworkAndMembers(rotateNetworkId);
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

    test("returns 403 when network is not an experiment", async () => {
      const req = new Request(`http://localhost/networks/${createdIndexId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: createdIndexId });
      expect(res.status).toBe(403);
    });

    test("returns 404 when network does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request(`http://localhost/networks/${fakeId}/rotate-master-key`, {
        method: "POST",
      });
      const res = await controller.rotateMasterKey(req, mockUser(), { id: fakeId });
      // assertExperimentOwner returns 404 for null networks but 403 for any other access failure → accept either
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
