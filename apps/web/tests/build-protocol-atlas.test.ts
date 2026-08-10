import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PROTOCOL_ATLAS_FILES, publishProtocolAtlas } from "../build-protocol-atlas";

const roots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "protocol-atlas-publish-"));
  roots.push(root);
  return root;
}

function writeSource(sourceDir: string): void {
  mkdirSync(sourceDir, { recursive: true });
  for (const file of PROTOCOL_ATLAS_FILES) {
    writeFileSync(join(sourceDir, file), `canonical:${file}\n`);
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("publishProtocolAtlas", () => {
  test("publishes exactly the canonical allowlist and removes stale output", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "stale.txt"), "stale");

    expect(publishProtocolAtlas({ sourceDir, distDir })).toEqual(PROTOCOL_ATLAS_FILES);
    expect(readdirSync(destination).sort()).toEqual([...PROTOCOL_ATLAS_FILES].sort());
    for (const file of PROTOCOL_ATLAS_FILES) {
      expect(readFileSync(join(destination, file), "utf8")).toBe(`canonical:${file}\n`);
    }
  });

  test("leaves prior output unchanged when a source file is missing", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    rmSync(join(sourceDir, "atlas.css"));
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "index.html"), "prior");

    expect(() => publishProtocolAtlas({ sourceDir, distDir })).toThrow(
      "Missing Protocol Atlas file: atlas.css",
    );
    expect(readFileSync(join(destination, "index.html"), "utf8")).toBe("prior");
    expect(existsSync(join(distDir, ".protocol-atlas-staging"))).toBe(false);
  });

  test("rejects non-file allowlist entries before replacing output", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    writeSource(sourceDir);
    rmSync(join(sourceDir, "atlas.css"));
    mkdirSync(join(sourceDir, "atlas.css"));

    expect(() => publishProtocolAtlas({ sourceDir, distDir })).toThrow(
      "Protocol Atlas source is not a file: atlas.css",
    );
  });

  test("cleans staging and preserves prior output when copying fails", () => {
    const root = fixtureRoot();
    const sourceDir = join(root, "source");
    const distDir = join(root, "dist");
    const destination = join(distDir, "protocol-atlas");
    writeSource(sourceDir);
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "index.html"), "prior");

    expect(() =>
      publishProtocolAtlas({
        sourceDir,
        distDir,
        copyFile(source, destinationPath) {
          if (source.endsWith("atlas.css")) throw new Error("synthetic copy failure");
          writeFileSync(destinationPath, readFileSync(source));
        },
      }),
    ).toThrow("synthetic copy failure");
    expect(readFileSync(join(destination, "index.html"), "utf8")).toBe("prior");
    expect(existsSync(join(distDir, ".protocol-atlas-staging"))).toBe(false);
  });
});
