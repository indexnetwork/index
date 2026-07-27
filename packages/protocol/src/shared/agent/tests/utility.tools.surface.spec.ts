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
    expect(rest.tools.has("read_activity_summary")).toBe(true);
    expect(rest.tools.has("report_agent_activity")).toBe(false);

    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    expect(mcp.tools.has("scrape_url")).toBe(false);
    expect(mcp.tools.has("read_docs")).toBe(true);
    expect(mcp.tools.has("read_activity_summary")).toBe(true);
    expect(mcp.tools.has("report_agent_activity")).toBe(false);
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

  // Canonical MCP read_docs topic inventory (IND-602/603). These are the only
  // topics the canonical guidance source exposes on the MCP surface.
  const CANONICAL_READ_DOCS_TOPICS = [
    "identity-context",
    "premises",
    "signals",
    "communities-networks",
    "opportunities",
    "negotiations",
    "workflows",
  ] as const;

  // Current entity/capability/lifecycle facts each canonical topic must state.
  const CANONICAL_TOPIC_FACTS: Record<(typeof CANONICAL_READ_DOCS_TOPICS)[number], string[]> = {
    "identity-context": ["identity", "context"],
    premises: ["premise"],
    signals: ["signal"],
    "communities-networks": ["community", "network"],
    opportunities: ["opportunity"],
    negotiations: ["negotiation", "owner approval", "A2A"],
    workflows: ["H2A", "A2A"],
  };

  // Retired MCP guidance vocabulary: contact/Gmail/scrape/profile/ghost-user
  // workflows were removed from the MCP surface and must never resurface.
  const RETIRED_GUIDANCE_FRAGMENTS = ["ghost user", "gmail", "scrape", "personal network"];

  test("MCP read_docs (summary + every canonical topic) never advertises any removed name", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    // 'undefined' returns the full summary doc (all sections joined).
    for (const topic of [undefined, ...CANONICAL_READ_DOCS_TOPICS]) {
      const doc = await readDocs(mcp.tools, topic);
      for (const name of ALL_MCP_REMOVED_NAMES) {
        expect(doc, `MCP read_docs(${topic ?? "summary"}) must not mention ${name}`).not.toContain(name);
      }
    }
  });

  test("MCP read_docs summary lists the canonical topic inventory and each topic resolves", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    const summary = await readDocs(mcp.tools);
    for (const topic of CANONICAL_READ_DOCS_TOPICS) {
      expect(summary, `summary must list canonical topic ${topic}`).toContain(topic);
      const doc = await readDocs(mcp.tools, topic);
      expect(doc.length).toBeGreaterThan(0);
      expect(doc).not.toContain("Unknown topic");
    }
  });

  test("MCP read_docs per-topic content states current entity, capability, and lifecycle facts", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    for (const [topic, facts] of Object.entries(CANONICAL_TOPIC_FACTS)) {
      const doc = await readDocs(mcp.tools, topic);
      for (const fact of facts) {
        expect(doc, `read_docs(${topic}) must state ${fact}`).toContain(fact);
      }
    }
  });

  test("MCP read_docs guides H2A and A2A but never exposes H2H", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    const summary = await readDocs(mcp.tools);
    expect(summary).toContain("H2A");
    expect(summary).toContain("A2A");
    for (const topic of [undefined, ...CANONICAL_READ_DOCS_TOPICS]) {
      const doc = await readDocs(mcp.tools, topic);
      expect(doc, `read_docs(${topic ?? "summary"}) must never expose H2H`).not.toContain("H2H");
    }
  });

  test("negotiations guidance distinguishes owner approval from A2A negotiation acceptance", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    const doc = await readDocs(mcp.tools, "negotiations");
    expect(doc).toContain("owner approval");
    expect(doc).toContain("acceptance");
    expect(doc).toContain("is not owner approval");
  });

  test("MCP read_docs never exposes retired contact/Gmail/scrape/profile/ghost-user guidance", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    for (const topic of [undefined, ...CANONICAL_READ_DOCS_TOPICS]) {
      const doc = await readDocs(mcp.tools, topic).then((d) => d.toLowerCase());
      for (const fragment of RETIRED_GUIDANCE_FRAGMENTS) {
        expect(doc, `read_docs(${topic ?? "summary"}) must not mention ${fragment}`).not.toContain(fragment);
      }
    }
  });

  test("read_docs is available pre-registration (no authenticated context required)", async () => {
    const mcp = capture();
    createUtilityTools(mcp.defineTool, stubDeps, { surface: "mcp" });
    // An empty ResolvedToolContext stands in for a caller that has not
    // completed registration/onboarding; guidance must still be served.
    const summary = await readDocs(mcp.tools);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("H2A");
    expect(summary).not.toMatch(/unauthorized|sign in|register first/i);
  });
});
