/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, mock } from "bun:test";
import type { AuthenticatedUser } from "../../guards/auth.guard";

// Hermetic: mock the enrichment service singleton so no DB/Parallel call is required.
const calls: string[] = [];
mock.module("../../services/enrichment.service", () => ({
  enrichmentService: {
    prefillPublicProfile: async (userId: string) => {
      calls.push(userId);
      return {
        enriched: true,
        profile: {
          name: "Manual Enrich User",
          intro: "Engineer building index.",
          location: "New York",
          avatarUrl: null,
          socials: [{ label: "linkedin", value: "serefyarar" }],
        },
      };
    },
  },
}));

const { EnrichmentController } = await import("../enrichment.controller");

describe("EnrichmentController /enrich (sync public research)", () => {
  const mockUser: AuthenticatedUser = {
    id: "user-1",
    email: "manual-enrich@example.com",
    name: "Manual Enrich User",
  };

  test("runs the public-research lookup inline and returns the resolved profile", async () => {
    const controller = new EnrichmentController();
    const req = new Request("http://localhost/enrichment/enrich", { method: "POST", body: "{}" });

    const res = await controller.enrich(req, mockUser);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enriched: true,
      profile: {
        name: "Manual Enrich User",
        intro: "Engineer building index.",
        location: "New York",
        avatarUrl: null,
        socials: [{ label: "linkedin", value: "serefyarar" }],
      },
    });
    expect(calls).toEqual(["user-1"]);
  });
});
