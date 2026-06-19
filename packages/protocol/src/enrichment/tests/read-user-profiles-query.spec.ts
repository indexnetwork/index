import { describe, expect, test } from "bun:test";
import { createEnrichmentTools } from "../enrichment.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "viewer-111"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Viewer", email: "v@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    isOnboarding: false,
    hasName: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "read_user_contexts") captured = def; return def; };
  createEnrichmentTools(defineTool as any, deps);
  return captured!;
}

describe("read_user_contexts — query mode resilience", () => {
  test("returns partial results when getProfile throws for one member", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getMembersFromScope: async () => [
          { userId: "good-user", name: "Alice Smith", avatar: null },
          { userId: "bad-user",  name: "Alice Jones", avatar: null },
        ],
        // Throws for bad-user (e.g. fragmented identity), succeeds for good-user
        getProfile: async (userId: string) => {
          if (userId === "bad-user") throw new Error("Access denied: no shared index with user");
          return {
            identity: { name: "Alice Smith", bio: "Engineer", location: "NYC" },
            attributes: { skills: ["TypeScript"], interests: ["AI"] },
          };
        },
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: undefined,
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { query: "alice" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.profiles).toHaveLength(2);

    const good = result.data.profiles.find((p: any) => p.userId === "good-user");
    expect(good.hasProfile).toBe(true);
    // Flat list entry (WS11): identity fields inline, no nested `profile` object.
    expect(good).not.toHaveProperty("profile");
    expect(good.bio).toBe("Engineer");
    // WS6: list results are thin identity only — retired attributes must not leak.
    expect(good).not.toHaveProperty("skills");
    expect(good).not.toHaveProperty("interests");

    const bad = result.data.profiles.find((p: any) => p.userId === "bad-user");
    expect(bad.hasProfile).toBe(false);
    expect(bad).not.toHaveProperty("profile");
    expect(bad.bio).toBeUndefined();
  });

  test("returns empty profiles array when no name matches", async () => {
    const deps = {
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getMembersFromScope: async () => [
          { userId: "user-a", name: "Bob Brown", avatar: null },
        ],
        getProfile: async () => null,
      },
      database: {},
      graphs: { profile: { invoke: async () => ({}) } },
      enricher: {},
      grantDefaultSystemPermissions: undefined,
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { query: "alice" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.matchCount).toBe(0);
    expect(result.data.profiles).toHaveLength(0);
  });
});
