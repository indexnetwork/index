import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createNetworkTools } from "../network.tools.js";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

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
  createNetworkTools(defineTool as any, deps);
  return toolDefs;
}

describe("network MCP copy", () => {
  test("read_networks description documents owns, publicNetworks, and isPersonal", () => {
    const tools = captureTools({
      graphs: {
        index: { invoke: async () => ({}) },
      },
      userDb: {},
      systemDb: {},
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "read_networks")!;

    expect(tool.description).toContain("`owns`");
    expect(tool.description).toContain("`publicNetworks`");
    expect(tool.description).toContain("`isPersonal`");
    expect(tool.description).not.toContain("`ownerOf`");
  });

  test("delete_network returns Network deleted in the success payload", async () => {
    const tools = captureTools({
      graphs: {
        index: {
          invoke: async () => ({
            mutationResult: { success: true, message: "Network deleted." },
            agentTimings: [],
          }),
        },
      },
      userDb: {},
      systemDb: {},
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "delete_network")!;

    const result = await tool.handler({
      context: makeContext("alice"),
      query: { networkId: "11111111-1111-4111-8111-111111111111" },
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe("Network deleted.");
  });
});
