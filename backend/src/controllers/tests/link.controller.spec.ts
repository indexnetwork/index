/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { LinkController } from "../link.controller";
import { UserDatabaseAdapter, LinkDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("LinkController Integration", () => {
  const controller = new LinkController();
  const userAdapter = new UserDatabaseAdapter();
  const linkAdapter = new LinkDatabaseAdapter();
  let testUserId: string;
  let createdLinkId: string;
  const testEmail = `test-link-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) {
      const links = await linkAdapter.listLinks(existingUser.id);
      for (const l of links) await linkAdapter.deleteLink(l.id, existingUser.id);
      await userAdapter.deleteByEmail(testEmail);
    }

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Link User",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      const links = await linkAdapter.listLinks(testUserId);
      for (const l of links) await linkAdapter.deleteLink(l.id, testUserId);
      await userAdapter.deleteById(testUserId);
    }
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Link User",
  });

  describe("GET '' (list)", () => {
    test("should return 200 and empty links when user has no links", async () => {
      const req = new Request("http://localhost/links");
      const res = await controller.list(req, mockUser());
      const data = await res.json() as { links: unknown[] };

      expect(res.status).toBe(200);
      expect(Array.isArray(data.links)).toBe(true);
      expect(data.links.length).toBe(0);
    });
  });

  describe("POST '' (create)", () => {
    test("should return 400 when url is missing", async () => {
      const req = new Request("http://localhost/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.create(req, mockUser());
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(400);
      expect(data.error).toBe("url is required");
    });

    test("should return 200 and create link when url is provided", async () => {
      const req = new Request("http://localhost/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com/page" }),
      });
      const res = await controller.create(req, mockUser());
      const data = await res.json() as { link?: { id: string; url: string } };

      expect(res.status).toBe(200);
      expect(data.link).toBeDefined();
      expect(data.link!.url).toBe("https://example.com/page");
      createdLinkId = data.link!.id;
    });
  });

  describe("GET '' (list) after create", () => {
    test("should return 200 and one link", async () => {
      const req = new Request("http://localhost/links");
      const res = await controller.list(req, mockUser());
      const data = await res.json() as { links: { id: string; url: string }[] };

      expect(res.status).toBe(200);
      expect(data.links.length).toBe(1);
      expect(data.links[0].url).toBe("https://example.com/page");
    });
  });

  describe("GET /:id/content", () => {
    test("should return 200 and link content when link exists", async () => {
      const req = new Request("http://localhost/links/" + createdLinkId + "/content");
      const res = await controller.getContent(req, mockUser(), { id: createdLinkId });
      const data = await res.json() as { url?: string; lastSyncAt?: string | null };

      expect(res.status).toBe(200);
      expect(data.url).toBe("https://example.com/page");
    });

    test("should return 404 when link does not exist", async () => {
      const req = new Request("http://localhost/links/00000000-0000-0000-0000-000000000000/content");
      const res = await controller.getContent(req, mockUser(), { id: "00000000-0000-0000-0000-000000000000" });
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Link not found");
    });
  });

  describe("DELETE /:id", () => {
    test("should return 404 when link does not exist", async () => {
      const req = new Request("http://localhost/links/00000000-0000-0000-0000-000000000000", { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: "00000000-0000-0000-0000-000000000000" });
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("Link not found");
    });

    test("should return 200 and success when link exists", async () => {
      const req = new Request("http://localhost/links/" + createdLinkId, { method: "DELETE" });
      const res = await controller.delete(req, mockUser(), { id: createdLinkId });
      const data = await res.json() as { success?: boolean };

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    test("list should return empty after delete", async () => {
      const req = new Request("http://localhost/links");
      const res = await controller.list(req, mockUser());
      const data = await res.json() as { links: unknown[] };

      expect(res.status).toBe(200);
      expect(data.links.length).toBe(0);
    });
  });
});
