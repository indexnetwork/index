import { describe, expect, test } from "bun:test";
import { verifyCleanAccountEvidence, verifyCleanAccountEvidencePair } from "../verify-clean-account-evidence.ts";

const valid = {
  schemaVersion: 3,
  releaseVersion: "1.0.0",
  commit: "a".repeat(40),
  artifactSha256: { app: "b".repeat(64), connector: "c".repeat(64) },
  candidateSealSha256: "d".repeat(64),
  candidateManifestSha256: "e".repeat(64),
  attestationUrl: "https://github.com/indexnetwork/index/attestations/123",
  macOSVersion: "13.7.1",
  minimumMacOS: "13.0",
  architecture: "arm64",
  tester: "release-tester",
  approver: "security-approver-arm",
  approvalAuthority: "f".repeat(64),
  approved: true,
  quarantinePreserved: true,
  gatekeeperLaunch: true,
  standaloneConnectorInstalled: true,
  indexAppAbsentDuringStandaloneTest: true,
  appFreeHermesVerified: true,
  capabilityFamilies: ["manage:identity", "manage:premises", "manage:intents", "manage:networks", "manage:opportunities", "manage:negotiations"],
  negotiationPickupRespondConsultVerified: true,
  indexFallbackVerified: true,
  nearExpiryReconnectVerified: true,
  disconnectRevocationVerified: true,
  plaintextMigrationVerified: true,
  secretScanMatches: 0,
  uninstallVerified: true,
  reinstallVerified: true,
  screenshotHashes: ["c".repeat(64)],
  logHashes: ["d".repeat(64)],
};

describe("clean-account production acceptance evidence", () => {
  test("accepts only the complete approved closed record", () => {
    expect(() => verifyCleanAccountEvidence(valid)).not.toThrow();
    expect(() => verifyCleanAccountEvidence({ ...valid, quarantinePreserved: false })).toThrow("quarantinePreserved");
    expect(() => verifyCleanAccountEvidence({ ...valid, appFreeHermesVerified: false })).toThrow("appFreeHermesVerified");
    expect(() => verifyCleanAccountEvidence({ ...valid, secretScanMatches: 1 })).toThrow("secret scan must be clean");
    expect(() => verifyCleanAccountEvidence({ ...valid, extra: true })).toThrow("closed schema");
  });

  test("requires both independently approved architectures bound to exact candidate bytes", () => {
    const intel = { ...valid, architecture: "x86_64", tester: "release-tester-intel", approver: "security-approver-intel", approvalAuthority: "0".repeat(64) };
    expect(() => verifyCleanAccountEvidence(intel)).not.toThrow();
    expect(() => verifyCleanAccountEvidence({ ...valid, architecture: "universal" })).toThrow("approved architecture");
    expect(() => verifyCleanAccountEvidence({ ...valid, capabilityFamilies: valid.capabilityFamilies.slice(0, -1) })).toThrow("capability families");
    expect(() => verifyCleanAccountEvidencePair([valid, intel])).not.toThrow();
    expect(() => verifyCleanAccountEvidencePair([valid, { ...intel, commit: "9".repeat(40) }])).toThrow("same release candidate");
    expect(() => verifyCleanAccountEvidencePair([valid, { ...intel, approver: valid.approver }])).toThrow("independent approvers");
    expect(() => verifyCleanAccountEvidencePair([valid, { ...intel, approver: valid.tester }])).toThrow("independent approvers");
  });
});
