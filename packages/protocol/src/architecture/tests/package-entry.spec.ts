/**
 * Package-entry and composition-root invariants.
 *
 * Supersedes the IND-543 outer-shell fixtures. Those shells (runtime/foreground,
 * runtime/background, platform, public) were declaration-only placeholders that
 * nothing imported; they have been removed. What survives from that work is the
 * part that carries weight: src/index.ts is the sole supported entry point, and
 * the tool composition root has exactly one home.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ALLOWED_CAPABILITY_DIRECTIONS, capabilityForSourcePath } from "../../../scripts/architecture/capability-model.ts";

const sourceRoot = resolve(import.meta.dir, "../..");
const boundaryScript = resolve(sourceRoot, "../scripts/architecture/capability-boundaries.ts");

// ── Sole supported entry point ────────────────────────────────────────────────

describe("package entry", () => {
  test("src/index.ts remains the only entry in package.json exports", async () => {
    const pkg = await readFile(resolve(sourceRoot, "../package.json"), "utf8");
    const parsed = JSON.parse(pkg) as Record<string, unknown>;
    const exports = parsed["exports"] as Record<string, unknown> | undefined;
    expect(exports).toBeDefined();
    expect(Object.keys(exports ?? {})).toEqual(["."]);
  });

  test("no removed shell directories reappear as entry points", async () => {
    const pkg = await readFile(resolve(sourceRoot, "../package.json"), "utf8");
    for (const removed of ["public", "platform", "runtime/"]) {
      expect(pkg).not.toContain(`./${removed}`);
    }
  });
});

// ── Single composition root ───────────────────────────────────────────────────

describe("tool composition root", () => {
  test("createToolRegistry is implemented once, in shared/agent", async () => {
    const registry = await readFile(resolve(sourceRoot, "shared/agent/tool.registry.ts"), "utf8");
    expect(registry).toContain("function createToolRegistry");
    // Sibling helpers resolve locally now that the implementation lives here.
    expect(registry).toContain("./tool.helpers.js");
  });

  test("createChatTools is implemented once, in shared/agent", async () => {
    const factory = await readFile(resolve(sourceRoot, "shared/agent/tool.factory.ts"), "utf8");
    expect(factory).toContain("function createChatTools");
    expect(factory).toContain("./tool.helpers.js");
  });

  test("mcp.server consumes the registry from its single home", async () => {
    const server = await readFile(resolve(sourceRoot, "mcp/mcp.server.ts"), "utf8");
    expect(server).toContain("../shared/agent/tool.registry.js");
    expect(server).not.toContain("runtime/");
  });

  test("classifies the composition root as interaction-composition", () => {
    expect(capabilityForSourcePath("shared/agent/tool.registry.ts")).toBe("interaction-composition");
    expect(capabilityForSourcePath("shared/agent/tool.factory.ts")).toBe("interaction-composition");
  });

  test("the composition root may reach every capability", () => {
    expect(ALLOWED_CAPABILITY_DIRECTIONS["interaction-composition"]).toEqual([
      "intents",
      "contexts",
      "networks",
      "opportunities",
      "negotiations",
      "questions",
      "agents",
      "contacts",
      "integrations",
    ]);
  });
});

// ── Boundary script ───────────────────────────────────────────────────────────

describe("capability-boundaries script", () => {
  test("retains actionable boundary violation messages", async () => {
    const script = await readFile(boundaryScript, "utf8");
    expect(script).toContain("import it via");
    expect(script).toContain("root exports must use the capability barrel");
    expect(script).toContain("uses forbidden");
  });
});
