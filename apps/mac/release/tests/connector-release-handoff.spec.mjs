import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const release = resolve(root, "apps/mac/release");
const generator = join(release, "generate-connector-release-metadata.ts");
const signer = readFileSync(join(release, "sign-connector-release-metadata.sh"), "utf8");
const workflow = readFileSync(join(root, ".github/workflows/mac-production-release.yml"), "utf8");
const pluginTransport = readFileSync(join(root, "packages/hermes-plugin/connector_transport.py"), "utf8");

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "connector-release-handoff-"));
  const connector = join(directory, "IndexConnector");
  const output = join(directory, "connector-release.json");
  writeFileSync(connector, "signed connector bytes");
  return { directory, connector, output };
}

describe("protected connector release handoff", () => {
  test("canonical metadata exactly matches the plugin's closed trust contract", () => {
    const f = fixture();
    try {
      const run = Bun.spawnSync(["bun", generator, f.connector, f.output]);
      expect(run.exitCode, run.stderr.toString()).toBe(0);
      const metadata = JSON.parse(readFileSync(f.output, "utf8"));
      expect(Object.keys(metadata).sort()).toEqual([
        "bundleId", "connectorProtocolVersion", "designatedRequirement", "downloadUrl",
        "schemaVersion", "sha256", "teamId",
      ]);
      expect(metadata).toEqual({
        bundleId: "network.index.connector",
        connectorProtocolVersion: 1,
        designatedRequirement: 'anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD" and identifier "network.index.connector"',
        downloadUrl: "https://index.network/download",
        schemaVersion: 1,
        sha256: new Bun.CryptoHasher("sha256").update("signed connector bytes").digest("hex"),
        teamId: "LMQ3XNXLAD",
      });
      expect(pluginTransport).toContain('"schemaVersion", "teamId", "bundleId", "designatedRequirement"');
      expect(Bun.spawnSync(["bun", generator, f.connector, f.output]).exitCode).not.toBe(0);
    } finally { rmSync(f.directory, { recursive: true, force: true }); }
  });

  test("protected workflow creates CMS and digest as non-public handoff artifacts", () => {
    expect(signer).toContain("generate-connector-release-metadata.ts");
    expect(signer).toMatch(/security cms -S/);
    expect(signer).toContain("verify_opaque_cms_signer");
    expect(signer).toContain("shasum -a 256");
    expect(readFileSync(join(release, "build-release.sh"), "utf8")).toContain("sign-connector-release-metadata.sh");
    expect(workflow).toContain("verify-plugin-handoff");
    expect(workflow).toContain("connector-release.cms");
    expect(workflow).toContain("connector-release.cms.sha256");
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("retention-days: 1");
    expect(workflow).not.toMatch(/gh release create[^\n]*connector-release\.cms/);
  });

  test("source package remains fail-closed until reviewed CMS bytes are committed separately", () => {
    expect(existsSync(join(root, "packages/hermes-plugin/connector-release.cms"))).toBe(false);
    expect(pluginTransport).toContain("PINNED_CONNECTOR_RELEASE_CMS_SHA256: str | None = None");
  });
});
