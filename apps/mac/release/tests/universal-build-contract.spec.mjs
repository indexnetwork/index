import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const universalBuildPath = resolve(import.meta.dir, "../build-universal.sh");
const appBuildPath = resolve(repoRoot, "apps/mac/IndexApp/build.sh");
const connectorBuildPath = resolve(repoRoot, "apps/mac/IndexConnector/build.sh");
const workflowPath = resolve(repoRoot, ".github/workflows/mac-app-build.yml");

function source(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

describe("macOS Universal 2 production build contract", () => {
  test("compiles optimized arm64 and x86_64 slices at the macOS 13 floor", () => {
    const buildSource = [
      source(universalBuildPath),
      source(appBuildPath),
      source(connectorBuildPath),
    ].join("\n");

    expect(buildSource).toContain("arm64-apple-macos13.0");
    expect(buildSource).toContain("x86_64-apple-macos13.0");
    expect(buildSource).toContain("-O");
    expect(buildSource).toContain("-whole-module-optimization");
    expect(buildSource).toContain("lipo -create");
    expect(buildSource).not.toContain("-Onone");
  });

  test("exposes slice compilation, merge, and Mach-O verification contracts", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toContain("compile_slice()");
    expect(buildSource).toContain("merge_universal()");
    expect(buildSource).toContain("verify_macho()");
    expect(buildSource).toContain("apps/mac/dist/unsigned");
    expect(buildSource).toContain("release-config.sh");
    expect(buildSource).toContain("write_release_config");
    expect(buildSource).toContain("lipo -archs");
    expect(buildSource).toContain("LC_BUILD_VERSION");
    expect(buildSource).toContain("minos 13.0");
  });

  test("keeps release building ad-hoc and credential-free", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toContain("codesign --force --deep --sign -");
    expect(buildSource).not.toContain("Developer ID Application");
    expect(buildSource).not.toContain("notary");
    expect(buildSource).toContain("PROVISIONING_PROFILE INDEX_DEVELOPMENT_BUILD");
    expect(buildSource).toContain('release_error "$name is forbidden for the unsigned production build"');
    expect(buildSource).not.toContain("secrets.");
  });

  test("runs the real Universal 2 verification on macOS without secrets", () => {
    const workflow = source(workflowPath);
    expect(workflow).toContain("Build unsigned Universal 2 production bundles");
    expect(workflow).toContain("apps/mac/release/build-universal.sh");
    expect(workflow).toContain("lipo -archs apps/mac/dist/unsigned/Index.app/Contents/MacOS/Index");
    expect(workflow).toContain("lipo -archs apps/mac/dist/unsigned/IndexConnector.app/Contents/MacOS/IndexConnector");
  });
});
