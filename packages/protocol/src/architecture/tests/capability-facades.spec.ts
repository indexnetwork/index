import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourceRoot = resolve(import.meta.dir, "../..");
const capabilities = [
  "signals",
  "participant-context",
  "communities",
  "opportunities",
  "negotiation",
  "questions",
  "participant-agents",
  "contacts",
  "integrations",
] as const;

describe("capability facades", () => {
  test("keeps every declared capability explicit and root-assembled", async () => {
    const index = await readFile(resolve(sourceRoot, "index.ts"), "utf8");
    for (const capability of capabilities) {
      const facade = await readFile(resolve(sourceRoot, "capabilities", `${capability}.facade.ts`), "utf8");
      expect(facade).toContain("export ");
      expect(facade).not.toContain("export *");
      expect(index).toContain(`./capabilities/${capability}.facade.js`);
    }
  });

  test("documents interaction composition as the sole all-capability seam", async () => {
    const boundaryTool = await readFile(resolve(sourceRoot, "../scripts/architecture/capability-boundaries.ts"), "utf8");
    expect(boundaryTool).toContain('"interaction-composition"');
    expect(boundaryTool).toContain("direct implementation imports");
    expect(boundaryTool).toContain("root exports must use a capability facade");
    for (const capability of capabilities) expect(boundaryTool).toContain(`"${capability}"`);
  });
});
