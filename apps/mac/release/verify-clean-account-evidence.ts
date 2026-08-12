#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const KEYS = [
  "schemaVersion", "releaseVersion", "commit", "artifactSha256", "candidateSealSha256", "candidateManifestSha256",
  "attestationUrl", "macOSVersion", "minimumMacOS", "architecture", "tester", "approver", "approvalAuthority",
  "approved", "quarantinePreserved", "gatekeeperLaunch", "standaloneConnectorInstalled",
  "indexAppAbsentDuringStandaloneTest", "appFreeHermesVerified", "capabilityFamilies",
  "negotiationPickupRespondConsultVerified", "indexFallbackVerified", "nearExpiryReconnectVerified",
  "disconnectRevocationVerified", "plaintextMigrationVerified", "secretScanMatches",
  "uninstallVerified", "reinstallVerified", "screenshotHashes", "logHashes",
].sort();
const ARTIFACT_KEYS = ["app", "connector"].sort();
const CAPABILITIES = ["manage:identity", "manage:premises", "manage:intents", "manage:networks", "manage:opportunities", "manage:negotiations"];
const SHA256 = /^[0-9a-f]{64}$/; const COMMIT = /^[0-9a-f]{40}$/; const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/; const IDENTITY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/;
const refuse = (message: string): never => { throw new Error(`clean-account evidence refused: ${message}`); };
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void { if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) refuse(`${label} fields are not the closed schema`); }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) refuse(`${label} must be an object`); return value as Record<string, unknown>; }
function exactHashes(value: unknown, label: string): void { if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) || new Set(value).size !== value.length) refuse(`${label} must contain unique SHA-256 values`); }
function macOSMajor(value: unknown): number { if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/.test(value)) refuse("macOS version is noncanonical"); return Number(value.split(".")[0]); }
function hashCertificate(path: string): string {
  const first = spawnSync("openssl", ["x509", "-in", path, "-outform", "DER"]);
  if (first.status !== 0) refuse("approval signer certificate extraction failed");
  return new Bun.CryptoHasher("sha256").update(first.stdout).digest("hex");
}

export function verifyCleanAccountEvidence(value: unknown): void {
  const evidence = record(value, "root"); exactKeys(evidence, KEYS, "evidence");
  if (evidence.schemaVersion !== 3 || typeof evidence.releaseVersion !== "string" || !VERSION.test(evidence.releaseVersion)) refuse("schema/release version is invalid");
  if (typeof evidence.commit !== "string" || !COMMIT.test(evidence.commit)) refuse("commit is invalid");
  const artifacts = record(evidence.artifactSha256, "artifactSha256"); exactKeys(artifacts, ARTIFACT_KEYS, "artifactSha256");
  for (const key of ARTIFACT_KEYS) if (typeof artifacts[key] !== "string" || !SHA256.test(artifacts[key] as string)) refuse(`${key} artifact SHA-256 is invalid`);
  for (const key of ["candidateSealSha256", "candidateManifestSha256", "approvalAuthority"]) if (typeof evidence[key] !== "string" || !SHA256.test(evidence[key] as string)) refuse(`${key} is invalid`);
  if (typeof evidence.attestationUrl !== "string" || !/^https:\/\/github\.com\/indexnetwork\/index\/attestations\/[1-9][0-9]*$/.test(evidence.attestationUrl)) refuse("attestation URL is invalid");
  if (evidence.minimumMacOS !== "13.0" || macOSMajor(evidence.macOSVersion) < 13) refuse("macOS 13 or later evidence required");
  if (evidence.architecture !== "arm64" && evidence.architecture !== "x86_64") refuse("approved architecture required");
  for (const identity of ["tester", "approver"] as const) if (typeof evidence[identity] !== "string" || !IDENTITY.test(evidence[identity] as string)) refuse(`${identity} identity is invalid`);
  if (evidence.tester === evidence.approver) refuse("tester and approver must be independent");
  for (const key of ["approved", "quarantinePreserved", "gatekeeperLaunch", "standaloneConnectorInstalled", "indexAppAbsentDuringStandaloneTest", "appFreeHermesVerified", "negotiationPickupRespondConsultVerified", "indexFallbackVerified", "nearExpiryReconnectVerified", "disconnectRevocationVerified", "plaintextMigrationVerified", "uninstallVerified", "reinstallVerified"]) if (evidence[key] !== true) refuse(`${key} must be true`);
  if (JSON.stringify(evidence.capabilityFamilies) !== JSON.stringify(CAPABILITIES)) refuse("all canonical capability families are required in canonical order");
  if (evidence.secretScanMatches !== 0) refuse("secret scan must be clean"); exactHashes(evidence.screenshotHashes, "screenshot hashes"); exactHashes(evidence.logHashes, "log hashes");
}

function ordered(value: unknown): unknown {
  return Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, ordered((value as Record<string, unknown>)[key])]))
      : value;
}
function canonical(value: unknown): string { return `${JSON.stringify(ordered(value))}\n`; }
function readCanonical(path: string): Record<string, unknown> {
  const bytes = readFileSync(path, "utf8"); let value: unknown;
  try { value = JSON.parse(bytes); } catch { refuse("evidence JSON is invalid or noncanonical"); }
  if (bytes !== canonical(value)) refuse("evidence JSON bytes must be exact canonical JSON plus one final newline");
  verifyCleanAccountEvidence(value); return value as Record<string, unknown>;
}
export function verifyCleanAccountEvidencePair(values: unknown[]): void {
  if (values.length !== 2) refuse("exactly two evidence records are required"); values.forEach(verifyCleanAccountEvidence); const records = values as Record<string, unknown>[];
  if (new Set(records.map((item) => item.architecture)).size !== 2 || !records.some((item) => item.architecture === "arm64") || !records.some((item) => item.architecture === "x86_64")) refuse("one arm64 and one x86_64 record are required");
  const bindingKeys = ["schemaVersion", "releaseVersion", "commit", "artifactSha256", "candidateSealSha256", "candidateManifestSha256", "attestationUrl", "minimumMacOS"];
  if (JSON.stringify(bindingKeys.map((key) => records[0][key])) !== JSON.stringify(bindingKeys.map((key) => records[1][key]))) refuse("records do not bind the same release candidate");
  const testers = new Set(records.map((item) => item.tester)), approvers = records.map((item) => item.approver), authorities = records.map((item) => item.approvalAuthority);
  if (new Set(approvers).size !== 2 || approvers.some((approver) => testers.has(approver)) || new Set(authorities).size !== 2) refuse("architecture records require independent approvers and authorities");
}
function verifySignedRecord(jsonPath: string, cmsPath: string, expectedPin: string, expectedArchitecture: "arm64" | "x86_64"): Record<string, unknown> {
  if (!SHA256.test(expectedPin)) refuse("reviewed approval certificate pin is missing or invalid");
  const work = mkdtempSync(join(tmpdir(), "index-approval-cms.")); const recovered = join(work, "record.json"), signer = join(work, "signer.pem");
  try {
    const result = spawnSync("openssl", ["cms", "-verify", "-binary", "-noverify", "-purpose", "any", "-inform", "DER", "-in", cmsPath, "-out", recovered, "-signer", signer], { stdio: ["ignore", "ignore", "ignore"] });
    if (result.status !== 0 || !readFileSync(recovered).equals(readFileSync(jsonPath))) refuse("approval signature or exact record bytes are invalid");
    const value = readCanonical(jsonPath); const signerPin = hashCertificate(signer);
    if (signerPin !== expectedPin || value.approvalAuthority !== signerPin) refuse("approval signer does not match reviewed local authority pin");
    if (value.architecture !== expectedArchitecture) refuse(`${expectedArchitecture} approval pin requires an ${expectedArchitecture} evidence record`);
    return value;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export function verifySignedCleanAccountEvidencePair(armJson: string, armCms: string, intelJson: string, intelCms: string): Record<string, unknown>[] {
  const arm = verifySignedRecord(armJson, armCms, process.env.INDEX_RELEASE_APPROVAL_CERT_SHA256_ARM64 ?? "", "arm64");
  const intel = verifySignedRecord(intelJson, intelCms, process.env.INDEX_RELEASE_APPROVAL_CERT_SHA256_X86_64 ?? "", "x86_64");
  verifyCleanAccountEvidencePair([arm, intel]); return [arm, intel];
}

if (import.meta.main) {
  if (process.argv[2] === "--pair") {
    if (process.argv.length !== 7) refuse("usage: verify-clean-account-evidence.ts --pair ARM64_JSON ARM64_CMS X86_64_JSON X86_64_CMS");
    verifySignedCleanAccountEvidencePair(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
    process.stdout.write("two-architecture authenticated clean-account evidence valid\n");
  } else refuse("usage: verify-clean-account-evidence.ts --pair ARM64_JSON ARM64_CMS X86_64_JSON X86_64_CMS");
}
