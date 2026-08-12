import { describe, expect, test } from "vitest";
import { loadMacReleaseMetadata, validateMacReleaseDeliveryUrl } from "../mac-release";

const version = "1.0.0";
const metadataUrl = `https://github.com/indexnetwork/index/releases/download/v${version}/macos-release.json`;
const delivered = "https://release-assets.githubusercontent.com/github-production-release-asset/660333699/fixture?sp=r&sv=2021-08-06&sr=b";
const valid = {
  apiUrl: "https://protocol.index.network", architectures: ["arm64", "x86_64"],
  artifacts: [
    { kind: "app-dmg", name: `Index-macOS-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/Index-macOS-${version}-universal.dmg`, sha256: "a".repeat(64), size: 123 },
    { kind: "connector-dmg", name: `IndexConnector-${version}-universal.dmg`, url: `https://github.com/indexnetwork/index/releases/download/v${version}/IndexConnector-${version}-universal.dmg`, sha256: "b".repeat(64), size: 456 },
  ],
  buildNumber: "7", commit: "c".repeat(40), connectorProtocolVersion: 1,
  minimumMacOS: "13.0", releaseVersion: version, schemaVersion: 1,
  teamId: "LMQ3XNXLAD", webUrl: "https://index.network",
};

describe("immutable GitHub release delivery", () => {
  test("admits only approved HTTPS immutable asset delivery hosts", () => {
    expect(validateMacReleaseDeliveryUrl(delivered).hostname).toBe("release-assets.githubusercontent.com");
    for (const value of [
      metadataUrl,
      "http://release-assets.githubusercontent.com/file",
      "https://user@release-assets.githubusercontent.com/file",
      "https://release-assets.githubusercontent.com:444/file",
      "https://objects.githubusercontent.com/file",
      "https://evil.example/file",
    ]) expect(() => validateMacReleaseDeliveryUrl(value)).toThrow();
  });

  test("follows GitHub redirect but verifies final response authority and immutable metadata", async () => {
    const fetcher = async () => {
      const response = new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: delivered });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    };
    await expect(loadMacReleaseMetadata(metadataUrl, fetcher as typeof fetch)).resolves.toMatchObject({ releaseVersion: version });
    const evil = async () => {
      const response = new Response(JSON.stringify(valid), { status: 200, headers: { "content-type": "application/json" } });
      Object.defineProperty(response, "url", { value: "https://evil.example/file" });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    };
    await expect(loadMacReleaseMetadata(metadataUrl, evil as typeof fetch)).rejects.toThrow("delivery URL");
  });
});
