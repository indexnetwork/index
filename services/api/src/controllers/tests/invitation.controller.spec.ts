/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { NetworkController } from "../network.controller";
import { UserDatabaseAdapter, NetworkGraphDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("Invitation Endpoints Integration", () => {
  const controller = new NetworkController();
  const userAdapter = new UserDatabaseAdapter();
  const indexAdapter = new NetworkGraphDatabaseAdapter();

  let ownerUserId: string;
  let joinerUserId: string;
  let createdIndexId: string;
  let invitationCode: string;

  const ownerEmail = `test-invite-owner-${Date.now()}@example.com`;
  const joinerEmail = `test-invite-joiner-${Date.now()}@example.com`;

  beforeAll(async () => {
    // Clean up any existing test users
    for (const email of [ownerEmail, joinerEmail]) {
      const existing = await userAdapter.findByEmail(email);
      if (existing) await userAdapter.deleteByEmail(email);
    }

    // Create owner user
    const owner = await userAdapter.create({
      email: ownerEmail,
      name: "Invite Owner",
      intro: "Test",
      location: "City",
    });
    ownerUserId = owner.id;

    // Create joiner user
    const joiner = await userAdapter.create({
      email: joinerEmail,
      name: "Invite Joiner",
      intro: "Test",
      location: "City",
    });
    joinerUserId = joiner.id;

    // Create an invite_only index as owner
    const createReq = new Request("http://localhost/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Invite Test Index", prompt: "Testing invitations", joinPolicy: "invite_only" }),
    });
    const createRes = await controller.create(createReq, mockOwner());
    expect(createRes.status).toBe(200);
    const createData = (await createRes.json()) as { network?: { id: string; permissions?: Record<string, unknown> } };
    expect(createData.network).not.toBeNull();
    expect(createData.network!.id).toBeTruthy();
    createdIndexId = createData.network!.id;

    // Update permissions to generate invitation link code
    const updateReq = new Request("http://localhost/networks/" + createdIndexId + "/permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ joinPolicy: "invite_only" }),
    });
    const updateRes = await controller.updatePermissions(updateReq, mockOwner(), { id: createdIndexId });
    expect(updateRes.status).toBe(200);
    const updateData = (await updateRes.json()) as { network?: { permissions?: { invitationLink?: { code: string } } } };
    expect(updateData.network?.permissions?.invitationLink?.code).toBeTruthy();
    invitationCode = updateData.network!.permissions!.invitationLink!.code;
  });

  afterAll(async () => {
    if (createdIndexId) await indexAdapter.deleteNetworkAndMembers(createdIndexId);
    if (ownerUserId) await userAdapter.deleteById(ownerUserId);
    if (joinerUserId) await userAdapter.deleteById(joinerUserId);
  });

  const mockOwner = (): AuthenticatedUser => ({
    id: ownerUserId,
    email: ownerEmail,
    name: "Invite Owner",
  });

  const mockJoiner = (): AuthenticatedUser => ({
    id: joinerUserId,
    email: joinerEmail,
    name: "Invite Joiner",
  });

  describe("GET /share/:code", () => {
    test("should return 200 with index data for valid invitation code", async () => {
      const req = new Request("http://localhost/networks/share/" + invitationCode);
      const res = await controller.getNetworkByShareCode(req, null, { code: invitationCode });
      const data = (await res.json()) as { network?: { id: string; title: string } };

      expect(res.status).toBe(200);
      expect(data.network).not.toBeNull();
      expect(data.network!.id).toBe(createdIndexId);
      expect(data.network!.title).toBe("Invite Test Index");
    });

    test("should return 404 for invalid invitation code", async () => {
      const req = new Request("http://localhost/networks/share/nonexistent-code");
      const res = await controller.getNetworkByShareCode(req, null, { code: "nonexistent-code" });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Invalid or expired invitation link");
    });

    test("should not expose internal permissions in public response", async () => {
      const req = new Request("http://localhost/networks/share/" + invitationCode);
      const res = await controller.getNetworkByShareCode(req, null, { code: invitationCode });
      const data = (await res.json()) as { network?: Record<string, unknown> };

      expect(res.status).toBe(200);
      expect(data.network!.permissions).toBeUndefined();
    });

    test("should include member count and owner info", async () => {
      const req = new Request("http://localhost/networks/share/" + invitationCode);
      const res = await controller.getNetworkByShareCode(req, null, { code: invitationCode });
      const data = (await res.json()) as { network?: { user?: { id: string; name: string }; _count?: { members: number } } };

      expect(res.status).toBe(200);
      expect(data.network!.user!.id).toBe(ownerUserId);
      expect(data.network!.user!.name).toBe("Invite Owner");
      expect(data.network!._count!.members).toBeGreaterThanOrEqual(1);
    });
  });

  describe("POST /invitation/:code/accept", () => {
    test("should return 200 and add user as member for valid code", async () => {
      const req = new Request("http://localhost/networks/invitation/" + invitationCode + "/accept", {
        method: "POST",
      });
      const res = await controller.acceptInvitation(req, mockJoiner(), { code: invitationCode });
      const data = (await res.json()) as { index?: { id: string }; membership?: { id: string }; alreadyMember?: boolean };

      expect(res.status).toBe(200);
      expect(data.index!.id).toBe(createdIndexId);
      expect(data.membership!.id).toBe(joinerUserId);
      expect(data.alreadyMember).toBe(false);
    });

    test("should return alreadyMember=true when user accepts again", async () => {
      const req = new Request("http://localhost/networks/invitation/" + invitationCode + "/accept", {
        method: "POST",
      });
      const res = await controller.acceptInvitation(req, mockJoiner(), { code: invitationCode });
      const data = (await res.json()) as { alreadyMember?: boolean };

      expect(res.status).toBe(200);
      expect(data.alreadyMember).toBe(true);
    });

    test("should return 400 for invalid invitation code", async () => {
      const req = new Request("http://localhost/networks/invitation/bad-code/accept", {
        method: "POST",
      });
      const res = await controller.acceptInvitation(req, mockJoiner(), { code: "bad-code" });
      const data = (await res.json()) as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired invitation link");
    });
  });
});
