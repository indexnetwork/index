import { describe, expect, test } from "bun:test";

import { createToolRegistry } from "../tool.registry.js";
import type { ToolDeps } from "../tool.helpers.js";

/**
 * Surface-aware tool registry (IND-596/597/598, IND-373).
 *
 * Contact/Gmail-import tools and `scrape_url` remain REST/chat-only. The retired
 * profile/profile-run compatibility aliases are absent from every surface;
 * canonical identity/context and enrichment-run names remain available.
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

const REST_ONLY_TOOLS: readonly string[] = [
  "import_contacts",
  "list_contacts",
  "add_contact",
  "remove_contact",
  "search_contacts",
  "import_gmail_contacts",
  "scrape_url",
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

  test("default (REST) profile retains contact/Gmail tools and scrape_url", () => {
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

  test("read_docs and read_activity_summary stay registered on both surfaces; report_agent_activity retains no alias", () => {
    for (const name of ["read_docs", "read_activity_summary"]) {
      expect(restRegistry.get(name)).toBeDefined();
      expect(mcpRegistry.get(name)).toBeDefined();
    }
    expect(restRegistry.get("report_agent_activity")).toBeUndefined();
    expect(mcpRegistry.get("report_agent_activity")).toBeUndefined();
  });

});
