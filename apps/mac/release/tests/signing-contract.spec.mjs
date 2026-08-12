import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const signPath = resolve(import.meta.dir, "../sign-bundles.sh");
const verifyPath = resolve(import.meta.dir, "../verify-signatures.sh");
const releaseConfigPath = resolve(import.meta.dir, "../release-config.sh");
const appEntitlementsPath = resolve(repoRoot, "apps/mac/Index.entitlements");
const connectorEntitlementsPath = resolve(repoRoot, "apps/mac/IndexConnector/IndexConnector.entitlements");

function source(path) {
  return readFileSync(path, "utf8");
}

function plistKeys(contents) {
  return [...contents.matchAll(/<key>([^<]+)<\/key>/g)].map((match) => match[1]);
}

const forbiddenEntitlements = [
  "com.apple.security.app-sandbox",
  "com.apple.security.get-task-allow",
  "com.apple.security.cs.allow-jit",
  "com.apple.security.cs.allow-unsigned-executable-memory",
  "com.apple.security.cs.allow-dyld-environment-variables",
  "com.apple.security.cs.disable-library-validation",
];

describe("macOS production signing contract", () => {
  test("commits exact, distinct app and connector entitlement templates", () => {
    const app = source(appEntitlementsPath);
    const connector = source(connectorEntitlementsPath);

    expect(plistKeys(app).sort()).toEqual([
      "com.apple.developer.associated-domains",
      "keychain-access-groups",
    ]);
    expect(app).toContain("applinks:index.network");
    expect(app).toContain("$(AppIdentifierPrefix)network.index.system6.owner-credentials");
    expect(app).not.toContain("network.index.connector.credentials");

    expect(plistKeys(connector)).toEqual(["keychain-access-groups"]);
    expect(connector).toContain("$(AppIdentifierPrefix)network.index.connector.credentials");
    expect(connector).not.toContain("network.index.system6.owner-credentials");

    for (const forbidden of forbiddenEntitlements) {
      expect(app).not.toContain(forbidden);
      expect(connector).not.toContain(forbidden);
    }
  });

  test("requires Developer ID, independently pinned Team ID, runtime, timestamp, and inside-out order", () => {
    const sign = source(signPath);
    const releaseConfig = source(releaseConfigPath);

    expect(releaseConfig).toContain('INDEX_PRODUCTION_TEAM_ID="LMQ3XNXLAD"');
    expect(sign).toContain("sign_inside_out()");
    expect(sign).toMatch(/Developer\\ ID\\ Application:\*/);
    expect(sign).toContain("certificate_team_id");
    expect(sign).toContain("validate_release_profile_plist");
    expect(sign).toContain("IndexExpectedTeamID");
    expect(sign).toContain("INDEX_PRODUCTION_TEAM_ID");
    expect(sign).toContain("--options runtime");
    expect(sign).toContain("--timestamp");
    expect(sign).toContain("find");
    expect(sign).toContain("file");
    expect(sign).not.toMatch(/codesign[^\n]*--deep[^\n]*--sign/);
    expect(sign).not.toMatch(/(?:printf|echo)[^\n]*(?:CODESIGN_IDENTITY|identity)/i);

    const executableSign = sign.indexOf('sign_inside_out "$SIGNED_CONNECTOR_BUNDLE"');
    const connectorBundleSign = sign.indexOf('sign_bundle "$SIGNED_CONNECTOR_BUNDLE"');
    const appBundleSign = sign.indexOf('sign_bundle "$SIGNED_APP_BUNDLE"');
    expect(executableSign).toBeGreaterThan(-1);
    expect(connectorBundleSign).toBeGreaterThan(executableSign);
    expect(appBundleSign).toBeGreaterThan(connectorBundleSign);
  });

  test("verifies every Mach-O, exact requirements, bundle identity, runtime, profiles, and entitlements", () => {
    const verify = source(verifyPath);

    expect(verify).toContain("verify_designated_requirement()");
    expect(verify).toContain("find");
    expect(verify).toContain("file");
    expect(verify).toContain("codesign --verify --strict");
    expect(verify).toContain("flags=");
    expect(verify).toContain("runtime");
    expect(verify).toContain("Authority=Developer ID Application:");
    expect(verify).toContain("Timestamp=");
    expect(verify).toContain("certificate leaf[subject.OU]");
    expect(verify).toContain("INDEX_APP_BUNDLE_ID");
    expect(verify).toContain("INDEX_CONNECTOR_BUNDLE_ID");
    expect(verify).toContain("validate_release_profile_plist");
    expect(verify).toContain("validate_release_entitlements");
    expect(verify).toContain("embedded.provisionprofile");
    expect(verify).toContain("INDEX_PRODUCTION_TEAM_ID");
    expect(verify).not.toMatch(/codesign[^\n]*--deep[^\n]*--sign/);
    if (/codesign[^\n]*--deep/.test(verify)) {
      expect(verify).toMatch(/codesign[^\n]*--verify[^\n]*--deep[^\n]*--strict/);
    }
  });

  test("keeps provider-free tests and execution separated from protected credentials", () => {
    const sign = source(signPath);
    expect(sign).toContain('apps/mac/dist/unsigned');
    expect(sign).toContain('$MAC_DIRECTORY/dist/signed');
    expect(sign).not.toContain("notarytool");
    expect(sign).not.toContain("stapler");
    expect(sign).not.toContain("xcrun notary");
    expect(sign).not.toContain("gh release");
  });
});
