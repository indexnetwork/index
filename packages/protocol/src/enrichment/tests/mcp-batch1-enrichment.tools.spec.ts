import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createEnrichmentTools } from "../enrichment.tools.js";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

interface CapturedTool {
  name: string;
  description: string;
  querySchema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    toolDefs.push({
      name: def.name,
      description: def.description,
      querySchema: def.querySchema,
      handler: def.handler,
    });
    return def;
  };
  createEnrichmentTools(defineTool as any, deps);
  return toolDefs;
}

describe("update_user_profile MCP copy", () => {
  test("documents the action/details verb interface with examples", () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {},
      database: {},
      graphs: {
        profile: { invoke: async () => ({}) },
      },
      enricher: { enrichUserProfile: async () => null },
      grantDefaultSystemPermissions: async () => undefined,
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "update_user_profile")!;

    expect(tool.description).toContain("`action`");
    expect(tool.description).toContain("`details`");
    expect(tool.description).toContain("add interests");
    expect(tool.description).toContain("set location");
  });
});
