/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { NetworkController } from "../network.controller";
import { UserDatabaseAdapter, NetworkGraphDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

/**
 * Coverage for previously-untested backend invitation behaviors:
 *  - PATCH /networks/:id/regenerate-invitation (rotation, owner-only, any policy)
 *  - join-policy transitions and invitation-code persistence
 *  - share/accept edge cases (malformed/empty codes, owner self-accept, non-expiry)
 */
describe("Invitation Backend Gaps", () => {
  const controller = new NetworkController();
  const userAdapter = new UserDatabaseAdapter();
  const indexAdapter = new NetworkGraphDatabaseAdapter();

  let ownerUserId: string;
  let outsiderUserId: string;
  const createdIndexIds: string[] = [];

  const ownerEmail = `test-gaps-owner-${Date.now()}@example.com`;
  const outsiderEmail = `test-gaps-outsider-${Date.now()}@example.com`;

  const mockOwner = (): AuthenticatedUser => ({ id: ownerUserId, email: ownerEmail, name: "Gaps Owner" });
  const mockOutsider = (): AuthenticatedUser => ({ id: outsiderUserId, email: outsiderEmail, name: "Gaps Outsider" });

  type CreatedNetwork = {
    id: string;
    permissions?: { joinPolicy?: string; invitationLink?: { code: string } | null };
  };

  /** Create a network as the owner and track it for cleanup. */
  async function createNetwork(body: Record<string, unknown>): Promise<CreatedNetwork> {
    const req = new Request("http://localhost/networks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await controller.create(req, mockOwner());
    expect(res.status).toBe(200);
    const data = (await res.json()) as { network: CreatedNetwork };
    expect(data.network?.id).toBeTruthy();
    createdIndexIds.push(data.network.id);
    return data.network;
  }

  async function regenerate(networkId: string, user: AuthenticatedUser) {
    const req = new Request(`http://localhost/networks/${networkId}/regenerate-invitation`, { method: "PATCH" });
    return controller.regenerateInvitation(req, user, { id: networkId });
  }

  async function shareLookup(code: string) {
    const req = new Request(`http://localhost/networks/share/${code}`);
    return controller.getNetworkByShareCode(req, null, { code });
  }

  async function acceptInvite(code: string, user: AuthenticatedUser) {
    const req = new Request(`http://localhost/networks/invitation/${code}/accept`, { method: "POST" });
    return controller.acceptInvitation(req, user, { code });
  }

  beforeAll(async () => {
    for (const email of [ownerEmail, outsiderEmail]) {
      const existing = await userAdapter.findByEmail(email);
      if (existing) await userAdapter.deleteByEmail(email);
    }
    const owner = await userAdapter.create({ email: ownerEmail, name: "Gaps Owner", intro: "Test", location: "City" });
    ownerUserId = owner.id;
    const outsider = await userAdapter.create({ email: outsiderEmail, name: "Gaps Outsider", intro: "Test", location: "City" });
    outsiderUserId = outsider.id;
  });

  afterAll(async () => {
    for (const id of createdIndexIds) await indexAdapter.deleteNetworkAndMembers(id);
    if (ownerUserId) await userAdapter.deleteById(ownerUserId);
    if (outsiderUserId) await userAdapter.deleteById(outsiderUserId);
  });

  describe("PATCH /:id/regenerate-invitation", () => {
    test("rotates the code: the old link stops resolving and the new link resolves", async () => {
      const network = await createNetwork({ title: "Rotate Me", prompt: "p", joinPolicy: "invite_only" });
      const oldCode = network.permissions?.invitationLink?.code;
      expect(oldCode).toBeTruthy();

      // Old code resolves before rotation.
      expect((await shareLookup(oldCode!)).status).toBe(200);

      const res = await regenerate(network.id, mockOwner());
      const data = (await res.json()) as { network?: { permissions?: { invitationLink?: { code: string } } } };
      expect(res.status).toBe(200);
      const newCode = data.network?.permissions?.invitationLink?.code;
      expect(newCode).toBeTruthy();
      expect(newCode).not.toBe(oldCode);

      // Old code no longer resolves; new code does.
      expect((await shareLookup(oldCode!)).status).toBe(404);
      expect((await shareLookup(newCode!)).status).toBe(200);
    });

    test("is owner-only: a non-member receives 403", async () => {
      const network = await createNetwork({ title: "Owner Only", prompt: "p", joinPolicy: "invite_only" });
      const res = await regenerate(network.id, mockOutsider());
      const data = (await res.json()) as { error?: string };
      expect(res.status).toBe(403);
      expect(data.error).toContain("Access denied");
    });

    test("works for a public (anyone) network too", async () => {
      const network = await createNetwork({ title: "Public Rotate", prompt: "p", joinPolicy: "anyone" });
      const res = await regenerate(network.id, mockOwner());
      const data = (await res.json()) as { network?: { permissions?: { joinPolicy?: string; invitationLink?: { code: string } } } };
      expect(res.status).toBe(200);
      expect(data.network?.permissions?.joinPolicy).toBe("anyone");
      expect(data.network?.permissions?.invitationLink?.code).toBeTruthy();
    });

    test("returns 403 for a non-existent network (existence not leaked)", async () => {
      const res = await regenerate("00000000-0000-0000-0000-000000000000", mockOwner());
      expect(res.status).toBe(403);
    });
  });

  describe("join-policy transitions & code persistence", () => {
    test("switching anyone → invite_only preserves the existing invitation code", async () => {
      const network = await createNetwork({ title: "Transition", prompt: "p", joinPolicy: "anyone" });
      const codeBefore = network.permissions?.invitationLink?.code;
      expect(codeBefore).toBeTruthy();

      const req = new Request(`http://localhost/networks/${network.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinPolicy: "invite_only" }),
      });
      const res = await controller.updatePermissions(req, mockOwner(), { id: network.id });
      const data = (await res.json()) as { network?: { permissions?: { joinPolicy?: string; invitationLink?: { code: string } } } };
      expect(res.status).toBe(200);
      expect(data.network?.permissions?.joinPolicy).toBe("invite_only");
      // Same code persisted across the transition (not regenerated).
      expect(data.network?.permissions?.invitationLink?.code).toBe(codeBefore);
      expect((await shareLookup(codeBefore!)).status).toBe(200);
    });

    test("invitation code survives a non-permission update (title/prompt change)", async () => {
      const network = await createNetwork({ title: "Persist On Edit", prompt: "p", joinPolicy: "invite_only" });
      const code = network.permissions?.invitationLink?.code;
      expect(code).toBeTruthy();

      const req = new Request(`http://localhost/networks/${network.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Renamed", prompt: "new prompt" }),
      });
      const res = await controller.update(req, mockOwner(), { id: network.id });
      expect(res.status).toBe(200);

      // Same code still resolves after editing unrelated fields.
      const lookup = await shareLookup(code!);
      const lookupData = (await lookup.json()) as { network?: { id: string; title: string } };
      expect(lookup.status).toBe(200);
      expect(lookupData.network?.id).toBe(network.id);
      expect(lookupData.network?.title).toBe("Renamed");
    });

    test("invitation code survives an unrelated permissions update (contextInjection)", async () => {
      const network = await createNetwork({ title: "Persist On Perms", prompt: "p", joinPolicy: "invite_only" });
      const code = network.permissions?.invitationLink?.code;
      expect(code).toBeTruthy();

      const req = new Request(`http://localhost/networks/${network.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contextInjection: { discovery: true } }),
      });
      const res = await controller.updatePermissions(req, mockOwner(), { id: network.id });
      const data = (await res.json()) as { network?: { permissions?: { invitationLink?: { code: string }; contextInjection?: { discovery: boolean } } } };
      expect(res.status).toBe(200);
      expect(data.network?.permissions?.contextInjection?.discovery).toBe(true);
      expect(data.network?.permissions?.invitationLink?.code).toBe(code);
      expect((await shareLookup(code!)).status).toBe(200);
    });
  });

  describe("share/accept edge cases", () => {
    test("share lookup returns 404 for an empty code", async () => {
      const res = await shareLookup("");
      expect(res.status).toBe(404);
    });

    test("share lookup returns 404 for a malformed code", async () => {
      const res = await shareLookup("not-a-real-code-12345");
      const data = (await res.json()) as { error?: string };
      expect(res.status).toBe(404);
      expect(data.error).toBe("Invalid or expired invitation link");
    });

    test("accept returns 400 for a malformed code", async () => {
      const res = await acceptInvite("not-a-real-code-12345", mockOutsider());
      const data = (await res.json()) as { error?: string };
      expect(res.status).toBe(400);
      expect(data.error).toBe("Invalid or expired invitation link");
    });

    test("owner accepting their own invitation link returns alreadyMember=true", async () => {
      const network = await createNetwork({ title: "Self Accept", prompt: "p", joinPolicy: "invite_only" });
      const code = network.permissions?.invitationLink?.code;
      expect(code).toBeTruthy();

      const res = await acceptInvite(code!, mockOwner());
      const data = (await res.json()) as { index?: { id: string }; alreadyMember?: boolean };
      expect(res.status).toBe(200);
      expect(data.index?.id).toBe(network.id);
      expect(data.alreadyMember).toBe(true);
    });

    test("invitation code does not expire: repeated lookups keep resolving", async () => {
      const network = await createNetwork({ title: "No Expiry", prompt: "p", joinPolicy: "invite_only" });
      const code = network.permissions?.invitationLink?.code;
      expect(code).toBeTruthy();

      expect((await shareLookup(code!)).status).toBe(200);
      expect((await shareLookup(code!)).status).toBe(200);
    });
  });
});
