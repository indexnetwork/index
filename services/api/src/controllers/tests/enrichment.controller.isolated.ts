/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { EnrichmentController } from "../enrichment.controller";
import type { AuthenticatedUser } from "../../guards/auth.guard";
import { UserDatabaseAdapter, EnrichmentDatabaseAdapter } from "../../adapters/database.adapter";

// Hermetic: inject a stub sync enricher so no DB/Parallel call is required.
describe("EnrichmentController /enrich (sync public research)", () => {
  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "manual-enrich@example.com",
    name: "Manual Enrich User",
  };

  test("runs the public-research lookup inline and returns the resolved profile", async () => {
    const calls: string[] = [];
    const controller = new EnrichmentController({
      enrichNow: async (userId) => {
        calls.push(userId);
        return {
          name: "Manual Enrich User",
          intro: "Engineer building index.",
          location: "New York",
          avatar: null,
          socials: [{ label: "linkedin", value: "serefyarar" }],
        };
      },
    });

    const res = await controller.enrich({} as Request, mockUser);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enriched: true,
      profile: {
        name: "Manual Enrich User",
        intro: "Engineer building index.",
        location: "New York",
        avatar: null,
        socials: [{ label: "linkedin", value: "serefyarar" }],
      },
    });
    expect(calls).toEqual(["user-1"]);
  });
});

const RUN_PAID_INTEGRATION_TESTS = process.env.RUN_PAID_INTEGRATION_TESTS === "1";
const hasPaidCredentials = Boolean(
  process.env.OPENROUTER_API_KEY && process.env.PARALLELS_API_KEY,
);
const describePaid = RUN_PAID_INTEGRATION_TESTS && hasPaidCredentials ? describe : describe.skip;

// Live enrichment invokes paid OpenRouter and Parallel APIs. Keep the default baseline hermetic.
describePaid("EnrichmentController Integration", () => {
  const controller = new EnrichmentController();
  const userAdapter = new UserDatabaseAdapter();
  const profileAdapter = new EnrichmentDatabaseAdapter();
  let testUserId: string;

  beforeAll(async () => {
    const email = "test-enrichment-controller@example.com";

    const existingUser = await userAdapter.findByEmail(email);
    if (existingUser) {
      await userAdapter.deleteByEmail(email);
    }

    const user = await userAdapter.create({
      email,
      name: "Test Profile User",
      intro: "An engineer interested in agents.",
      location: "San Francisco, CA",
      socials: { x: "https://x.com/test" },
    });
    testUserId = user.id;
    console.log(`Created test user: ${testUserId}`);
  });

  afterAll(async () => {
    if (testUserId) {
      await userAdapter.deleteById(testUserId);
    }
    // Do not close db: other integration specs may run in the same process.
  });

  test("sync should generate a profile for a new user", async () => {
    // 1. Run sync
    // This will trigger the graph: Check DB -> (Missing) -> Scrape -> Generate -> Embed -> Save -> HyDE -> Embed -> Save
    // Note: This relies on parallel scraper working or failing gracefully?
    // If we want to test "real" flows we need real external inputs OR we accept that scraper might return empty if URL inactive.
    // However, the user provided socials so the "objective" will be constructed.
    // The scraper interface is scraping "objective" text (implemented locally via Parallel adapter).

    console.log("Starting sync...");
    const mockRequest = {} as Request;
    const mockUser: AuthenticatedUser = {
      id: testUserId,
      email: "test-enrichment-controller@example.com",
      name: "Test Profile User"
    };
    const result = await controller.sync(mockRequest, mockUser);
    console.log("Sync result:", result);

    // 2. Verify DB state - Profile should be created
    const profile = await profileAdapter.getProfileRow(testUserId);

    expect(profile).not.toBeNull();
    expect(profile!.identity?.name).toBeDefined();
    // Verify HyDE is stored in hyde_documents
    const { HydeDatabaseAdapter } = await import("../../adapters/database.adapter");
    const hydeAdapter = new HydeDatabaseAdapter();
    const hydeDoc = await hydeAdapter.getHydeDocument('profile', testUserId, 'mirror');
    expect(hydeDoc).not.toBeNull();
    expect(hydeDoc!.hydeText).toBeDefined();
    expect(hydeDoc!.hydeEmbedding).not.toBeNull();
  }, 120000); // Long timeout for LLM/Scraping calls

  test("sync should be idempotent (second run should just verify)", async () => {
    console.log("Starting idempotent sync...");
    const mockRequest = {} as Request;
    const mockUser: AuthenticatedUser = {
      id: testUserId,
      email: "test-enrichment-controller@example.com",
      name: "Test Profile User"
    };
    await controller.sync(mockRequest, mockUser);

    // Second run should be much faster as it skips generation (if logic holds)
    // Though without detailed logs inspection, we mainly verify it doesn't crash
    // and profile still exists.

    const profile = await profileAdapter.getProfileRow(testUserId);
    expect(profile).not.toBeNull();

    // Optional: check if updatedAt changed? If it skips, it shouldn't update.
    // But graph might do slight updates.
    // Mainly we assert valid state.
  }, 60000);

});
