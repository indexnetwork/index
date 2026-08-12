import { describe, expect, test } from "vitest";
import { loadMacReleaseMetadata, macReleaseCmsUrl, parseMacReleaseMetadata, validateMacReleaseMetadataUrl } from "../mac-release";

const version = "1.0.0";
const metadataUrl = `https://github.com/indexnetwork/index/releases/download/v${version}/macos-release.json`;
const valid = {
  apiUrl: "https://protocol.index.network",
  architectures: ["arm64", "x86_64"],
  artifacts: [
    { kind: "app-dmg", name: `Index-macOS-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/Index-macOS-${version}-universal.dmg`, sha256: "a".repeat(64), size: 123 },
    { kind: "connector-dmg", name: `IndexConnector-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/IndexConnector-${version}-universal.dmg`, sha256: "b".repeat(64), size: 456 },
  ],
  buildNumber: "7",
  commit: "c".repeat(40),
  connectorProtocolVersion: 1,
  minimumMacOS: "13.0",
  releaseVersion: version,
  schemaVersion: 1,
  teamId: "LMQ3XNXLAD",
  webUrl: "https://index.network",
};

describe("macOS release publication parser", () => {
  test("accepts only the exact Universal 2 production authority", () => {
    expect(parseMacReleaseMetadata(valid).releaseVersion).toBe(version);
    expect(() => parseMacReleaseMetadata({ ...valid, minimumMacOS: "11.0" })).toThrow("unsupported macOS floor");
    expect(() => parseMacReleaseMetadata({ ...valid, architectures: ["arm64"] })).toThrow("Universal 2 required");
    expect(() => parseMacReleaseMetadata({ ...valid, token: "secret" })).toThrow("unsupported fields");
  });

  test("accepts only immutable first-party release metadata URLs", () => {
    expect(validateMacReleaseMetadataUrl(metadataUrl).toString()).toBe(metadataUrl);
    expect(macReleaseCmsUrl(metadataUrl)).toBe(metadataUrl.replace(".json", ".cms"));
    for (const value of [
      "http://github.com/indexnetwork/index/releases/download/v1.0.0/macos-release.json",
      "https://github.com/indexnetwork/index/releases/latest/download/macos-release.json",
      "https://evil.example/macos-release.json",
      `${metadataUrl}?mutable=1`,
    ]) expect(() => validateMacReleaseMetadataUrl(value)).toThrow();
  });

  test("loads without credentials, cache, or redirects and binds URL tag to metadata", async () => {
    const calls: unknown[] = [];
    const fetcher = async (url: URL, init?: RequestInit) => {
      calls.push([url.toString(), init]);
      return new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } });
    };
    await expect(loadMacReleaseMetadata(metadataUrl, fetcher as typeof fetch)).resolves.toMatchObject({ releaseVersion: version });
    expect(calls).toEqual([[metadataUrl, { cache: "no-store", credentials: "omit", redirect: "error" }]]);
    await expect(loadMacReleaseMetadata(metadataUrl.replace("v1.0.0", "v2.0.0"), fetcher as typeof fetch)).rejects.toThrow("URL/version mismatch");
  });
});
