#!/usr/bin/env bun
import { readFileSync } from "node:fs";

const KEYS = [
  "schemaVersion", "releaseVersion", "commit", "artifactSha256", "candidateSealSha256",
  "attestationUrl", "macOSVersion", "minimumMacOS", "architecture", "tester", "approver",
  "approved", "quarantinePreserved", "gatekeeperLaunch", "standaloneConnectorInstalled",
  "indexAppAbsentDuringStandaloneTest", "appFreeHermesVerified", "capabilityFamilies",
  "negotiationPickupRespondConsultVerified", "indexFallbackVerified", "nearExpiryReconnectVerified",
  "disconnectRevocationVerified", "plaintextMigrationVerified", "secretScanMatches",
  "uninstallVerified", "reinstallVerified", "screenshotHashes", "logHashes",
].sort();
const ARTIFACT_KEYS = ["app", "connector"].sort();
const CAPABILITIES = [
  "manage:identity", "manage:premises", "manage:intents", "manage:networks",
  "manage:opportunities", "manage:negotiations",
];
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const IDENTITY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/;

function refuse(message: string): never { throw new Error(`clean-account evidence refused: ${message}`); }
function exactKeys(value: Record<string, unknown>, keys: string[], label: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys)) refuse(`${label} fields are not the closed schema`);
}
function exactHashes(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) || new Set(value).size !== value.length) refuse(`${label} must contain unique SHA-256 values`);
}
function macOSMajor(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/.test(value)) refuse("macOS version is noncanonical");
  return Number(value.split(".")[0]);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function verifyCleanAccountEvidence(value: unknown): void {
  const evidence = record(value, "root");
  exactKeys(evidence, KEYS, "evidence");
  if (evidence.schemaVersion !== 2 || typeof evidence.releaseVersion !== "string" || !VERSION.test(evidence.releaseVersion)) refuse("schema/release version is invalid");
  if (typeof evidence.commit !== "string" || !COMMIT.test(evidence.commit)) refuse("commit is invalid");
  const artifacts = record(evidence.artifactSha256, "artifactSha256");
  exactKeys(artifacts, ARTIFACT_KEYS, "artifactSha256");
  for (const key of ARTIFACT_KEYS) if (typeof artifacts[key] !== "string" || !SHA256.test(artifacts[key] as string)) refuse(`${key} artifact SHA-256 is invalid`);
  if (typeof evidence.candidateSealSha256 !== "string" || !SHA256.test(evidence.candidateSealSha256)) refuse("candidate seal SHA-256 is invalid");
  if (typeof evidence.attestationUrl !== "string" || !/^https:\/\/github\.com\/indexnetwork\/index\/attestations\/[1-9][0-9]*$/.test(evidence.attestationUrl)) refuse("attestation URL is invalid");
  if (evidence.minimumMacOS !== "13.0" || macOSMajor(evidence.macOSVersion) < 13) refuse("macOS 13 or later evidence required");
  if (evidence.architecture !== "arm64" && evidence.architecture !== "x86_64") refuse("approved architecture required");
  for (const identity of ["tester", "approver"] as const) if (typeof evidence[identity] !== "string" || !IDENTITY.test(evidence[identity] as string)) refuse(`${identity} identity is invalid`);
  if (evidence.tester === evidence.approver) refuse("tester and approver must be independent");
  const requiredTrue = [
    "approved", "quarantinePreserved", "gatekeeperLaunch", "standaloneConnectorInstalled",
    "indexAppAbsentDuringStandaloneTest", "appFreeHermesVerified",
    "negotiationPickupRespondConsultVerified", "indexFallbackVerified", "nearExpiryReconnectVerified",
    "disconnectRevocationVerified", "plaintextMigrationVerified", "uninstallVerified", "reinstallVerified",
  ];
  for (const key of requiredTrue) if (evidence[key] !== true) refuse(`${key} must be true`);
  if (JSON.stringify(evidence.capabilityFamilies) !== JSON.stringify(CAPABILITIES)) refuse("all canonical capability families are required in canonical order");
  if (evidence.secretScanMatches !== 0) refuse("secret scan must be clean");
  exactHashes(evidence.screenshotHashes, "screenshot hashes");
  exactHashes(evidence.logHashes, "log hashes");
}

function readCanonical(path: string): Record<string, unknown> {
  const bytes = readFileSync(path, "utf8");
  if (!bytes.endsWith("\n") || bytes.trim() !== bytes.slice(0, -1)) refuse("evidence JSON must be line terminated without surrounding whitespace");
  const value = JSON.parse(bytes);
  verifyCleanAccountEvidence(value);
  return value as Record<string, unknown>;
}

export function verifyCleanAccountEvidencePair(values: unknown[]): void {
  if (values.length !== 2) refuse("exactly two evidence records are required");
  values.forEach(verifyCleanAccountEvidence);
  const records = values as Record<string, unknown>[];
  if (new Set(records.map((item) => item.architecture)).size !== 2 || !records.some((item) => item.architecture === "arm64") || !records.some((item) => item.architecture === "x86_64")) refuse("one arm64 and one x86_64 record are required");
  const bindingKeys = ["schemaVersion", "releaseVersion", "commit", "artifactSha256", "candidateSealSha256", "attestationUrl", "minimumMacOS"];
  const canonical = (item: Record<string, unknown>) => JSON.stringify(bindingKeys.map((key) => item[key]));
  if (canonical(records[0]) !== canonical(records[1])) refuse("records do not bind the same release candidate");
  const testers = new Set(records.map((item) => item.tester));
  const approvers = records.map((item) => item.approver);
  if (new Set(approvers).size !== 2 || approvers.some((approver) => testers.has(approver))) refuse("architecture records require independent approvers");
}

if (import.meta.main) {
  if (process.argv[2] === "--pair") {
    if (process.argv.length !== 5) refuse("usage: verify-clean-account-evidence.ts --pair ARM64_JSON X86_64_JSON");
    verifyCleanAccountEvidencePair([readCanonical(process.argv[3]), readCanonical(process.argv[4])]);
    process.stdout.write("two-architecture clean-account evidence valid\n");
  } else {
    if (process.argv.length !== 3) refuse("usage: verify-clean-account-evidence.ts EVIDENCE_JSON");
    readCanonical(process.argv[2]);
    process.stdout.write("clean-account evidence valid\n");
  }
}
