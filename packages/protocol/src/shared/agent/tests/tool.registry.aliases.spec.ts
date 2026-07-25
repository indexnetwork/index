import { describe, expect, test } from "bun:test";

import { createToolRegistry } from "../tool.registry.js";
import type { ToolDeps } from "../tool.helpers.js";

/**
 * Surface-aware tool registry (IND-596/597/598).
 *
 * `createToolRegistry` exposes two profiles:
 *  - the default `'rest'` profile (direct HTTP Tool API + chat) retains the full
 *    tool set: contact/Gmail-import tools, `scrape_url`, and the deprecated
 *    profile/profile-run compatibility aliases;
 *  - the restricted `'mcp'` profile omits exactly those surfaces while keeping
 *    the canonical identity/context + enrichment-run tools.
 *
 * These tests lock in that split so the removed names can never re-appear on the
 * MCP surface, while the REST/chat surface keeps working unchanged.
 */

// create*Tools only DEFINE tools at registration time (handlers are not invoked),
// but a few read nested deps (e.g. deps.graphs.premise) while wiring. A permissive
// deep proxy satisfies any property access without needing a full ToolDeps fixture.
// `contactsEnabled` is answered explicitly so the contact/Gmail import + manual-add
// tools (which gate on that flag) can be exercised on the REST surface.
function makeDeps(contactsEnabled: boolean): ToolDeps {
  const deep: unknown = new Proxy(function () {} as object, {
    get: (_target, prop) => (prop === "contactsEnabled" ? contactsEnabled : deep),
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

// Every name removed from the MCP surface.
const MCP_REMOVED_TOOLS: readonly string[] = [
  // Contact + Gmail import (IND-596)
  "import_contacts",
  "list_contacts",
  "add_contact",
  "remove_contact",
  "search_contacts",
  "import_gmail_contacts",
  // Scrape (IND-597)
  "scrape_url",
  // Deprecated profile/profile-run aliases (IND-598)
  ...ALIASES.map(([oldName]) => oldName),
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
  const restRegistry = createToolRegistry(makeDeps(true));
  const mcpRegistry = createToolRegistry(makeDeps(true), { surface: "mcp" });

  test("default (REST) profile retains contact/Gmail tools, scrape_url, and aliases", () => {
    for (const name of MCP_REMOVED_TOOLS) {
      expect(restRegistry.get(name), `REST profile must retain ${name}`).toBeDefined();
    }
  });

  test("MCP profile omits every contact/Gmail tool, scrape_url, and deprecated alias", () => {
    for (const name of MCP_REMOVED_TOOLS) {
      expect(mcpRegistry.get(name), `MCP profile must omit ${name}`).toBeUndefined();
    }
  });

  test("MCP profile omits contact/Gmail tools even when CONTACTS_ENABLED is true", () => {
    // CONTACTS_ENABLED must never shape the MCP registry.
    const mcpWithContacts = createToolRegistry(makeDeps(true), { surface: "mcp" });
    for (const name of ["import_contacts", "add_contact", "import_gmail_contacts", "list_contacts"]) {
      expect(mcpWithContacts.get(name)).toBeUndefined();
    }
  });

  test("canonical identity/context + enrichment-run tools remain on both surfaces", () => {
    for (const name of CANONICAL_PRESERVED) {
      expect(restRegistry.get(name), `REST must keep ${name}`).toBeDefined();
      expect(mcpRegistry.get(name), `MCP must keep ${name}`).toBeDefined();
    }
  });

  test("read_docs and report_agent_activity stay registered on both surfaces", () => {
    for (const name of ["read_docs", "report_agent_activity"]) {
      expect(restRegistry.get(name)).toBeDefined();
      expect(mcpRegistry.get(name)).toBeDefined();
    }
  });

  test("REST aliases delegate to the exact same handler + schema as the canonical tool", () => {
    for (const [oldName, canonicalName] of ALIASES) {
      const canonical = restRegistry.get(canonicalName)!;
      const alias = restRegistry.get(oldName)!;
      expect(alias.handler).toBe(canonical.handler);
      expect(alias.schema).toBe(canonical.schema);
      expect(alias.name).toBe(oldName);
      expect(alias.description.startsWith("[DEPRECATED")).toBe(true);
      expect(alias.description).toContain(canonicalName);
    }
  });
});
