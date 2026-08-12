import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../../../..");
const documents = [
  "docs/guides/development-reference.md",
  "docs/release/macos-release-runbook.md",
  "docs/release/macos-clean-account-evidence.md",
];
const verifierInputs = "arm64.json arm64.cms x86_64.json x86_64.cms";
const pinVariables = [
  "INDEX_RELEASE_APPROVAL_CERT_SHA256_ARM64",
  "INDEX_RELEASE_APPROVAL_CERT_SHA256_X86_64",
];

describe("macOS clean-account documentation contract", () => {
  for (const path of documents) {
    test(`${path} documents the authenticated schema-v3 verifier interface`, () => {
      const source = readFileSync(resolve(repoRoot, path), "utf8");
      const normalized = source.replace(/\\\n\s*/g, " ").replace(/\s+/g, " ");

      expect(source).toContain("schema-v3");
      expect(source).not.toContain("schema-v2");
      expect(normalized).toContain(
        `verify-clean-account-evidence.ts --pair ${verifierInputs}`,
      );
      for (const variable of pinVariables) expect(source).toContain(variable);
      expect(source).toMatch(/(?:opaque )?CMS signed|CMS-signed/i);
      expect(source).toMatch(/(?:reviewed|architecture-specific).*certificate pin/i);
    });
  }
});
