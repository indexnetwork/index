/**
 * Capability-barrel invariants.
 *
 * Supersedes the capability-facades fixtures. The capabilities/*.facade.ts
 * layer is gone: each capability's `index.ts` is now its own single
 * cross-capability surface, and the root barrel assembles from those.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ALLOWED_CAPABILITY_DIRECTIONS, barrelCapabilityForSourcePath, CAPABILITY_BARREL_DIRECTORIES } from "../../../scripts/architecture/capability-model.ts";

const sourceRoot = resolve(import.meta.dir, "../..");
const capabilities = [
  "intents",
  "contexts",
  "networks",
  "opportunities",
  "negotiations",
  "questions",
  "agents",
  "contacts",
  "integrations",
  "discovery",
] as const;

describe("capability barrels", () => {
  test("every capability has exactly one barrel, and the root assembles from it", async () => {
    const index = await readFile(resolve(sourceRoot, "index.ts"), "utf8");
    for (const capability of capabilities) {
      const directory = CAPABILITY_BARREL_DIRECTORIES[capability];
      expect(directory).toBeDefined();
      const barrel = await readFile(resolve(sourceRoot, directory!, "index.ts"), "utf8");
      expect(barrel).toContain("export ");
      // Explicit named re-exports only — the surface stays reviewable.
      expect(barrel).not.toContain("export *");
      expect(index).toContain(`./${directory}/index.js`);
    }
  });

  test("the barrel is recognised only at the capability's own directory root", () => {
    expect(barrelCapabilityForSourcePath("intents/index.ts")).toBe("intents");
    expect(barrelCapabilityForSourcePath("opportunities/index.ts")).toBe("opportunities");
    // Inner barrels are implementation, not the capability surface.
    expect(barrelCapabilityForSourcePath("intents/application/index.ts")).toBeUndefined();
    expect(barrelCapabilityForSourcePath("intents/domain/index.ts")).toBeUndefined();
    // Directories that share a capability but do not own its barrel.
    expect(barrelCapabilityForSourcePath("enrichment/index.ts")).toBeUndefined();
    expect(barrelCapabilityForSourcePath("premises/index.ts")).toBeUndefined();
  });

  test("the removed facade layer does not come back", async () => {
    const index = await readFile(resolve(sourceRoot, "index.ts"), "utf8");
    expect(index).not.toContain("capabilities/");
    expect(index).not.toContain(".facade.js");
  });

  test("documents interaction composition as the sole all-capability seam", async () => {
    const boundaryTool = await readFile(
      resolve(sourceRoot, "../scripts/architecture/capability-boundaries.ts"),
      "utf8",
    );
    expect(ALLOWED_CAPABILITY_DIRECTIONS["interaction-composition"]).toEqual(capabilities);
    // Assert the operator-facing violation strings, not the prose above them.
    expect(boundaryTool).toContain("import it via");
    expect(boundaryTool).toContain("root exports must use the capability barrel");
    expect(boundaryTool).toContain("uses forbidden");
    // The composition root is deliberately barrel-less.
    expect(CAPABILITY_BARREL_DIRECTORIES["interaction-composition"]).toBeUndefined();
  });
});
