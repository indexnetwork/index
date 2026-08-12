import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const universalBuildPath = resolve(import.meta.dir, "../build-universal.sh");
const appBuildPath = resolve(repoRoot, "apps/mac/scripts/build.sh");
const connectorBuildPath = resolve(repoRoot, "apps/mac/IndexConnector/build.sh");
const workflowPath = resolve(repoRoot, ".github/workflows/mac-app-build.yml");
const unsignedDistPath = resolve(repoRoot, "apps/mac/dist/unsigned");

function source(path) {
  return readFileSync(path, "utf8");
}

function workflowJob(workflow, jobName) {
  const match = workflow.match(
    new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|(?![\\s\\S]))`, "m"),
  );
  if (!match) throw new Error(`missing workflow job ${jobName}`);
  return match[1];
}

afterEach(() => {
  rmSync(unsignedDistPath, { recursive: true, force: true });
});

describe("macOS Universal 2 production build contract", () => {
  test("each native target compiles optimized arm64 and x86_64 slices at macOS 13", () => {
    for (const buildPath of [appBuildPath, connectorBuildPath]) {
      const buildSource = source(buildPath);
      expect(buildSource).toContain("arm64) target_flags=(-target arm64-apple-macos13.0)");
      expect(buildSource).toContain("x86_64) target_flags=(-target x86_64-apple-macos13.0)");
      expect(buildSource).toMatch(/swiftc[^\n]*-O -whole-module-optimization/);
      expect(buildSource).toContain("-sectcreate");
      expect(buildSource).toContain("__TEXT");
      expect(buildSource).toContain("__indexcfg");
      expect(buildSource).not.toContain("-Onone");
    }
    expect(source(universalBuildPath)).toContain("lipo -create");
  });

  test("preserves the public three-argument compile_slice interface", () => {
    const buildSource = source(universalBuildPath);
    const compileSlice = buildSource.match(
      /compile_slice\(\) \{([\s\S]*?)\n\}/,
    )?.[1] ?? "";
    expect(buildSource).toContain("# compile_slice(target, arch, output)");
    expect(compileSlice).toContain('local target="$1" arch="$2" output="$3"');
    expect(compileSlice).not.toContain('"$4"');
    expect(buildSource).toContain('compile_slice app arm64 "$WORK_DIRECTORY/Index.arm64"');
    expect(buildSource).not.toContain('compile_slice app arm64 "$WORK_DIRECTORY/Index.arm64" "$app_identity"');
  });

  test("extracts and compares embedded compiled identity records before merge", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toContain("compile_slice()");
    expect(buildSource).toContain("merge_universal()");
    expect(buildSource).toContain("verify_macho()");
    expect(buildSource).toContain("write_compiled_identity()");
    expect(buildSource).toContain("extract_compiled_identity()");
    expect(buildSource).toContain("otool -arch");
    expect(buildSource).toContain("-X -s __TEXT __indexcfg");
    expect(buildSource).toContain('length($i) == 8 && $i ~ /^[[:xdigit:]]+$/');
    expect(buildSource).not.toContain("tail -n +3");
    expect(buildSource).toContain("compare_compiled_identities");
    expect(buildSource).not.toContain("write_slice_configuration");
    for (const key of [
      "CFBundleIdentifier",
      "CFBundleShortVersionString",
      "CFBundleVersion",
      "IndexReleaseCommit",
      "IndexAPIURL",
      "IndexWebURL",
      "IndexExpectedTeamID",
      "IndexConnectorProtocolVersion",
      "IndexDevelopmentBuild",
      "IndexOwnerKeychainAccessGroup",
      "IndexBuildID",
    ]) {
      expect(buildSource).toContain(key);
    }
    expect(buildSource.indexOf("compare_compiled_identities")).toBeLessThan(
      buildSource.indexOf('merge_universal "$WORK_DIRECTORY/Index.arm64"'),
    );
  });

  test("cleans stale unsigned output even when early platform validation fails", () => {
    mkdirSync(unsignedDistPath, { recursive: true });
    writeFileSync(resolve(unsignedDistPath, "stale"), "stale");

    const result = Bun.spawnSync(["bash", universalBuildPath], {
      cwd: repoRoot,
      env: { ...process.env },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toMatch(/macOS is required|INDEX_RELEASE_VERSION is required/);
    expect(() => readFileSync(resolve(unsignedDistPath, "stale"))).toThrow();
  });

  test("keeps successful output while removing only temporary slice work", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toMatch(/trap cleanup_build EXIT[\s\S]*require_clean_release_inputs/);
    expect(buildSource).toMatch(/cleanup_build\(\)[\s\S]*status[\s\S]*rm -rf "\$DIST_DIRECTORY"/);
    expect(buildSource).toMatch(/if \[\[ "\$status" -ne 0 \]\]/);
    expect(buildSource).toContain('rm -rf "$WORK_DIRECTORY"');
    expect(buildSource).not.toMatch(/trap - EXIT[\s\S]*rm -rf "\$DIST_DIRECTORY"/);
  });

  test("keeps release building ad-hoc and credential-free", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toContain("codesign --force --deep --sign -");
    expect(buildSource).not.toContain("Developer ID Application");
    expect(buildSource).not.toContain("notary");
    expect(buildSource).toContain("PROVISIONING_PROFILE INDEX_DEVELOPMENT_BUILD");
    expect(buildSource).toContain('release_error "$name is forbidden for the unsigned production build"');
  });

  test("isolates real Universal 2 verification in a PR-safe secret-free job", () => {
    const workflow = source(workflowPath);
    const universalJob = workflowJob(workflow, "universal");
    const fixtureJob = workflowJob(workflow, "build");

    expect(universalJob).toContain("runs-on: macos-latest");
    expect(universalJob).toContain("Build unsigned Universal 2 production bundles");
    expect(universalJob).toContain("apps/mac/release/build-universal.sh");
    expect(universalJob).toContain("lipo -archs apps/mac/dist/unsigned/Index.app/Contents/MacOS/Index");
    expect(universalJob).toContain("lipo -archs apps/mac/dist/unsigned/IndexConnector.app/Contents/MacOS/IndexConnector");
    expect(universalJob).not.toContain("secrets.");
    expect(universalJob).not.toMatch(/^    environment:/m);
    expect(universalJob).not.toContain("--signed-access-fixture");
    expect(fixtureJob).toContain("Protected signed cross-identity Keychain fixture");
    expect(fixtureJob).toContain("secrets.INDEX_KEYCHAIN_SIGNING_FIXTURE");
    expect(fixtureJob).not.toContain("Build unsigned Universal 2 production bundles");
  });
});
