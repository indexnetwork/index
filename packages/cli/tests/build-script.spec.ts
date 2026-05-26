import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CLI_ROOT = join(import.meta.dir, "..");
const BUILD_SCRIPT = join(CLI_ROOT, "scripts", "build.ts");

/**
 * Tests for the build script structure and configuration.
 * We verify the script exists and has correct target definitions
 * without actually running the full cross-compilation (which requires
 * downloading Bun binaries for each target platform).
 */
describe("build script", () => {
  it("exists at scripts/build.ts", () => {
    expect(existsSync(BUILD_SCRIPT)).toBe(true);
  });

  it("defines all 4 platform targets", async () => {
    const content = await readFile(BUILD_SCRIPT, "utf-8");

    // Verify all platform targets are defined
    expect(content).toContain("bun-linux-x64");
    expect(content).toContain("bun-linux-arm64");
    expect(content).toContain("bun-darwin-x64");
    expect(content).toContain("bun-darwin-arm64");
  });

  it("bundles a JS fallback for Node runtime", async () => {
    const content = await readFile(BUILD_SCRIPT, "utf-8");

    // Should reference building the JS bundle for fallback
    expect(content).toContain("dist/index.js");
  });

  it("copies binaries to platform package directories", async () => {
    const content = await readFile(BUILD_SCRIPT, "utf-8");

    // Should reference the npm/ platform dirs
    expect(content).toContain("npm/");
  });
});
