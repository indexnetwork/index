import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createIntentTools } from "../intent.tools.js";
import type { ToolDeps } from "../../shared/agent/tool.helpers.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

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
    toolDefs.push({ name: def.name, querySchema: def.querySchema, handler: def.handler });
    return def;
  };
  createIntentTools(defineTool as any, deps);
  return toolDefs;
}

describe("search_intents", () => {
  test("accepts query and rejects legacy q", () => {
    const tools = captureTools({
      userDb: { searchOwnIntents: async () => [] },
      graphs: {} as any,
      systemDb: {} as any,
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_intents")!;

    expect(tool.querySchema.safeParse({ query: "React" }).success).toBe(true);
    expect(tool.querySchema.safeParse({ q: "React" }).success).toBe(false);
  });

  test("forwards query + limit and returns rows", async () => {
    const now = new Date("2026-04-14T00:00:00Z");
    let captured: { query: string; limit: number } | null = null;
    const userDb = {
      searchOwnIntents: async (query: string, limit: number) => {
        captured = { query, limit };
        return [
          {
            id: "11111111-1111-4111-8111-111111111111",
            payload: "Looking for React mentorship",
            summary: null,
            createdAt: now,
          },
        ];
      },
    };
    const tools = captureTools({
      userDb,
      graphs: {} as any,
      systemDb: {} as any,
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_intents")!;
    const result = await tool.handler({
      context: makeContext("alice"),
      query: { query: "React", limit: 5 },
    });
    const parsed = JSON.parse(result);
    expect(captured!).toEqual({ query: "React", limit: 5 });
    expect(parsed.success).toBe(true);
    expect(parsed.data.intents[0].payload).toContain("React");
  });

  test("defaults limit to 25", async () => {
    let capturedLimit: number | null = null;
    const userDb = {
      searchOwnIntents: async (_query: string, limit: number) => {
        capturedLimit = limit;
        return [];
      },
    };
    const tools = captureTools({
      userDb,
      graphs: {} as any,
      systemDb: {} as any,
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "search_intents")!;
    await tool.handler({ context: makeContext(), query: { query: "anything" } });
    expect(capturedLimit!).toBe(25);
  });
});
