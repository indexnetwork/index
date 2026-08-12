#!/usr/bin/env bun
import { readFileSync } from "node:fs";

const KEYS = [
  "schemaVersion", "releaseVersion", "commit", "artifactSha256", "macOSVersion",
  "architecture", "tester", "approver", "approved", "quarantinePreserved",
  "gatekeeperLaunch", "standaloneConnectorInstalled", "indexAppAbsentDuringStandaloneTest",
  "appFreeHermesVerified", "capabilityFamilies", "negotiationPickupRespondConsultVerified",
  "indexFallbackVerified", "nearExpiryReconnectVerified", "disconnectRevocationVerified",
  "plaintextMigrationVerified", "secretScanMatches", "uninstallVerified", "reinstallVerified",
  "screenshotHashes", "logHashes",
].sort();
const CAPABILITIES = [
  "manage:identity", "manage:premises", "manage:intents", "manage:networks",
  "manage:opportunities", "manage:negotiations",
];
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function refuse(message: string): never { throw new Error(`clean-account evidence refused: ${message}`); }
function exactHashes(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) || new Set(value).size !== value.length) refuse(`${label} must contain unique SHA-256 values`);
}
function macOSMajor(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?$/.test(value)) refuse("macOS version is noncanonical");
  return Number(value.split(".")[0]);
}

export function verifyCleanAccountEvidence(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) refuse("root must be an object");
  const evidence = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(KEYS)) refuse("fields are not the closed schema");
  if (evidence.schemaVersion !== 1 || evidence.releaseVersion !== "1.0.0" || !VERSION.test(String(evidence.releaseVersion))) refuse("release version must be 1.0.0");
  if (typeof evidence.commit !== "string" || !COMMIT.test(evidence.commit)) refuse("commit is invalid");
  if (typeof evidence.artifactSha256 !== "string" || !SHA256.test(evidence.artifactSha256)) refuse("artifact SHA-256 is invalid");
  if (macOSMajor(evidence.macOSVersion) < 13) refuse("macOS 13 or later evidence required");
  if (evidence.architecture !== "arm64" && evidence.architecture !== "x86_64") refuse("approved architecture required");
  for (const identity of ["tester", "approver"] as const) if (typeof evidence[identity] !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62})$/.test(evidence[identity])) refuse(`${identity} identity is invalid`);
  const requiredTrue = [
    "approved", "quarantinePreserved", "gatekeeperLaunch", "standaloneConnectorInstalled",
    "indexAppAbsentDuringStandaloneTest", "appFreeHermesVerified",
    "negotiationPickupRespondConsultVerified", "indexFallbackVerified",
    "nearExpiryReconnectVerified", "disconnectRevocationVerified", "plaintextMigrationVerified",
    "uninstallVerified", "reinstallVerified",
  ];
  for (const key of requiredTrue) if (evidence[key] !== true) refuse(`${key} must be true`);
  if (JSON.stringify(evidence.capabilityFamilies) !== JSON.stringify(CAPABILITIES)) refuse("all canonical capability families are required in canonical order");
  if (evidence.secretScanMatches !== 0) refuse("secret scan must be clean");
  exactHashes(evidence.screenshotHashes, "screenshot hashes");
  exactHashes(evidence.logHashes, "log hashes");
}

if (import.meta.main) {
  if (process.argv.length !== 3) refuse("usage: verify-clean-account-evidence.ts EVIDENCE_JSON");
  const bytes = readFileSync(process.argv[2], "utf8");
  if (!bytes.endsWith("\n") || bytes.trim() !== bytes.slice(0, -1)) refuse("evidence JSON must be canonical-line terminated without surrounding whitespace");
  const value = JSON.parse(bytes);
  verifyCleanAccountEvidence(value);
  process.stdout.write("clean-account evidence valid\n");
}
