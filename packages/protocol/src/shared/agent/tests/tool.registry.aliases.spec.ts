import { describe, expect, test } from "bun:test";

import { createToolRegistry } from "../tool.registry.js";
import type { ToolDeps } from "../tool.helpers.js";

/**
 * IND-371: the canonical *_user_context / *_enrichment_run tool names are the real
 * implementations; the legacy *_user_profile / *_profile_run names are retained as
 * thin DEPRECATED aliases that delegate to the exact same handler. These tests lock
 * in that contract so the aliases cannot silently drift or disappear before IND-373.
 */
describe("deprecated tool-name aliases (IND-371)", () => {
  // create*Tools only DEFINE tools at registration time (handlers are not invoked),
  // but a few read nested deps (e.g. deps.graphs.premise) while wiring. A permissive
  // deep proxy satisfies any property access without needing a full ToolDeps fixture.
  const deepStub: unknown = new Proxy(function () {} as object, {
    get: () => deepStub,
    apply: () => deepStub,
  });
  const registry = createToolRegistry(deepStub as ToolDeps);

  const ALIASES: ReadonlyArray<readonly [string, string]> = [
    ["read_user_profiles", "read_user_contexts"],
    ["create_user_profile", "create_user_context"],
    ["update_user_profile", "update_user_context"],
    ["confirm_user_profile", "confirm_user_context"],
    ["preview_user_profile", "preview_user_context"],
    ["get_profile_run", "get_enrichment_run"],
    ["cancel_profile_run", "cancel_enrichment_run"],
  ];

  test("both the canonical name and its deprecated alias are registered", () => {
    for (const [oldName, canonicalName] of ALIASES) {
      expect(registry.get(canonicalName), `canonical ${canonicalName} must be registered`).toBeDefined();
      expect(registry.get(oldName), `alias ${oldName} must be registered`).toBeDefined();
    }
  });

  test("the alias delegates to the exact same handler + schema as the canonical tool", () => {
    for (const [oldName, canonicalName] of ALIASES) {
      const canonical = registry.get(canonicalName)!;
      const alias = registry.get(oldName)!;
      expect(alias.handler).toBe(canonical.handler);
      expect(alias.schema).toBe(canonical.schema);
      expect(alias.name).toBe(oldName);
    }
  });

  test("the alias description is flagged DEPRECATED and points at the canonical name", () => {
    for (const [oldName, canonicalName] of ALIASES) {
      const alias = registry.get(oldName)!;
      expect(alias.description.startsWith("[DEPRECATED")).toBe(true);
      expect(alias.description).toContain(canonicalName);
    }
  });
});
