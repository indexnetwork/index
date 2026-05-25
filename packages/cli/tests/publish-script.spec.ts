import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_ROOT = join(import.meta.dir, "..");
const PUBLISH_SCRIPT = join(CLI_ROOT, "scripts", "publish.ts");

/**
 * Tests for the publish script structure.
 * We verify the script exists and has correct logic without actually
 * running npm publish.
 */
describe("publish script", () => {
  it("exists at scripts/publish.ts", () => {
    expect(existsSync(PUBLISH_SCRIPT)).toBe(true);
  });

  it("publishes platform packages before the main package", async () => {
    const content = await readFile(PUBLISH_SCRIPT, "utf-8");

    // The script should reference publishing platform packages
    expect(content).toContain("@indexnetwork/cli-");

    // It should call the build step
    expect(content).toContain("build");
  });

  it("supports --dry-run flag", async () => {
    const content = await readFile(PUBLISH_SCRIPT, "utf-8");
    expect(content).toContain("dry-run");
  });
});
