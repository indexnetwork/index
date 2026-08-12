import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dir, "../../../..");
const release = join(root, "apps/mac/release");
const verifier = join(release, "verify-clean-account-evidence.ts");
const attestationVerifier = join(release, "verify-candidate-attestation.ts");
const roots = [];
afterEach(() => { while (roots.length) rmSync(roots.pop(), { recursive: true, force: true }); });
const fixture = (prefix) => { const path = mkdtempSync(join(tmpdir(), prefix)); roots.push(path); return path; };
const run = (command, args = [], env = {}) => spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8" });
const executable = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
const hash = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const canonical = (value) => JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))) + "\n";

function evidence(architecture, authority, overrides = {}) {
  return {
    schemaVersion: 3, releaseVersion: "1.0.0", commit: "a".repeat(40),
    artifactSha256: { app: "b".repeat(64), connector: "c".repeat(64) }, candidateSealSha256: "d".repeat(64), candidateManifestSha256: "e".repeat(64),
    attestationUrl: "https://github.com/indexnetwork/index/attestations/123", macOSVersion: "13.7.1", minimumMacOS: "13.0", architecture,
    tester: `tester-${architecture}`, approver: architecture === "arm64" ? "approver-arm" : "approver-intel", approvalAuthority: authority, approved: true,
    quarantinePreserved: true, gatekeeperLaunch: true, standaloneConnectorInstalled: true, indexAppAbsentDuringStandaloneTest: true, appFreeHermesVerified: true,
    capabilityFamilies: ["manage:identity", "manage:premises", "manage:intents", "manage:networks", "manage:opportunities", "manage:negotiations"],
    negotiationPickupRespondConsultVerified: true, indexFallbackVerified: true, nearExpiryReconnectVerified: true, disconnectRevocationVerified: true,
    plaintextMigrationVerified: true, secretScanMatches: 0, uninstallVerified: true, reinstallVerified: true,
    screenshotHashes: ["f".repeat(64)], logHashes: ["0".repeat(64)], ...overrides,
  };
}

function certificate(dir, name) {
  const key = join(dir, `${name}.key`), cert = join(dir, `${name}.pem`);
  expect(run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", `/CN=${name}/OU=Index Release Approval`, "-keyout", key, "-out", cert, "-days", "1"]).status).toBe(0);
  const digest = run("bash", ["-c", `openssl x509 -in "$1" -outform DER | openssl dgst -sha256 -r | awk '{print $1}'`, "_", cert]).stdout.trim();
  return { key, cert, digest };
}
function sign(path, signer, output) {
  rmSync(output, { force: true });
  expect(run("openssl", ["cms", "-sign", "-binary", "-nodetach", "-nosmimecap", "-in", path, "-signer", signer.cert, "-inkey", signer.key, "-outform", "DER", "-out", output]).status).toBe(0);
}

function signedPair() {
  const dir = fixture("approval-authority-"); const armSigner = certificate(dir, "arm-authority"), intelSigner = certificate(dir, "intel-authority");
  const armJson = join(dir, "arm.json"), intelJson = join(dir, "intel.json"), armCms = join(dir, "arm.cms"), intelCms = join(dir, "intel.cms");
  writeFileSync(armJson, canonical(evidence("arm64", armSigner.digest)));
  writeFileSync(intelJson, canonical(evidence("x86_64", intelSigner.digest)));
  sign(armJson, armSigner, armCms); sign(intelJson, intelSigner, intelCms);
  const env = { INDEX_RELEASE_APPROVAL_CERT_SHA256_ARM64: armSigner.digest, INDEX_RELEASE_APPROVAL_CERT_SHA256_X86_64: intelSigner.digest };
  return { dir, armSigner, intelSigner, armJson, intelJson, armCms, intelCms, env };
}

test("authenticated approval authority refuses unsigned, forged, one-signer, cross-record, replay, and binding mismatches", () => {
  const fx = signedPair(), pair = [verifier, "--pair", fx.armJson, fx.armCms, fx.intelJson, fx.intelCms];
  expect(run("bun", pair, fx.env).status).toBe(0);
  expect(run("bun", [verifier, "--pair", fx.armJson, fx.intelJson], fx.env).status).not.toBe(0);
  expect(run("bun", [verifier, "--pair", fx.armJson, fx.armCms, fx.intelJson, fx.armCms], fx.env).status).not.toBe(0);
  writeFileSync(fx.intelJson, canonical(evidence("x86_64", fx.intelSigner.digest, { candidateManifestSha256: "9".repeat(64) })));
  expect(run("bun", pair, fx.env).status).not.toBe(0);
  writeFileSync(fx.intelJson, canonical(evidence("x86_64", fx.intelSigner.digest))); sign(fx.intelJson, fx.intelSigner, fx.intelCms);
  writeFileSync(fx.armJson, canonical(evidence("arm64", fx.armSigner.digest, { approved: false })));
  expect(run("bun", pair, fx.env).status).not.toBe(0);
});

test("architecture trust pins cannot authenticate swapped architecture records", () => {
  const fx = signedPair(), pair = [verifier, "--pair", fx.armJson, fx.armCms, fx.intelJson, fx.intelCms];
  writeFileSync(fx.armJson, canonical(evidence("x86_64", fx.armSigner.digest)));
  writeFileSync(fx.intelJson, canonical(evidence("arm64", fx.intelSigner.digest)));
  sign(fx.armJson, fx.armSigner, fx.armCms); sign(fx.intelJson, fx.intelSigner, fx.intelCms);
  const result = run("bun", pair, fx.env);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("arm64");
});

test("signed evidence bytes must be exact canonical JSON plus one newline", () => {
  const cases = [
    (value) => `${JSON.stringify(value)}\n`,
    (value) => `${JSON.stringify(value, null, 2)}\n`,
    (value) => canonical(value).replace('"approved":true,', '"approved":true,"approved":true,'),
    (value) => canonical(value).replace('"releaseVersion":"1.0.0"', '"releaseVersion":"1.0.\\u0030"'),
  ];
  for (const mutate of cases) {
    const fx = signedPair(), pair = [verifier, "--pair", fx.armJson, fx.armCms, fx.intelJson, fx.intelCms];
    writeFileSync(fx.armJson, mutate(evidence("arm64", fx.armSigner.digest)));
    sign(fx.armJson, fx.armSigner, fx.armCms);
    const result = run("bun", pair, fx.env);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("canonical");
  }
});

test("exact attestation route requires one recorded id and complete run-bound candidate subjects", () => {
  const dir = fixture("attestation-route-"), candidate = join(dir, "candidate"), bin = join(dir, "bin"); mkdirSync(candidate); mkdirSync(bin);
  const names = ["Index-macOS-1.0.0-universal.dmg", "IndexConnector-1.0.0-universal.dmg", "macos-release.json", "macos-release.cms", "SHA256SUMS"];
  for (const name of names) writeFileSync(join(candidate, name), name);
  const subjects = names.map((name) => ({ name, digest: { sha256: hash(readFileSync(join(candidate, name))) } }));
  executable(join(bin, "gh"), `#!/usr/bin/env bash\n[[ "$1 $2" == "attestation verify" ]] || exit 91\ncat "$FIXTURE"\n`);
  const result = (value, url = "https://github.com/indexnetwork/index/attestations/123") => {
    const path = join(dir, "result.json"); writeFileSync(path, JSON.stringify([value]));
    return run("bun", [attestationVerifier, candidate, url, "indexnetwork/index", "12345", "2", "a".repeat(40)], { PATH: `${bin}:${process.env.PATH}`, FIXTURE: path });
  };
  const valid = { attestation: { id: 123 }, verificationResult: { statement: { subject: subjects }, signature: { certificate: { extensions: {
    SourceRepositoryURI: "https://github.com/indexnetwork/index", SourceRepositoryDigest: "a".repeat(40), SourceRepositoryRef: "refs/tags/v1.0.0",
    BuildSignerURI: "https://github.com/indexnetwork/index/.github/workflows/mac-production-release.yml@refs/tags/v1.0.0", RunInvocationURI: "https://github.com/indexnetwork/index/actions/runs/12345/attempts/2",
    RunnerEnvironment: "github-hosted",
  } } } } };
  expect(result(valid).status).toBe(0);
  expect(result(valid, "https://github.com/indexnetwork/index/attestations/999").status).not.toBe(0);
  expect(result({ ...valid, attestation: { id: 999 } }).status).not.toBe(0);
  expect(result({ ...valid, verificationResult: { ...valid.verificationResult, statement: { subject: subjects.slice(1) } } }).status).not.toBe(0);
  const pathPrefixed = structuredClone(valid); pathPrefixed.verificationResult.statement.subject[0].name = `nested/${names[0]}`;
  expect(result(pathPrefixed).status).not.toBe(0);
  const duplicatePath = structuredClone(valid); duplicatePath.verificationResult.statement.subject[0].name = `nested/${names[1]}`;
  expect(result(duplicatePath).status).not.toBe(0);
  const misleadingBundle = { ...valid, attestation: { id: 999, bundle_url: "https://example.invalid/bundles/123.json" } };
  expect(result(misleadingBundle).status).not.toBe(0);
  const wrongRef = structuredClone(valid); wrongRef.verificationResult.signature.certificate.extensions.SourceRepositoryRef = "refs/heads/v1.0.0";
  expect(result(wrongRef).status).not.toBe(0);
  const replay = structuredClone(valid); replay.verificationResult.signature.certificate.extensions.RunInvocationURI = "https://github.com/indexnetwork/index/actions/runs/999/attempts/2";
  expect(result(replay).status).not.toBe(0);
});
