/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { UserController } from "../user.controller";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import type { AuthenticatedUser } from "../../guards/auth.guard";

describe("UserController Integration", () => {
  const controller = new UserController();
  const userAdapter = new UserDatabaseAdapter();
  let testUserId: string;
  const testEmail = `test-user-controller-${Date.now()}@example.com`;

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(testEmail);
    if (existingUser) await userAdapter.deleteByEmail(testEmail);

    const user = await userAdapter.create({
      email: testEmail,
      name: "Test User Controller",
      intro: "Intro",
      location: "City",
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  const mockAuthUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: testEmail,
    name: "Test User Controller",
  });

  describe("GET /:userId", () => {
    test("should return 200 and user when userId exists", async () => {
      const req = new Request("http://localhost/users/" + testUserId);
      const res = await controller.getUser(req, mockAuthUser(), { userId: testUserId });
      const data = await res.json() as { user?: { id: string; name: string }; error?: string };

      expect(res.status).toBe(200);
      expect(data.user).toBeDefined();
      expect(data.user!.id).toBe(testUserId);
      expect(data.user!.name).toBe("Test User Controller");
    });

    test("should return 404 when userId does not exist", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const req = new Request("http://localhost/users/" + fakeId);
      const res = await controller.getUser(req, mockAuthUser(), { userId: fakeId });
      const data = await res.json() as { error?: string };

      expect(res.status).toBe(404);
      expect(data.error).toBe("User not found");
    });
  });
});
