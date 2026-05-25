import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { shouldEnrichGhostDisplayNameFromParallel } from "../profile.enricher.js";

describe("shouldEnrichGhostDisplayNameFromParallel", () => {
  it("returns true for ghost with email-local placeholder and multi-word enriched name", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane", email: "jane@company.com", isGhost: true },
        "Jane Public",
      ),
    ).toBe(true);
  });

  it("returns false for non-ghost user", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane", email: "jane@company.com", isGhost: false },
        "Jane Public",
      ),
    ).toBe(false);
  });

  it("returns true when enriched name is single word and differs from current", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jdoe", email: "jdoe@company.com", isGhost: true },
        "Jane",
      ),
    ).toBe(true);
  });

  it("returns true when ghost has importer-supplied name and enriched name differs", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "Jane Doe", email: "jane@company.com", isGhost: true },
        "Jane Public",
      ),
    ).toBe(true);
  });

  it("returns false when enriched name matches current name", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane", email: "jane@company.com", isGhost: true },
        "jane",
      ),
    ).toBe(false);
  });

  it("returns false when isGhost is null", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane", email: "jane@company.com", isGhost: null },
        "Jane Public",
      ),
    ).toBe(false);
  });

  it("returns false when enrichedName contains @", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane", email: "jane@company.com", isGhost: true },
        "jane@company.com",
      ),
    ).toBe(false);
  });

  it("returns true when current name is full email (placeholder variant)", () => {
    expect(
      shouldEnrichGhostDisplayNameFromParallel(
        { name: "jane@company.com", email: "jane@company.com", isGhost: true },
        "Jane Public",
      ),
    ).toBe(true);
  });
});
