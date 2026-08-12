/**
 * IND-543 — outer runtime shell boundary fixtures.
 *
 * Focused checks that the four outer shells (runtime/foreground,
 * runtime/background, platform, public) exist with the correct structural
 * contracts and that the capability-boundaries script knows about them.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ALLOWED_CAPABILITY_DIRECTIONS, capabilityForSourcePath } from "../../../scripts/architecture/capability-model.ts";

const sourceRoot = resolve(import.meta.dir, "../..");
const boundaryScript = resolve(sourceRoot, "../scripts/architecture/capability-boundaries.ts");
const coreCapabilities = [
  "signals",
  "participant-context",
  "communities",
  "opportunities",
  "negotiation",
  "questions",
  "participant-agents",
  "contacts",
  "integrations",
] as const;

// ── Shell index existence ─────────────────────────────────────────────────────

describe("runtime/foreground shell", () => {
  test("index.ts re-exports createToolRegistry from composition", async () => {
    const index = await readFile(resolve(sourceRoot, "runtime/foreground/index.ts"), "utf8");
    expect(index).toContain("createToolRegistry");
    expect(index).toContain("./composition/tool.registry.js");
  });

  test("composition/tool.registry.ts is the canonical implementation (no longer shared/agent)", async () => {
    const registry = await readFile(
      resolve(sourceRoot, "runtime/foreground/composition/tool.registry.ts"),
      "utf8",
    );
    // Imports point to shared/agent helpers, not to the old sibling paths
    expect(registry).toContain("../../../shared/agent/tool.helpers.js");
    expect(registry).not.toContain("./tool.helpers.js");
  });

  test("shared/agent/tool.registry.ts is a backward-compat shim only", async () => {
    const shim = await readFile(resolve(sourceRoot, "shared/agent/tool.registry.ts"), "utf8");
    expect(shim).toContain("runtime/foreground/composition/tool.registry.js");
    // A shim should not contain the implementation
    expect(shim).not.toContain("function createToolRegistry");
  });
});

describe("runtime/background shell", () => {
  test("index.ts exists and declares ambient-background boundary", async () => {
    const index = await readFile(resolve(sourceRoot, "runtime/background/index.ts"), "utf8");
    expect(index).toContain("ambient");
  });
});

describe("platform shell", () => {
  test("index.ts exists and re-exports cross-domain primitives", async () => {
    const index = await readFile(resolve(sourceRoot, "platform/index.ts"), "utf8");
    expect(index).toContain("getModelName");
    expect(index).toContain("requestContext");
    expect(index).toContain("setLoggerFactory");
    expect(index).toContain("invokeToolRuntime");
  });

  test("platform/index.ts does not import capability internals", async () => {
    const index = await readFile(resolve(sourceRoot, "platform/index.ts"), "utf8");
    // Must never reach into domain implementation directories
    const forbiddenPatterns = [
      /\.\.\/(?:enrichment|intent|network|opportunity|negotiation|questioner|chat|agent|contact|contacts|integration|integrations|premise|context|maintenance)\//,
    ];
    for (const pattern of forbiddenPatterns) {
      expect(index).not.toMatch(pattern);
    }
  });
});

describe("public shell", () => {
  test("index.ts exists and declares public-compatibility boundary", async () => {
    const index = await readFile(resolve(sourceRoot, "public/index.ts"), "utf8");
    expect(index).toContain("public-compatibility");
  });

  test("src/index.ts remains the sole supported package entry", async () => {
    // The public shell must not be listed as an entry in package.json exports
    const pkg = await readFile(resolve(sourceRoot, "../package.json"), "utf8");
    const parsed = JSON.parse(pkg) as Record<string, unknown>;
    const exports = parsed["exports"] as Record<string, unknown> | undefined;
    if (exports) {
      // Only "." or "./dist/index.js" patterns are allowed; public/ must not appear
      for (const key of Object.keys(exports)) {
        expect(key).not.toContain("public");
        expect(key).not.toContain("runtime/");
        expect(key).not.toContain("platform");
      }
    }
  });
});

// ── Boundary script awareness ─────────────────────────────────────────────────

describe("capability-boundaries script classifies outer shells", () => {
  test("classifies runtime/foreground as interaction-composition", () => {
    expect(capabilityForSourcePath("runtime/foreground/index.ts")).toBe(
      "interaction-composition",
    );
  });

  test("classifies runtime/background as ambient-background with core capability directions", () => {
    expect(capabilityForSourcePath("runtime/background/index.ts")).toBe(
      "ambient-background",
    );
    expect(ALLOWED_CAPABILITY_DIRECTIONS["ambient-background"]).toEqual([
      ...coreCapabilities,
    ]);
  });

  test("classifies platform as neutral-platform with no allowed directions", () => {
    const capability = capabilityForSourcePath("platform/index.ts");
    expect(capability).toBe("neutral-platform");
    expect(ALLOWED_CAPABILITY_DIRECTIONS["neutral-platform"]).toEqual([]);
  });

  test("classifies public as public-compatibility with facade-only directions", () => {
    const capability = capabilityForSourcePath("public/index.ts");
    expect(capability).toBe("public-compatibility");
    expect(ALLOWED_CAPABILITY_DIRECTIONS["public-compatibility"]).toEqual([
      ...coreCapabilities,
      "interaction-composition",
    ]);
  });

  test("retains actionable boundary violation messages", async () => {
    const script = await readFile(boundaryScript, "utf8");
    expect(script).toContain("direct implementation imports");
    expect(script).toContain("root exports must use a capability facade");
  });
});

// ── mcp.server imports canonical registry, not shared/agent shim ──────────────

describe("mcp.server direct import", () => {
  test("mcp.server.ts imports createToolRegistry from runtime/foreground/composition", async () => {
    const server = await readFile(resolve(sourceRoot, "mcp/mcp.server.ts"), "utf8");
    expect(server).toContain("runtime/foreground/composition/tool.registry.js");
    expect(server).not.toContain("shared/agent/tool.registry");
  });
});
