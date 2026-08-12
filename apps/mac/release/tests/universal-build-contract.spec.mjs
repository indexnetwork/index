import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

  function extractFixture(lines, arch = "arm64") {
    const fixtureRoot = mkdtempSync(resolve(tmpdir(), "universal-otool-"));
    const otoolFixture = resolve(fixtureRoot, "otool.txt");
    const destination = resolve(fixtureRoot, "identity.json");
    writeFileSync(otoolFixture, `${lines.join("\n")}\n`);
    const result = Bun.spawnSync(
      [
        "bash",
        "-c",
        'source "$1"; run_otool() { cat "$OTOOL_FIXTURE"; }; extract_compiled_identity ignored "$2" "$3"',
        "fixture",
        universalBuildPath,
        arch,
        destination,
      ],
      {
        cwd: repoRoot,
        env: { ...process.env, OTOOL_FIXTURE: otoolFixture },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const output = result.exitCode === 0 ? readFileSync(destination, "utf8") : null;
    rmSync(fixtureRoot, { recursive: true, force: true });
    return { result, output };
  }

  function otoolRows(raw, arch, startAddress = 0x100003f40n) {
    const rows = [];
    for (let offset = 0; offset < raw.length; offset += 16) {
      const chunk = raw.subarray(offset, Math.min(offset + 16, raw.length));
      const fields = [];
      if (arch === "x86_64") {
        for (const byte of chunk) fields.push(byte.toString(16).padStart(2, "0"));
      } else {
        let index = 0;
        for (; index + 4 <= chunk.length; index += 4) {
          fields.push(Buffer.from(chunk.subarray(index, index + 4)).reverse().toString("hex"));
        }
        for (; index < chunk.length; index += 1) {
          fields.push(chunk[index].toString(16).padStart(2, "0"));
        }
      }
      rows.push(`${(startAddress + BigInt(offset)).toString(16).padStart(16, "0")} ${fields.join(" ")}`);
    }
    return rows;
  }

  const canonicalIdentity = '{"IndexBuildTarget":"app"}';

  test("decodes source-faithful arm64 words and x86_64 bytes to the same canonical identity", () => {
    const raw = Buffer.concat([Buffer.from(canonicalIdentity), Buffer.alloc(6)]);
    const armRows = otoolRows(raw, "arm64");
    const x86Rows = otoolRows(raw, "x86_64");
    expect(armRows[0]).toContain("6e49227b 42786564 646c6975 67726154");
    expect(x86Rows[0]).toContain("7b 22 49 6e 64 65 78 42 75 69 6c 64 54 61 72 67");
    for (const [arch, rows] of [["arm64", armRows], ["x86_64", x86Rows]]) {
      const { result, output } = extractFixture(rows, arch);
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(output).toBe(canonicalIdentity);
    }
  });

  test.each([1, 2, 3])("accepts an arm64 final row with %i direct residual byte(s)", (residual) => {
    const raw = Buffer.concat([Buffer.from('{"x":1}'), Buffer.alloc(9 + residual)]);
    const { result, output } = extractFixture(otoolRows(raw, "arm64"), "arm64");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(output).toBe('{"x":1}');
  });

  test("accepts a short x86_64 final byte row", () => {
    const { result, output } = extractFixture(otoolRows(Buffer.from(canonicalIdentity), "x86_64"), "x86_64");
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(output).toBe(canonicalIdentity);
  });

  const canonicalPaddedIdentity = Buffer.concat([
    Buffer.from(canonicalIdentity),
    Buffer.alloc(6),
  ]);

  function mutateRow(rows, rowIndex, mutateFields) {
    const mutated = [...rows];
    const [address, ...fields] = mutated[rowIndex].split(" ");
    mutated[rowIndex] = [address, ...mutateFields(fields)].join(" ");
    return mutated;
  }

  const malformedDataRow = "compiled identity section contains a malformed data row\n";
  const malformedAddressRow = "compiled identity section contains a malformed address-prefixed row\n";

  test.each([
    ["arm64 byte tokens", "arm64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "arm64"), 0, (fields) => ["7b", "22", "49", "6e", ...fields.slice(1)]), malformedDataRow],
    ["x86_64 word tokens", "x86_64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "x86_64"), 0, (fields) => [fields.slice(0, 4).join(""), ...fields.slice(4)]), malformedDataRow],
    ["arm64 residual before a word", "arm64", () => mutateRow(otoolRows(Buffer.from(canonicalIdentity), "arm64"), 1, (fields) => [fields[0], fields.at(-1), fields[1], ...fields.slice(2, -1)]), malformedDataRow],
    ["more than three arm64 residual bytes", "arm64", () => mutateRow(otoolRows(Buffer.from(canonicalIdentity), "arm64"), 1, (fields) => [fields[0], ...Buffer.from(fields[1], "hex").reverse().map((byte) => byte.toString(16).padStart(2, "0")), ...fields.slice(2)]), malformedDataRow],
    ["a short arm64 interior row", "arm64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "arm64"), 0, (fields) => fields.slice(0, -1)), malformedDataRow],
    ["a short x86_64 interior row", "x86_64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "x86_64"), 0, (fields) => fields.slice(0, -1)), malformedDataRow],
    ["an arm64 token with the wrong class", "arm64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "arm64"), 0, (fields) => ["zzzzzzzz", ...fields.slice(1)]), malformedDataRow],
    ["an x86_64 token with the wrong class", "x86_64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "x86_64"), 0, (fields) => ["zz", ...fields.slice(1)]), malformedDataRow],
    ["a section header", "arm64", () => ["Contents of (__TEXT,__indexcfg) section", ...otoolRows(canonicalPaddedIdentity, "arm64").slice(1)], malformedAddressRow],
    ["an address-only row", "arm64", () => [otoolRows(canonicalPaddedIdentity, "arm64")[0].split(" ")[0], ...otoolRows(canonicalPaddedIdentity, "arm64").slice(1)], malformedAddressRow],
    ["an arbitrary 16-hex data token on arm64", "arm64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "arm64"), 0, (fields) => [fields.slice(0, 2).join(""), ...fields.slice(2)]), malformedDataRow],
    ["an arbitrary 16-hex data token on x86_64", "x86_64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "x86_64"), 0, (fields) => [fields.slice(0, 8).join(""), ...fields.slice(8)]), malformedDataRow],
    ["mixed arm64 token forms", "arm64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "arm64"), 0, (fields) => [fields[0], "42", ...fields.slice(2)]), malformedDataRow],
    ["mixed x86_64 token forms", "x86_64", () => mutateRow(otoolRows(canonicalPaddedIdentity, "x86_64"), 0, (fields) => [...fields.slice(0, 2), fields.slice(2, 4).join(""), ...fields.slice(4)]), malformedDataRow],
  ])("rejects source-impossible %s at the row grammar layer", (_name, arch, makeLines, expectedError) => {
    const { result, output } = extractFixture(makeLines(), arch);
    expect(result.exitCode).not.toBe(0);
    expect(output).toBeNull();
    expect(result.stderr.toString()).toBe(expectedError);
  });

  test.each([
    ["gapped", 0x100003f51n],
    ["duplicate", 0x100003f40n],
    ["backward", 0x100003f30n],
  ])("rejects %s x86_64 row addresses", (_name, secondAddress) => {
    const raw = Buffer.concat([Buffer.from(canonicalIdentity), Buffer.alloc(6)]);
    const rows = otoolRows(raw, "x86_64");
    rows[1] = rows[1].replace(/^[0-9a-f]{16}/, secondAddress.toString(16).padStart(16, "0"));
    const { result, output } = extractFixture(rows, "x86_64");
    expect(result.exitCode).not.toBe(0);
    expect(output).toBeNull();
    expect(result.stderr.toString()).toContain("addresses are not contiguous");
  });

  test.each([
    ["non-canonical JSON whitespace", Buffer.from('{"x": 1}')],
    ["trailing JSON whitespace", Buffer.from('{"x":1} ')],
    ["an interior NUL", Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x00, 0x31, 0x7d])],
    ["nonzero trailing contamination", Buffer.concat([Buffer.from('{"x":1}'), Buffer.from([1])])],
    ["sixteen excess trailing NUL bytes", Buffer.concat([Buffer.from('{"x":1}'), Buffer.alloc(16)])],
  ])("rejects %s after architecture-specific decoding", (_name, raw) => {
    for (const arch of ["arm64", "x86_64"]) {
      const { result, output } = extractFixture(otoolRows(raw, arch), arch);
      expect(result.exitCode).not.toBe(0);
      expect(output).toBeNull();
    }
  });

  test.each([0, 1, 15])("accepts canonical JSON with %i bounded trailing NUL byte(s)", (padding) => {
    for (const arch of ["arm64", "x86_64"]) {
      const raw = Buffer.concat([Buffer.from('{"x":1}'), Buffer.alloc(padding)]);
      const { result, output } = extractFixture(otoolRows(raw, arch), arch);
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(output).toBe('{"x":1}');
    }
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
    expect(buildSource).toContain("bytes.fromhex");
    expect(buildSource).toContain("fullmatch");
    expect(buildSource).not.toContain("length($i) == 8");
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

  test("reports the exact credential-free stage when a Universal build fails", () => {
    const buildSource = source(universalBuildPath);
    expect(buildSource).toContain("Universal 2 stage:");
    expect(buildSource).toContain("Universal 2 release build failed during stage:");
    expect(buildSource).not.toContain("set -x");
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
    expect(fixtureJob).toContain('TMPDIR="$(python3 -c');
    expect(fixtureJob).toContain("os.path.realpath");
    expect(fixtureJob).toContain("secrets.INDEX_KEYCHAIN_SIGNING_FIXTURE");
    expect(fixtureJob).not.toContain("Build unsigned Universal 2 production bundles");
  });
});
