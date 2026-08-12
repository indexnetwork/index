import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const generator = join(release, "generate-release-metadata.ts");
const schemaPath = join(release, "release-metadata.schema.json");
const signScript = join(release, "sign-release-metadata.sh");
const verifyScript = join(release, "verify-release-metadata.sh");
const commit = "8e676b6b143ca7339d5e7ee3391faebc2fb8f69b";
const fixtures = [];
const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg"];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "mac-release-metadata-"));
  fixtures.push(root);
  const final = join(root, "final");
  const output = join(root, "output");
  mkdirSync(final, { mode: 0o700 });
  mkdirSync(output, { mode: 0o700 });
  names.forEach((name, index) => {
    const artifact = join(final, name);
    writeFileSync(artifact, index === 0 ? "final-app-dmg-bytes" : "final-connector-dmg-bytes");
    const digest = Bun.SHA256.hash(readFileSync(artifact), "hex");
    writeFileSync(`${artifact}.reproducibility.txt`, [
      "macOS.actual=13.6.9", "macOS.expected=13.6.9",
      "build.actual=22G830", "build.expected=22G830",
      "runner.actual=macos-13:20240801.1", "runner.expected=macos-13:20240801.1",
      `artifact.sha256=${"a".repeat(64)}`, `finalArtifact.sha256=${digest}`, "",
    ].join("\n"));
  });
  return { root, final, output };
}
function runGenerator(final, output, extra = []) {
  return Bun.spawnSync(["bun", generator, final, output, "7", commit, ...extra], { cwd: repo, stdout: "pipe", stderr: "pipe" });
}
function verifyGenerated(final, output) {
  return Bun.spawnSync(["bun", generator, "--verify", final, output, "7", commit], { cwd: repo, stdout: "pipe", stderr: "pipe" });
}
function executable(path, source) { writeFileSync(path, source); chmodSync(path, 0o755); }

function assertSortedObjectKeys(value) {
  if (Array.isArray(value)) return value.forEach(assertSortedObjectKeys);
  if (!value || typeof value !== "object") return;
  expect(Object.keys(value)).toEqual(Object.keys(value).toSorted());
  Object.values(value).forEach(assertSortedObjectKeys);
}

test("generates exact canonical schema, immutable URLs, final hashes, sizes, and sorted checksums", () => {
  const { final, output } = fixture();
  const result = runGenerator(final, output);
  expect(result.exitCode).toBe(0);
  const metadataBytes = readFileSync(join(output, "macos-release.json"), "utf8");
  expect(metadataBytes).toBe(`${JSON.stringify(JSON.parse(metadataBytes))}\n`);
  const metadata = JSON.parse(metadataBytes);
  expect(Object.keys(metadata).toSorted()).toEqual([
    "apiUrl", "architectures", "artifacts", "buildNumber", "commit", "connectorProtocolVersion",
    "minimumMacOS", "releaseVersion", "schemaVersion", "teamId", "webUrl",
  ]);
  assertSortedObjectKeys(metadata);
  expect(metadata).toMatchObject({
    schemaVersion: 1, releaseVersion: "1.0.0", buildNumber: "7", commit,
    teamId: "LMQ3XNXLAD", apiUrl: "https://protocol.index.network", webUrl: "https://index.network",
    architectures: ["arm64", "x86_64"], minimumMacOS: "13.0", connectorProtocolVersion: 1,
  });
  expect(metadata.artifacts.map((item) => item.kind)).toEqual(["app-dmg", "connector-dmg"]);
  for (const artifact of metadata.artifacts) {
    expect(artifact.url).toBe(`https://github.com/indexnetwork/index/releases/download/v1.0.0/${artifact.name}`);
    expect(artifact.sha256).toBe(Bun.SHA256.hash(readFileSync(join(final, artifact.name)), "hex"));
    expect(artifact.size).toBe(readFileSync(join(final, artifact.name)).byteLength);
  }
  expect(JSON.stringify(metadata)).not.toMatch(/key|token|credential|notaryPassword/i);
  expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toBe(
    metadata.artifacts.map(({ sha256, name }) => `${sha256}  ${name}\n`).join(""),
  );
  expect(verifyGenerated(final, output).exitCode).toBe(0);
});

test("schema closes both object levels and admits only the two approved artifact contracts", () => {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required.toSorted()).toEqual([
    "apiUrl", "architectures", "artifacts", "buildNumber", "commit", "connectorProtocolVersion",
    "minimumMacOS", "releaseVersion", "schemaVersion", "teamId", "webUrl",
  ]);
  expect(schema.properties.artifacts.minItems).toBe(2);
  expect(schema.properties.artifacts.maxItems).toBe(2);
  expect(schema.$defs.artifact.additionalProperties).toBe(false);
  expect(schema.$defs.artifact.required.toSorted()).toEqual(["kind", "name", "sha256", "size", "url"]);
});

test("generation rejects noncanonical inputs and mismatched or non-credential-free Task 4 evidence", () => {
  for (const [build, candidateCommit] of [["01", commit], ["0", commit], ["7", commit.toUpperCase()], ["7", "abc"]]) {
    const { final, output } = fixture();
    const result = Bun.spawnSync(["bun", generator, final, output, build, candidateCommit], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
  }
  for (const mutation of [
    (lines) => lines.map((line) => line.startsWith("finalArtifact.sha256=") ? `finalArtifact.sha256=${"0".repeat(64)}` : line),
    (lines) => lines.map((line) => line === "runner.expected=macos-13:20240801.1" ? "runner.expected=macos-13:other" : line),
    (lines) => [...lines.slice(0, -1), "notaryPassword=forbidden", ""],
  ]) {
    const { final, output } = fixture();
    const evidence = `${join(final, names[0])}.reproducibility.txt`;
    writeFileSync(evidence, mutation(readFileSync(evidence, "utf8").split("\n")).join("\n"));
    expect(runGenerator(final, output).exitCode).not.toBe(0);
  }
});

test("verification rejects noncanonical bytes, extra keys, mutable URLs, wrong names, sizes, and digests", () => {
  const mutations = [
    (metadata) => ({ ...metadata, extra: true }),
    (metadata) => ({ ...metadata, artifacts: metadata.artifacts.map((item, index) => index ? item : { ...item, url: "https://github.com/indexnetwork/index/releases/latest/download/Index-macOS-1.0.0-universal.dmg" }) }),
    (metadata) => ({ ...metadata, artifacts: metadata.artifacts.map((item, index) => index ? item : { ...item, name: "Index-latest.dmg" }) }),
    (metadata) => ({ ...metadata, artifacts: metadata.artifacts.map((item, index) => index ? item : { ...item, size: item.size + 1 }) }),
    (metadata) => ({ ...metadata, artifacts: metadata.artifacts.map((item, index) => index ? item : { ...item, sha256: "0".repeat(64) }) }),
  ];
  for (const mutation of mutations) {
    const { final, output } = fixture();
    expect(runGenerator(final, output).exitCode).toBe(0);
    const path = join(output, "macos-release.json");
    writeFileSync(path, `${JSON.stringify(mutation(JSON.parse(readFileSync(path, "utf8"))))}\n`);
    expect(verifyGenerated(final, output).exitCode).not.toBe(0);
  }
  const { final, output } = fixture();
  expect(runGenerator(final, output).exitCode).toBe(0);
  const path = join(output, "macos-release.json");
  writeFileSync(path, `${JSON.stringify(JSON.parse(readFileSync(path, "utf8")), null, 2)}\n`);
  expect(verifyGenerated(final, output).exitCode).not.toBe(0);
});

test("CMS scripts are provider-free contracts with cryptographic verification and pinned signer certificate", () => {
  const sign = readFileSync(signScript, "utf8");
  const verify = readFileSync(verifyScript, "utf8");
  expect(sign).toContain("INDEX_RELEASE_CMS_SIGNING_IDENTITY");
  expect(sign).toMatch(/security cms -S/);
  expect(sign).not.toMatch(/set -x/);
  expect(verify).toMatch(/security cms -V/);
  expect(verify).toMatch(/security cms -D/);
  expect(verify).toContain("LMQ3XNXLAD");
  expect(verify).toContain("Developer ID Application:");
  expect(verify).toMatch(/cmp .*macos-release\.json/);
  expect(verify).toMatch(/shasum -a 256 -c/);
  expect(verify).toContain("openssl cms -verify");
});

test("mocked CMS sign and verify recover canonical bytes and reject a different signer certificate", () => {
  const { root, final, output } = fixture();
  expect(runGenerator(final, output).exitCode).toBe(0);
  const bin = join(root, "bin"); mkdirSync(bin);
  executable(join(bin, "security"), `#!/usr/bin/env bash
set -e
if [[ "$1" == find-identity ]]; then echo '1) ABC "Developer ID Application: Index Network Fixture"'; exit 0; fi
if [[ "$1" == find-certificate ]]; then printf '%s\n' '-----BEGIN CERTIFICATE-----' EXPECTED '-----END CERTIFICATE-----'; exit 0; fi
if [[ "$1 $2" == 'cms -S' ]]; then while (($#)); do [[ "$1" == -i ]] && input="$2"; [[ "$1" == -o ]] && output="$2"; shift; done; cp "$input" "$output"; exit 0; fi
if [[ "$1 $2" == 'cms -V' || "$1 $2" == 'cms -D' ]]; then while (($#)); do [[ "$1" == -i ]] && input="$2"; [[ "$1" == -o ]] && output="$2"; shift; done; cp "$input" "$output"; exit 0; fi
exit 1
`);
  executable(join(bin, "openssl"), `#!/usr/bin/env bash
set -e
if [[ "$1" == x509 && " $* " == *' -subject '* ]]; then echo 'subject=CN=Developer ID Application: Index Network Fixture,OU=LMQ3XNXLAD,O=Index Network'; exit 0; fi
if [[ "$1" == x509 && " $* " == *' -fingerprint '* ]]; then grep -q OTHER "$3" && echo 'sha256 Fingerprint=OTHER' || echo 'sha256 Fingerprint=EXPECTED'; exit 0; fi
if [[ "$1 $2" == 'cms -verify' ]]; then while (($#)); do [[ "$1" == -in ]] && input="$2"; [[ "$1" == -out ]] && output="$2"; [[ "$1" == -signer ]] && signer="$2"; shift; done; cp "$input" "$output"; value=EXPECTED; [[ -n "$MOCK_OTHER" ]] && value="$MOCK_OTHER"; printf '%s\n' '-----BEGIN CERTIFICATE-----' "$value" '-----END CERTIFICATE-----' >"$signer"; exit 0; fi
exit 1
`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, INDEX_RELEASE_CMS_SIGNING_IDENTITY: "Developer ID Application: Index Network Fixture" };
  let result = Bun.spawnSync(["bash", signScript, output], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  result = Bun.spawnSync(["bash", verifyScript, final, output, "7", commit], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  rmSync(join(output, "macos-release.cms"));
  expect(Bun.spawnSync(["bash", signScript, output], { cwd: repo, env, stdout: "pipe", stderr: "pipe" }).exitCode).toBe(0);
  result = Bun.spawnSync(["bash", verifyScript, final, output, "7", commit], { cwd: repo, env: { ...env, MOCK_OTHER: "OTHER" }, stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).not.toBe(0);
});
