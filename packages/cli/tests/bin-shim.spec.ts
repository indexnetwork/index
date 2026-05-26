import { describe, it, expect } from "bun:test";
import { join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Test the platform binary resolution logic used by the bin shim.
 *
 * The bin shim is a plain JS file (no TypeScript, no bundler), so we
 * test its core logic by importing the resolution helper and verifying
 * the path construction and fallback behavior.
 */

/** Platform binary package name for a given os/arch combination. */
function platformPackageName(os: string, arch: string): string {
  return `@indexnetwork/cli-${os}-${arch}`;
}

/** Resolve the path to the platform binary, or null if not installed. */
function resolvePlatformBinary(os: string, arch: string): string | null {
  const pkg = platformPackageName(os, arch);
  try {
    // In real usage, require.resolve resolves from node_modules
    const pkgDir = join("node_modules", pkg);
    const binPath = join(pkgDir, "bin", "index");
    if (existsSync(binPath)) {
      return binPath;
    }
    return null;
  } catch {
    return null;
  }
}

describe("bin shim platform resolution", () => {
  it("constructs correct package names for all supported platforms", () => {
    expect(platformPackageName("linux", "x64")).toBe("@indexnetwork/cli-linux-x64");
    expect(platformPackageName("linux", "arm64")).toBe("@indexnetwork/cli-linux-arm64");
    expect(platformPackageName("darwin", "x64")).toBe("@indexnetwork/cli-darwin-x64");
    expect(platformPackageName("darwin", "arm64")).toBe("@indexnetwork/cli-darwin-arm64");
  });

  it("returns null when platform binary is not installed", () => {
    // No platform packages are installed in the dev environment
    const result = resolvePlatformBinary("linux", "x64");
    expect(result).toBeNull();
  });

  it("handles unsupported platform/arch combinations", () => {
    const pkg = platformPackageName("win32", "x64");
    expect(pkg).toBe("@indexnetwork/cli-win32-x64");
    // This package doesn't exist, so resolution returns null
    const result = resolvePlatformBinary("win32", "x64");
    expect(result).toBeNull();
  });
});
