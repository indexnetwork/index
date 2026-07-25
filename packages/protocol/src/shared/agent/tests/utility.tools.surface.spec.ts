import { describe, expect, test } from "bun:test";
import type { z } from "zod";

import { createUtilityTools } from "../utility.tools.js";
import type { DefineTool, ResolvedToolContext } from "../tool.helpers.js";

/**
 * Surface-aware utility tools (IND-596/597).
 *
 * On the restricted MCP surface `scrape_url` is omitted and `read_docs`
 * guidance never advertises the contact/Gmail tools removed from MCP. The
 * default REST/chat surface retains both.
 */

type Captured = {
  description: string;
  schema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
};

function capture() {
  const tools = new Map<string, Captured>();
  const defineTool = ((opts: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    tools.set(opts.name, { description: opts.description, schema: opts.querySchema, handler: opts.handler });
    return null;
  }) as unknown as DefineTool;
  return { tools, defineTool };
}

const stubDeps = { scraper: {}, userDb: {} } as unknown as Parameters<typeof createUtilityTools>[1];

// Contact tool names that appear verbatim in the REST/chat read_docs prose.
const CONTACT_TOOL_NAMES = [
  "import_contacts",
  "add_contact",
  "list_contacts",
  "remove_contact",
  "import_gmail_contacts",
];

// The complete set of 14 names removed from the MCP surface. NONE may appear in
// any MCP read_docs output, even ones (scrape_url, profile aliases) that were
// never in the original prose — this guards against future regressions.
const ALL_MCP_REMOVED_NAMES = [
  "import_contacts",
  "list_contacts",
  "add_contact",
  "remove_contact",
  "search_contacts",
  "import_gmail_contacts",
  "scrape_url",
  "read_user_profiles",
  "create_user_profile",
  "update_user_profile",
  "confirm_user_profile",
  "preview_user_profile",
  "get_profile_run",
  "cancel_profile_run",
];

async function readDocs(tools: Map<string, Captured>, topic?: string): Promise<string> {
  const tool = tools.get("read_docs")!;
  return tool.handler({
    context: {} as ResolvedToolContext,
    query: topic ? { topic } : {},
  });
}

describe("createUtilityTools surface profile", () => {
  test("REST surface registers scrape_url; MCP surface omits it", () => {
    const rest = capture();
    createUtilityTools(rest.defineTool, stubDeps);
    expect(rest.tools.has("scrape_url")).toBe(true);
    expect(rest.tools.has("read_docs")).toBe(true);
    expect(rest.tools.has("report_agent_activity")).toBe(true);

    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    expect(mcp.tools.has("scrape_url")).toBe(false);
    expect(mcp.tools.has("read_docs")).toBe(true);
    expect(mcp.tools.has("report_agent_activity")).toBe(true);
  });

  test("REST read_docs retains contact-tool guidance", async () => {
    const rest = capture();
    createUtilityTools(rest.defineTool, stubDeps);
    const contacts = await readDocs(rest.tools, "contacts");
    const workflows = await readDocs(rest.tools, "workflows");
    for (const name of CONTACT_TOOL_NAMES) {
      expect(contacts + workflows).toContain(name);
    }
  });

  test("MCP read_docs (summary, contacts, workflows) never advertises any removed name", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    // 'undefined' returns the full summary doc (all sections joined).
    for (const topic of [undefined, "contacts", "workflows"]) {
      const doc = await readDocs(mcp.tools, topic);
      for (const name of ALL_MCP_REMOVED_NAMES) {
        expect(doc, `MCP read_docs(${topic ?? "summary"}) must not mention ${name}`).not.toContain(name);
      }
    }
  });

  test("MCP read_docs keeps the contact concept and personal-network guidance", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    const contacts = await readDocs(mcp.tools, "contacts");
    expect(contacts).toContain("Ghost users");
    expect(contacts).toContain("personal network");
  });
});
