/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { eq } from "drizzle-orm";
import { AuthController } from "../auth.controller";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import db from "../../lib/drizzle/drizzle";
import { userSocials } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { profileService } from "../../services/profile.service";
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

      const originalSyncProfile = profileService.syncProfile;
      let syncCallCount = 0;
      profileService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof profileService.syncProfile;

      try {
        const req = new Request("http://localhost/auth/me");
        const res = await controller.me(req, mockUser());
        const data = await res.json() as { user?: { id: string }; error?: string };

        expect(res.status).toBe(200);
        expect(data.user).toBeDefined();
        expect(data.user!.id).toBe(testUserId);
        expect(syncCallCount).toBe(1);
      } finally {
        profileService.syncProfile = originalSyncProfile;
      }
    });

    test("should not trigger background profile sync when socials are missing", async () => {
      await userAdapter.update(testUserId, { name: "No Social User" });
      await db.delete(userSocials).where(eq(userSocials.userId, testUserId));

      const originalSyncProfile = profileService.syncProfile;
      let syncCallCount = 0;
      profileService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof profileService.syncProfile;

      try {
        const req = new Request("http://localhost/auth/me");
        const res = await controller.me(req, mockUser());
        const data = await res.json() as { user?: { id: string }; error?: string };

        expect(res.status).toBe(200);
        expect(data.user).toBeDefined();
        expect(data.user!.id).toBe(testUserId);
        expect(syncCallCount).toBe(0);
      } finally {
        profileService.syncProfile = originalSyncProfile;
      }
    });

    test("should not trigger background profile sync when profile already exists", async () => {
      const originalFindWithGraph = userService.findWithGraph;
      const originalSyncProfile = profileService.syncProfile;

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
        profile: {
          id: "profile-id",
          userId: testUserId,
          identity: { name: "Existing Profile User", bio: "Bio", location: "Test City" },
          narrative: { context: "Context" },
          attributes: { interests: ["A"], skills: ["B"] },
          embedding: [],
          implicitIntents: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        notificationPreferences: {
          connectionUpdates: true,
          weeklyNewsletter: true,
        },
        onboarding: {},
        lastWeeklyEmailSentAt: null,
      })) as typeof userService.findWithGraph;

      profileService.syncProfile = (async () => {
        syncCallCount += 1;
        return {};
      }) as typeof profileService.syncProfile;

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
        profileService.syncProfile = originalSyncProfile;
      }
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
