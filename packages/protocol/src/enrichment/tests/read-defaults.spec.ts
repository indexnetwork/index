import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createEnrichmentTools } from "../enrichment.tools.js";
import type { ToolDeps } from "../../shared/agent/tool.helpers.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-123",
    user: { id: "user-123", name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...overrides,
  } as ResolvedToolContext;
}

function makeDeps(profileResult: unknown): ToolDeps {
  return {
    userDb: {} as any,
    systemDb: {} as any,
    database: {} as any,
    graphs: {
      profile: {
        invoke: async () => ({ readResult: profileResult }),
      },
    } as any,
    enricher: {} as any,
    grantDefaultSystemPermissions: async () => {},
  } as unknown as ToolDeps;
}

describe("read_user_profiles default-to-self", () => {
  test("no args, no scope → returns caller's own profile via Mode 1", async () => {
    const toolDefs: Array<{ name: string; handler: Function }> = [];
    const defineTool = (def: { name: string; description: string; schema: z.ZodType; handler: Function }) => {
      toolDefs.push({ name: def.name, handler: def.handler });
      return def as any;
    };
    const profileResult = { hasProfile: true, profile: { name: "Alice", bio: "hi" } };
    createEnrichmentTools(defineTool as any, makeDeps(profileResult));
    const readTool = toolDefs.find((t) => t.name === "read_user_profiles");
    expect(readTool).toBeDefined();

    const result = await readTool!.handler({ context: makeContext(), query: {} });
    const parsed = JSON.parse(result as string);
    expect(parsed.success).toBe(true);
    expect(parsed.data.hasProfile).toBe(true);
    // Flat payload (WS11): identity fields inline, no nested `profile` object.
    expect(parsed.data).not.toHaveProperty("profile");
    expect(parsed.data.name).toBe("Alice");
  });
});
