import { describe, expect, test } from "bun:test";
import { verifyCleanAccountEvidence } from "../verify-clean-account-evidence.ts";

const valid = {
  schemaVersion: 1,
  releaseVersion: "1.0.0",
  commit: "a".repeat(40),
  artifactSha256: "b".repeat(64),
  macOSVersion: "13.7.1",
  architecture: "arm64",
  tester: "release-tester",
  approver: "security-approver",
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

  test("requires both architectures through separate records and all capabilities", () => {
    expect(() => verifyCleanAccountEvidence({ ...valid, architecture: "x86_64" })).not.toThrow();
    expect(() => verifyCleanAccountEvidence({ ...valid, architecture: "universal" })).toThrow("approved architecture");
    expect(() => verifyCleanAccountEvidence({ ...valid, capabilityFamilies: valid.capabilityFamilies.slice(0, -1) })).toThrow("capability families");
  });
});
