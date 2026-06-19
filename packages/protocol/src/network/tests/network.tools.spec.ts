import { describe, expect, test } from "bun:test";
import { createNetworkTools } from "../network.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-1"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createNetworkTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

const PUBLIC_NETWORKS = [
  { networkId: "net-1", title: "AI Hub", prompt: "AI community", memberCount: 5, owner: null },
  { networkId: "net-2", title: "DeSci", prompt: "DeSci community", memberCount: 3, owner: null },
];

function makeOnboardingContext(userId = "user-1"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test", location: "Berlin" } as never,
    userProfile: {
      identity: { bio: "AI researcher", location: "Berlin" },
      attributes: { interests: ["AI"], skills: ["TypeScript"] },
    },
    userNetworks: [],
    isMcp: true,
    isOnboarding: true,
  } as unknown as ResolvedToolContext;
}

const SAMPLE_USER_CONTEXT = "Alice is an AI researcher based in Berlin, interested in AI and skilled in TypeScript.";

describe("read_networks — onboarding orderedNetworkIds", () => {
  const baseDeps = {
    getUserContextText: async () => SAMPLE_USER_CONTEXT,
    graphs: {
      index: {
        invoke: async () => ({
          readResult: {
            memberOf: [],
            owns: [],
            publicNetworks: PUBLIC_NETWORKS,
            stats: { memberOfCount: 0, ownsCount: 0, publicNetworksCount: 2 },
          },
        }),
      },
    },
  };

  test("omits orderedNetworkIds when context.isOnboarding is false", async () => {
    const tool = captureTool("read_networks", baseDeps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );
    expect(result.success).toBe(true);
    expect(result.data.orderedNetworkIds).toBeUndefined();
  });

  test("omits orderedNetworkIds when the user context is empty", async () => {
    const deps = { ...baseDeps, getUserContextText: async () => "" };
    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeOnboardingContext(), query: {} })
    );
    expect(result.success).toBe(true);
    expect(result.data.orderedNetworkIds).toBeUndefined();
  });

  test("omits orderedNetworkIds when networkRanker returns null", async () => {
    const deps = { ...baseDeps, networkRanker: async () => null };
    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeOnboardingContext(), query: {} })
    );
    expect(result.success).toBe(true);
    expect(result.data.orderedNetworkIds).toBeUndefined();
  });

  test("includes normalized orderedNetworkIds when networkRanker returns ranking", async () => {
    const deps = {
      ...baseDeps,
      networkRanker: async () => ({ rankedNetworkIds: ["net-2", "net-1", "net-unknown"] }),
    };
    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeOnboardingContext(), query: {} })
    );
    expect(result.success).toBe(true);
    // "net-unknown" filtered out; both input IDs present in ranked order
    expect(result.data.orderedNetworkIds).toEqual(["net-2", "net-1"]);
  });
});

describe("read_networks — field naming", () => {
  test("memberOf entries expose prompt not description", async () => {
    const deps = {
      graphs: {
        index: {
          invoke: async () => ({
            readResult: {
              memberOf: [{ networkId: "net-1", title: "AI Founders", prompt: "AI/ML co-founders in Berlin", autoAssign: false, isPersonal: false, joinedAt: new Date() }],
              owns: [],
              stats: { memberOfCount: 1, ownsCount: 0 },
            },
          }),
        },
      },
    };

    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );

    expect(result.success).toBe(true);
    const network = result.data.memberOf[0];
    expect(network.prompt).toBe("AI/ML co-founders in Berlin");
    expect(network.description).toBeUndefined();
  });

  test("owns entries expose prompt not description", async () => {
    const deps = {
      graphs: {
        index: {
          invoke: async () => ({
            readResult: {
              memberOf: [],
              owns: [{ networkId: "net-2", title: "My Index", prompt: "For my contacts", memberCount: 3, intentCount: 5, joinPolicy: "invite_only" }],
              stats: { memberOfCount: 0, ownsCount: 1 },
            },
          }),
        },
      },
    };

    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );

    expect(result.success).toBe(true);
    const network = result.data.owns[0];
    expect(network.prompt).toBe("For my contacts");
    expect(network.description).toBeUndefined();
  });

  test("publicNetworks entries expose prompt not description", async () => {
    const deps = {
      graphs: {
        index: {
          invoke: async () => ({
            readResult: {
              memberOf: [],
              owns: [],
              publicNetworks: [{ networkId: "net-3", title: "Public Hub", prompt: "Open community", memberCount: 10, owner: null }],
              stats: { memberOfCount: 0, ownsCount: 0, publicNetworksCount: 1 },
            },
          }),
        },
      },
    };

    const tool = captureTool("read_networks", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-1"), query: {} })
    );

    expect(result.success).toBe(true);
    const network = result.data.publicNetworks[0];
    expect(network.prompt).toBe("Open community");
    expect(network.description).toBeUndefined();
  });
});
