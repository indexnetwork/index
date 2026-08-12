import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const releaseConfig = resolve(import.meta.dir, "../release-config.sh");
const appPlistPath = resolve(repoRoot, "apps/mac/IndexApp/Info.plist");
const connectorPlistPath = resolve(repoRoot, "apps/mac/IndexConnector/Info.plist");
const mainSwiftPath = resolve(repoRoot, "apps/mac/IndexApp/Sources/main.swift");
const connectorIdentityPath = resolve(
  repoRoot,
  "apps/mac/IndexConnector/Sources/ConnectorIdentity.swift",
);
const connectorMainPath = resolve(
  repoRoot,
  "apps/mac/IndexConnector/Sources/main.swift",
);

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function shell(script, env = {}) {
  return Bun.spawnSync(["bash", "-c", script], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function plistValue(source, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`<key>${escaped}</key>\\s*(?:<string>([^<]*)</string>|<(true|false)/>)`),
  );
  if (!match) throw new Error(`missing plist key ${key}`);
  if (match[2]) return match[2] === "true";
  return match[1];
}

function validateUrl(value) {
  const result = shell(
    'source "$RELEASE_CONFIG"; validate_production_url "$VALUE"',
    { RELEASE_CONFIG: releaseConfig, VALUE: value },
  );
  return result.exitCode === 0
    ? { ok: true }
    : { ok: false, error: result.stderr.toString().trim() };
}

describe("macOS release configuration", () => {
  test("accepts only credential-free immutable production HTTPS origins", () => {
    expect(validateUrl("https://protocol.index.network")).toEqual({ ok: true });
    for (const value of [
      "http://protocol.index.network",
      "https://localhost:3001",
      "https://127.0.0.1:3001",
      "https://dev.index.network",
      "https://staging.index.network",
      "https://user@index.network",
      "https://index.network/",
      "https://index.network:443",
      "https://INDEX.network",
      "https://index.network/path?debug=1",
      "https://index.network/#debug",
    ]) {
      expect(validateUrl(value).ok).toBe(false);
    }
  });

  test("accepts the release version contract and rejects ambiguous versions", () => {
    for (const value of ["1.0.0", "2.3.4", "10.20.30"]) {
      const result = shell(
        'source "$RELEASE_CONFIG"; validate_release_version "$VALUE"',
        { RELEASE_CONFIG: releaseConfig, VALUE: value },
      );
      expect(result.exitCode).toBe(0);
    }
    for (const value of ["", "1", "1.0", "01.0.0", "1.0.0-rc.1", "v1.0.0", "1.0.0\n2.0.0"]) {
      const result = shell(
        'source "$RELEASE_CONFIG"; validate_release_version "$VALUE"',
        { RELEASE_CONFIG: releaseConfig, VALUE: value },
      );
      expect(result.exitCode).not.toBe(0);
    }
  });

  test("writes the complete immutable production identity to both bundle plists", () => {
    const directory = mkdtempSync(join(tmpdir(), "index-release-contract-"));
    temporaryDirectories.push(directory);
    const appPlist = join(directory, "IndexApp.plist");
    const connectorPlist = join(directory, "IndexConnector.plist");
    writeFileSync(appPlist, readFileSync(appPlistPath));
    writeFileSync(connectorPlist, readFileSync(connectorPlistPath));

    const result = shell(
      'source "$RELEASE_CONFIG"; write_release_config "$APP_PLIST" "$CONNECTOR_PLIST"',
      {
        RELEASE_CONFIG: releaseConfig,
        APP_PLIST: appPlist,
        CONNECTOR_PLIST: connectorPlist,
        INDEX_RELEASE_VERSION: "1.0.0",
        INDEX_BUILD_NUMBER: "42",
        INDEX_RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
        INDEX_API_URL: "https://protocol.index.network",
        INDEX_WEB_URL: "https://index.network",
        INDEX_EXPECTED_TEAM_ID: "LMQ3XNXLAD",
        INDEX_CONNECTOR_PROTOCOL_VERSION: "1",
      },
    );
    expect(result.exitCode).toBe(0);

    for (const path of [appPlist, connectorPlist]) {
      const plist = readFileSync(path, "utf8");
      expect(plistValue(plist, "CFBundleShortVersionString")).toBe("1.0.0");
      expect(plistValue(plist, "CFBundleVersion")).toBe("42");
      expect(plistValue(plist, "LSMinimumSystemVersion")).toBe("13.0");
      expect(plistValue(plist, "IndexReleaseChannel")).toBe("production");
      expect(plistValue(plist, "IndexReleaseVersion")).toBe("1.0.0");
      expect(plistValue(plist, "IndexReleaseCommit")).toBe(
        "0123456789abcdef0123456789abcdef01234567",
      );
      expect(plistValue(plist, "IndexAPIURL")).toBe(
        "https://protocol.index.network",
      );
      expect(plistValue(plist, "IndexWebURL")).toBe("https://index.network");
      expect(plistValue(plist, "IndexExpectedTeamID")).toBe("LMQ3XNXLAD");
      expect(plistValue(plist, "IndexConnectorProtocolVersion")).toBe("1");
      expect(plistValue(plist, "IndexDevelopmentBuild")).toBe(false);
    }
  });

  test("fails closed before changing either plist when any production input is invalid", () => {
    const invalidCases = {
      INDEX_RELEASE_VERSION: "1.0.0-rc.1",
      INDEX_BUILD_NUMBER: "0",
      INDEX_RELEASE_COMMIT: "deadbeef",
      INDEX_API_URL: "https://dev.index.network",
      INDEX_WEB_URL: "https://index.network/path",
      INDEX_EXPECTED_TEAM_ID: "OTHERTEAM1",
      INDEX_CONNECTOR_PROTOCOL_VERSION: "0",
    };
    const valid = {
      INDEX_RELEASE_VERSION: "1.0.0",
      INDEX_BUILD_NUMBER: "42",
      INDEX_RELEASE_COMMIT: "0123456789abcdef0123456789abcdef01234567",
      INDEX_API_URL: "https://protocol.index.network",
      INDEX_WEB_URL: "https://index.network",
      INDEX_EXPECTED_TEAM_ID: "LMQ3XNXLAD",
      INDEX_CONNECTOR_PROTOCOL_VERSION: "1",
    };

    for (const [name, value] of Object.entries(invalidCases)) {
      const directory = mkdtempSync(join(tmpdir(), "index-release-invalid-"));
      temporaryDirectories.push(directory);
      const appPlist = join(directory, "IndexApp.plist");
      const connectorPlist = join(directory, "IndexConnector.plist");
      const appOriginal = readFileSync(appPlistPath);
      const connectorOriginal = readFileSync(connectorPlistPath);
      writeFileSync(appPlist, appOriginal);
      writeFileSync(connectorPlist, connectorOriginal);
      const result = shell(
        'source "$RELEASE_CONFIG"; write_release_config "$APP_PLIST" "$CONNECTOR_PLIST"',
        {
          RELEASE_CONFIG: releaseConfig,
          APP_PLIST: appPlist,
          CONNECTOR_PLIST: connectorPlist,
          ...valid,
          [name]: value,
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(readFileSync(appPlist)).toEqual(appOriginal);
      expect(readFileSync(connectorPlist)).toEqual(connectorOriginal);
    }
  });

  test("committed bundles are explicit development templates at the production floor", () => {
    for (const path of [appPlistPath, connectorPlistPath]) {
      const plist = readFileSync(path, "utf8");
      expect(plistValue(plist, "LSMinimumSystemVersion")).toBe("13.0");
      expect(plistValue(plist, "CFBundleShortVersionString")).toBe("1.0.0");
      expect(plistValue(plist, "IndexReleaseChannel")).toBe("development");
      expect(plistValue(plist, "IndexDevelopmentBuild")).toBe(true);
    }
  });

  test("native production configuration has no runtime endpoint or inspection override", () => {
    const mainSwift = readFileSync(mainSwiftPath, "utf8");
    const connectorIdentity = readFileSync(connectorIdentityPath, "utf8");
    const connectorMain = readFileSync(connectorMainPath, "utf8");
    expect(mainSwift).toContain('"IndexAPIURL", production: "https://protocol.index.network"');
    expect(mainSwift).toContain('"IndexWebURL", production: "https://index.network"');
    expect(mainSwift).toContain('requiredBool("IndexDevelopmentBuild")');
    expect(mainSwift).not.toContain('UserDefaults.standard.string(forKey: "API_URL")');
    expect(mainSwift).not.toContain('UserDefaults.standard.string(forKey: "APP_URL")');
    expect(mainSwift).toContain("let developmentBuild = AppConfig.isDevelopmentBuild");
    expect(mainSwift).toMatch(/if developmentBuild \{[\s\S]*developerExtrasEnabled/);
    expect(mainSwift).toMatch(/if developmentBuild \{[\s\S]*isInspectable/);
    expect(connectorIdentity).toContain('"IndexAPIURL", expected: "https://protocol.index.network"');
    expect(connectorIdentity).toContain('"IndexWebURL", expected: "https://index.network"');
    expect(connectorIdentity).toContain('static let apiEnvironment = "production"');
    expect(connectorMain).toContain("ConnectorBuildIdentity.markDevelopmentBuild()");
  });
});
