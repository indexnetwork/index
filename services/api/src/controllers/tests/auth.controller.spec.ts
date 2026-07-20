/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm/sql";
import { AuthController } from "../auth.controller";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import db from "../../lib/drizzle/drizzle";
import { userSocials } from "../../schemas/database.schema";
import { AuthGuard, SessionOnlyGuard, type AuthenticatedUser } from "../../guards/auth.guard";
import { RouteRegistry } from "../../lib/router/router.decorators";
import { enrichmentService } from "../../services/enrichment.service";
import { userService } from "../../services/user.service";

describe("AuthController Integration", () => {
  const controller = new AuthController();
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-auth-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test Auth User",
      intro: "Test intro",
      location: "Test City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await db.delete(userSocials).where(eq(userSocials.userId, testUserId));
      await userAdapter.deleteById(testUserId);
    }
  });

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test Auth User",
  });

  describe("GET /me", () => {
    test("should return 200 and user when user exists", async () => {
      const req = new Request("http://localhost/auth/me");
      const res = await controller.me(req, mockUser());
      const data = await res.json() as { user?: unknown; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect((data.user as { id: string }).id).toBe(testUserId);
      expect((data.user as { name: string }).name).toBe("Test Auth User");
      expect((data.user as { email: string }).email).toBe(testEmail);
    });

    test("should return 404 when user not found in DB", async () => {
      const req = new Request("http://localhost/auth/me");
      const fakeUser: AuthenticatedUser = {
        id: "00000000-0000-0000-0000-000000000000",
        email: "fake@example.com",
        name: "Fake",
      };
      const res = await controller.me(req, fakeUser);
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("User not found");
    });

    test("should trigger background profile sync when user has name and socials but no profile", async () => {
      await userAdapter.update(testUserId, { name: "Trigger User" });
      await db.delete(userSocials).where(eq(userSocials.userId, testUserId));
      await db.insert(userSocials).values({
        userId: testUserId,
        label: "github",
        value: "https://github.com/trigger-user",
      });

      const originalSyncProfile = enrichmentService.syncProfile;
      let syncCallCount = 0;
      enrichmentService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof enrichmentService.syncProfile;

      try {
        const req = new Request("http://localhost/auth/me");
        const res = await controller.me(req, mockUser());
        const data = await res.json() as { user?: { id: string }; error?: string };

        expect(res.status).toBe(200);
        expect(data.user).toBeDefined();
        expect(data.user!.id).toBe(testUserId);
        expect(syncCallCount).toBe(1);
      } finally {
        enrichmentService.syncProfile = originalSyncProfile;
      }
    });

    test("should not trigger background profile sync when socials are missing", async () => {
      await userAdapter.update(testUserId, { name: "No Social User" });
      await db.delete(userSocials).where(eq(userSocials.userId, testUserId));

      const originalSyncProfile = enrichmentService.syncProfile;
      let syncCallCount = 0;
      enrichmentService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof enrichmentService.syncProfile;

      try {
        const req = new Request("http://localhost/auth/me");
        const res = await controller.me(req, mockUser());
        const data = await res.json() as { user?: { id: string }; error?: string };

        expect(res.status).toBe(200);
        expect(data.user).toBeDefined();
        expect(data.user!.id).toBe(testUserId);
        expect(syncCallCount).toBe(0);
      } finally {
        enrichmentService.syncProfile = originalSyncProfile;
      }
    });

    test("should not trigger background profile sync when profile already exists", async () => {
      const originalFindWithGraph = userService.findWithGraph;
      const originalSyncProfile = enrichmentService.syncProfile;

      let syncCallCount = 0;

      userService.findWithGraph = (async () => ({
        id: testUserId,
        email: testEmail,
        name: "Existing Profile User",
        intro: "Already has profile",
        avatar: null,
        location: "Test City",
        socials: [{ id: "s1", userId: testUserId, label: "linkedin", value: "https://linkedin.com/in/existing-user" }],
        timezone: "UTC",
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        hasProfile: true,
        notificationPreferences: {
          connectionUpdates: true,
          weeklyNewsletter: true,
        },
        onboarding: {},
        lastWeeklyEmailSentAt: null,
      })) as typeof userService.findWithGraph;

      enrichmentService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof enrichmentService.syncProfile;

      try {
        const req = new Request("http://localhost/auth/me");
        const res = await controller.me(req, mockUser());
        const data = await res.json() as { user?: { id: string; name: string }; error?: string };

        expect(res.status).toBe(200);
        expect(data.user).toBeDefined();
        expect(data.user!.id).toBe(testUserId);
        expect(data.user!.name).toBe("Existing Profile User");
        expect(syncCallCount).toBe(0);
      } finally {
        userService.findWithGraph = originalFindWithGraph;
        enrichmentService.syncProfile = originalSyncProfile;
      }
    });
  });

  describe("POST /cli-credential", () => {
    test("is session-only with the write limiter first", () => {
      const route = RouteRegistry.getRoutes(AuthController)
        .find((candidate) => candidate.methodName === "createCliCredential");
      expect(route).toMatchObject({ method: "POST", path: "/cli-credential" });

      const guards = RouteRegistry.getGuards(AuthController, "createCliCredential");
      expect(guards[0]?.name).toBe("RateLimit(write)");
      expect(guards).toContain(SessionOnlyGuard);
      expect(guards).not.toContain(AuthGuard);
    });

    test("passes only the validated protocol version to the credential service", async () => {
      let received: { userId: string; protocolVersion: 1 | 2 } | null = null;
      const expiresAt = new Date("2026-10-16T12:00:00.000Z");
      const credentialController = new AuthController({
        create: async (userId, protocolVersion) => {
          received = { userId, protocolVersion };
          return { key: "raw-cli-key", id: "cli-key-id", expiresAt };
        },
        revoke: async () => false,
      });
      const req = new Request("http://localhost/auth/cli-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: 2 }),
      });

      const res = await credentialController.createCliCredential(req, mockUser());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        key: "raw-cli-key",
        id: "cli-key-id",
        expiresAt: expiresAt.toISOString(),
      });
      expect(received).toEqual({ userId: testUserId, protocolVersion: 2 });
    });

    test("rejects malformed JSON without minting", async () => {
      let createCalls = 0;
      const credentialController = new AuthController({
        create: async () => {
          createCalls += 1;
          return { key: "unexpected", id: "unexpected", expiresAt: new Date() };
        },
        revoke: async () => false,
      });
      const req = new Request("http://localhost/auth/cli-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      });

      const res = await credentialController.createCliCredential(req, mockUser());

      expect(res.status).toBe(400);
      expect(createCalls).toBe(0);
    });

    test.each([
      ["missing version", {}],
      ["unsupported version", { protocolVersion: 3 }],
      ["string version", { protocolVersion: "2" }],
      ["generic Better Auth fields", {
        protocolVersion: 1,
        name: "caller-controlled",
        expiresIn: 1,
        metadata: { client: "attacker", protocolVersion: 2, agentId: "agent" },
      }],
    ])("rejects %s without minting", async (_label, body) => {
      let createCalls = 0;
      const credentialController = new AuthController({
        create: async () => {
          createCalls += 1;
          return { key: "unexpected", id: "unexpected", expiresAt: new Date() };
        },
        revoke: async () => false,
      });
      const req = new Request("http://localhost/auth/cli-credential", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const res = await credentialController.createCliCredential(req, mockUser());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid CLI credential payload" });
      expect(createCalls).toBe(0);
    });
  });

  describe("POST /cli-credential/revoke", () => {
    test("accepts CLI API keys with the write limiter first", () => {
      const route = RouteRegistry.getRoutes(AuthController)
        .find((candidate) => candidate.methodName === "revokeCliCredential");
      expect(route).toMatchObject({ method: "POST", path: "/cli-credential/revoke" });

      const guards = RouteRegistry.getGuards(AuthController, "revokeCliCredential");
      expect(guards[0]?.name).toBe("RateLimit(write)");
      expect(guards[1]).toBe(AuthGuard);
      expect(guards).not.toContain(SessionOnlyGuard);
    });

    test("passes exact caller and target proof to the service", async () => {
      let received: unknown;
      const credentialController = new AuthController({
        create: async () => ({ key: "unused", id: "unused", expiresAt: new Date() }),
        revoke: async (input) => {
          received = input;
          return true;
        },
      });
      const req = new Request("http://localhost/auth/cli-credential/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "caller-secret" },
        body: JSON.stringify({ keyId: "key-row-id", targetKey: "target-secret" }),
      });

      const res = await credentialController.revokeCliCredential(req, mockUser());

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(received).toEqual({
        userId: testUserId,
        callerKey: "caller-secret",
        keyId: "key-row-id",
        targetKey: "target-secret",
      });
    });

    test.each([
      ["JWT", "http://localhost/auth/cli-credential/revoke", { Authorization: "Bearer jwt" }],
      ["query token", "http://localhost/auth/cli-credential/revoke?token=jwt", {}],
      ["legacy v1 Bearer", "http://localhost/auth/cli-credential/revoke", { Authorization: "Bearer legacy-key" }],
      ["missing credential", "http://localhost/auth/cli-credential/revoke", {}],
    ])("rejects %s transport without calling revoke", async (_label, url, headers) => {
      let revokeCalls = 0;
      const credentialController = new AuthController({
        create: async () => ({ key: "unused", id: "unused", expiresAt: new Date() }),
        revoke: async () => {
          revokeCalls += 1;
          return true;
        },
      });
      const req = new Request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ keyId: "key-row-id", targetKey: "target-secret" }),
      });

      const res = await credentialController.revokeCliCredential(req, mockUser());

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "CLI credential revocation requires x-api-key authentication",
      });
      expect(revokeCalls).toBe(0);
    });

    test.each([
      ["extra fields", { keyId: "id", targetKey: "secret", metadata: {} }],
      ["empty target secret", { keyId: "id", targetKey: "" }],
      ["missing key ID", { targetKey: "secret" }],
      ["oversized target secret", { keyId: "id", targetKey: "x".repeat(513) }],
    ])("rejects %s as a typed bad request", async (_label, body) => {
      let revokeCalls = 0;
      const credentialController = new AuthController({
        create: async () => ({ key: "unused", id: "unused", expiresAt: new Date() }),
        revoke: async () => {
          revokeCalls += 1;
          return true;
        },
      });
      const req = new Request("http://localhost/auth/cli-credential/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "caller-secret" },
        body: JSON.stringify(body),
      });

      const res = await credentialController.revokeCliCredential(req, mockUser());

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid CLI credential revocation payload" });
      expect(revokeCalls).toBe(0);
    });

    test("returns a stable denial when authoritative verification fails", async () => {
      const credentialController = new AuthController({
        create: async () => ({ key: "unused", id: "unused", expiresAt: new Date() }),
        revoke: async () => false,
      });
      const req = new Request("http://localhost/auth/cli-credential/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": "caller-secret" },
        body: JSON.stringify({ keyId: "key-row-id", targetKey: "wrong-secret" }),
      });

      const res = await credentialController.revokeCliCredential(req, mockUser());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "CLI credential revocation denied" });
    });
  });

  describe("PATCH /profile/update", () => {
    test("should return 200 and updated user when body has name", async () => {
      const req = new Request("http://localhost/auth/profile/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Auth User" }),
      });
      const res = await controller.updateProfile(req, mockUser());
      const data = await res.json() as { user?: { name: string }; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user!.name).toBe("Updated Auth User");
    });

    test("should return 200 when body is empty (no changes)", async () => {
      const req = new Request("http://localhost/auth/profile/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res = await controller.updateProfile(req, mockUser());
      expect(res.status).toBe(200);
      const data = await res.json() as { user?: unknown };
      expect(data.user).toBeDefined();
    });
  });
});
