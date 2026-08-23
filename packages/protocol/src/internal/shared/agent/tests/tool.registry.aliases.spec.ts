import { describe, expect, test } from "bun:test";

import { createToolRegistry } from "../tool.registry.js";
import type { ToolDeps } from "../tool.helpers.js";

/**
 * Surface-aware tool registry (IND-596/597/598, IND-373).
 *
 * `scrape_url` remains REST/chat-only. Retired contact/import names never
 * resolve on either surface.
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

const REST_ONLY_TOOLS: readonly string[] = [
  "scrape_url",
];

describe("tool registry surface profiles", () => {
  const restRegistry = createToolRegistry(makeDeps());
  const mcpRegistry = createToolRegistry(makeDeps(), { surface: "mcp" });

  test("default (REST) profile retains REST-only tools", () => {
    for (const name of REST_ONLY_TOOLS) {
      expect(restRegistry.get(name), `REST profile must retain ${name}`).toBeDefined();
    }
  });

  test("MCP profile omits every REST-only tool", () => {
    for (const name of REST_ONLY_TOOLS) {
      expect(mcpRegistry.get(name), `MCP profile must omit ${name}`).toBeUndefined();
    }
  });

  test("retired contact and import names never resolve", () => {
    for (const name of ["list_contacts", "remove_contact", "search_contacts", "import_contacts", "add_contact", "import_gmail_contacts"]) {
      expect(restRegistry.get(name), `REST must omit ${name}`).toBeUndefined();
      expect(mcpRegistry.get(name), `MCP must omit ${name}`).toBeUndefined();
    }
  });

  test("research_profile remains available on both surfaces", () => {
    expect(restRegistry.get("research_profile"), "REST must keep research_profile").toBeDefined();
    expect(mcpRegistry.get("research_profile"), "MCP must keep research_profile").toBeDefined();
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
