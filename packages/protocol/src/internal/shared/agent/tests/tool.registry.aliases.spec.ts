import { describe, expect, test } from "bun:test";

import { createToolRegistry } from "../tool.registry.js";
import type { ToolDeps } from "../tool.helpers.js";

/**
 * Surface-aware tool registry (IND-596/597/598, IND-373).
 *
 * Contact/Gmail-import tools, `scrape_url`, and `complete_onboarding` remain
 * REST/chat-only. The retired profile/profile-run compatibility aliases are
 * absent from every surface; canonical identity/context and enrichment-run
 * names remain available.
 */

// create*Tools only DEFINE tools at registration time (handlers are not invoked),
// but a few read nested deps (e.g. deps.graphs.premise) while wiring. A permissive
// deep proxy satisfies any property access without needing a full ToolDeps fixture.
function makeDeps(): ToolDeps {
  const deep: unknown = new Proxy(function () {} as object, {
    get: () => deep,
    apply: () => deep,
  });
  return deep as ToolDeps;
}

const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ["read_user_profiles", "read_user_contexts"],
  ["create_user_profile", "create_user_context"],
  ["update_user_profile", "update_user_context"],
  ["confirm_user_profile", "confirm_user_context"],
  ["preview_user_profile", "preview_user_context"],
  ["get_profile_run", "get_enrichment_run"],
  ["cancel_profile_run", "cancel_enrichment_run"],
];

const REST_ONLY_TOOLS: readonly string[] = [
  "list_contacts",
  "remove_contact",
  "search_contacts",
  "scrape_url",
  "complete_onboarding",
];

// Canonical identity/context + enrichment-run replacements that MUST remain on
// both surfaces.
const CANONICAL_PRESERVED: readonly string[] = [
  "read_user_contexts",
  "create_user_context",
  "update_user_context",
  "confirm_user_context",
  "preview_user_context",
  "get_enrichment_run",
  "cancel_enrichment_run",
];

describe("tool registry surface profiles", () => {
  const restRegistry = createToolRegistry(makeDeps());
  const mcpRegistry = createToolRegistry(makeDeps(), { surface: "mcp" });

  test("default (REST) profile retains contact tools and scrape_url", () => {
    for (const name of REST_ONLY_TOOLS) {
      expect(restRegistry.get(name), `REST profile must retain ${name}`).toBeDefined();
    }
  });

  test("MCP profile omits every REST-only tool", () => {
    for (const name of REST_ONLY_TOOLS) {
      expect(mcpRegistry.get(name), `MCP profile must omit ${name}`).toBeUndefined();
    }
  });

  test("retired profile aliases are absent from every surface", () => {
    for (const [oldName] of ALIASES) {
      expect(restRegistry.get(oldName), `REST profile must omit ${oldName}`).toBeUndefined();
      expect(mcpRegistry.get(oldName), `MCP profile must omit ${oldName}`).toBeUndefined();
    }
  });

  test("MCP profile omits contact tools, and the retired import/add names never resolve", () => {
    for (const name of ["list_contacts", "remove_contact", "search_contacts"]) {
      expect(mcpRegistry.get(name)).toBeUndefined();
    }
    // Retired with the ghost-user path — must not resolve on either surface.
    for (const name of ["import_contacts", "add_contact", "import_gmail_contacts"]) {
      expect(restRegistry.get(name), `REST must omit ${name}`).toBeUndefined();
      expect(mcpRegistry.get(name), `MCP must omit ${name}`).toBeUndefined();
    }
  });

  test("canonical identity/context + enrichment-run tools remain on both surfaces", () => {
    for (const name of CANONICAL_PRESERVED) {
      expect(restRegistry.get(name), `REST must keep ${name}`).toBeDefined();
      expect(mcpRegistry.get(name), `MCP must keep ${name}`).toBeDefined();
    }
  });

  test("read_docs and read_activity_summary stay registered on both surfaces; report_agent_activity retains no alias", () => {
    for (const name of ["read_docs", "read_activity_summary"]) {
      expect(restRegistry.get(name)).toBeDefined();
      expect(mcpRegistry.get(name)).toBeDefined();
    }
    expect(restRegistry.get("report_agent_activity")).toBeUndefined();
    expect(mcpRegistry.get("report_agent_activity")).toBeUndefined();
  });

});
