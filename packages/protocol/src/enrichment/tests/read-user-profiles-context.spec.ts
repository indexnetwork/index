import { describe, expect, test } from "bun:test";
import { createEnrichmentTools } from "../enrichment.tools.js";
import type { ResolvedToolContext, ToolDeps } from "../../shared/agent/tool.helpers.js";

function makeContext(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "viewer-1",
    user: { id: "viewer-1", name: "Viewer", email: "v@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...overrides,
  } as unknown as ResolvedToolContext;
}

function captureReadTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => {
    if (def.name === "read_user_profiles") captured = def;
    return def;
  };
  createEnrichmentTools(defineTool as any, deps);
  return captured!;
}

const STRUCTURED_PROFILE = {
  identity: { name: "Ada", bio: "Mathematician.", location: "London" },
  // Legacy structured attributes — these must NOT leak into the response payload.
  attributes: { skills: ["math"], interests: ["engines"] },
};

describe("read_user_profiles — context-derived payload (WS6)", () => {
  test("self read (Mode 1): injects global user_context text, drops skills/interests", async () => {
    const deps = {
      userDb: {},
      systemDb: {},
      database: {},
      graphs: {
        profile: {
          invoke: async () => ({
            // The graph already returns thin identity (no skills/interests).
            readResult: { hasProfile: true, profile: { id: "viewer-1", name: "Ada", bio: "Mathematician.", location: "London" } },
          }),
        },
      },
      enricher: {},
      grantDefaultSystemPermissions: async () => {},
      getUserContextText: async (userId: string) => `GLOBAL CONTEXT for ${userId}`,
    } as unknown as ToolDeps;

    const tool = captureReadTool(deps);
    const res = JSON.parse(await tool.handler({ context: makeContext(), query: {} }));

    expect(res.success).toBe(true);
    expect(res.data.hasProfile).toBe(true);
    // Flat payload (WS11): identity + context live at the top level, no nested `profile`.
    expect(res.data).not.toHaveProperty("profile");
    expect(res.data.context).toBe("GLOBAL CONTEXT for viewer-1");
    expect(res.data).not.toHaveProperty("skills");
    expect(res.data).not.toHaveProperty("interests");
  });

  test("self read tolerates getUserContextText being unset (optional dep)", async () => {
    const deps = {
      userDb: {},
      systemDb: {},
      database: {},
      graphs: {
        profile: {
          invoke: async () => ({ readResult: { hasProfile: true, profile: { id: "viewer-1", name: "Ada" } } }),
        },
      },
      enricher: {},
      grantDefaultSystemPermissions: async () => {},
      // getUserContextText omitted
    } as unknown as ToolDeps;

    const tool = captureReadTool(deps);
    const res = JSON.parse(await tool.handler({ context: makeContext(), query: {} }));

    expect(res.success).toBe(true);
    expect(res.data).not.toHaveProperty("profile");
    expect(res.data.context).toBe("");
  });

  test("other-user read (Mode 2): returns target's context, drops skills/interests", async () => {
    let askedFor: string | undefined;
    const deps = {
      userDb: {},
      systemDb: {
        getProfile: async () => STRUCTURED_PROFILE,
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: async () => {},
      getUserContextText: async (userId: string) => {
        askedFor = userId;
        return `CONTEXT-${userId}`;
      },
    } as unknown as ToolDeps;

    const tool = captureReadTool(deps);
    // No context.networkId → no scope check; targetUserId differs from caller.
    const res = JSON.parse(await tool.handler({ context: makeContext(), query: { userId: "other-9" } }));

    expect(res.success).toBe(true);
    expect(res.data.hasProfile).toBe(true);
    expect(askedFor).toBe("other-9");
    // Flat payload (WS11): no nested `profile` object.
    expect(res.data).not.toHaveProperty("profile");
    expect(res.data.name).toBe("Ada");
    expect(res.data.bio).toBe("Mathematician.");
    expect(res.data.location).toBe("London");
    expect(res.data.context).toBe("CONTEXT-other-9");
    expect(res.data).not.toHaveProperty("skills");
    expect(res.data).not.toHaveProperty("interests");
  });

  test("name-search list: thin identity only — no skills/interests, no context", async () => {
    let contextCalls = 0;
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getMembersFromScope: async () => [{ userId: "m-1", name: "Ada Lovelace", avatar: null }],
        getProfile: async () => STRUCTURED_PROFILE,
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: async () => {},
      getUserContextText: async (userId: string) => {
        contextCalls++;
        return `CONTEXT-${userId}`;
      },
    } as unknown as ToolDeps;

    const tool = captureReadTool(deps);
    const res = JSON.parse(await tool.handler({ context: makeContext(), query: { query: "ada" } }));

    expect(res.success).toBe(true);
    const entry = res.data.profiles.find((p: any) => p.userId === "m-1");
    // Flat list entry (WS11): identity fields inline, no nested `profile` object.
    expect(entry).not.toHaveProperty("profile");
    expect(entry.bio).toBe("Mathematician.");
    expect(entry.location).toBe("London");
    expect(entry).not.toHaveProperty("skills");
    expect(entry).not.toHaveProperty("context");
    // List mode must not fan out per-member context synthesis.
    expect(contextCalls).toBe(0);
  });
});
