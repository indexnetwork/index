import { describe, it, expect, beforeEach, mock } from "bun:test";
import { z } from "zod";

import { requestContext } from "../../shared/observability/request-context.js";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

let generatedInputs: string[] = [];

mock.module("../enrichment.generator.js", () => ({
  EnrichmentGenerator: class {
    async invoke(input: string) {
      generatedInputs.push(input);
      return {
        output: {
          identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
          narrative: { context: "Alice builds tools." },
          attributes: { skills: ["TypeScript"], interests: ["agents"] },
        },
      };
    }
  },
}));

const { createEnrichmentTools } = await import("../enrichment.tools.js");

interface CapturedTool {
  name: string;
  description: string;
  querySchema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: CapturedTool) => {
    toolDefs.push(def);
    return def;
  };
  createEnrichmentTools(defineTool as unknown as Parameters<typeof createEnrichmentTools>[0], deps);
  return toolDefs;
}

function parseToolResult(text: string) {
  return JSON.parse(text) as { success: boolean; data?: Record<string, unknown>; error?: string };
}

describe("onboarding privacy profile tools", () => {
  let updateUser: ReturnType<typeof mock>;
  let saveProfile: ReturnType<typeof mock>;
  let setUserSocials: ReturnType<typeof mock>;
  let enricher: ReturnType<typeof mock>;
  let profileGraphInvoke: ReturnType<typeof mock>;
  let tools: CapturedTool[];
  let onboarding: ResolvedToolContext["user"]["onboarding"];
  let currentUser: ResolvedToolContext["user"];
  let currentProfile: Record<string, unknown> | null;
  let activeIntents: Array<{ id: string; payload: string; summary: string | null; createdAt: Date }>;

  const context = (): ResolvedToolContext => ({
    userId: "u1",
    user: { onboarding: onboarding ?? {} },
  } as unknown as ResolvedToolContext);

  beforeEach(() => {
    generatedInputs = [];
    onboarding = {};
    currentProfile = null;
    activeIntents = [];
    currentUser = { id: "u1", name: "Alice", email: "alice@example.com", location: "Healdsburg", intro: null, socials: [], onboarding };
    updateUser = mock(async (data: { onboarding?: typeof onboarding }) => {
      if (data.onboarding) onboarding = data.onboarding;
      currentUser = { ...currentUser, ...data, onboarding };
      return currentUser;
    });
    saveProfile = mock(async (profile: Record<string, unknown>) => {
      currentProfile = profile;
    });
    setUserSocials = mock(async () => {});
    enricher = mock(async () => ({
      confidentMatch: true,
      isHuman: true,
      identity: { name: "Alice", bio: "Enriched bio", location: "Healdsburg" },
      narrative: { context: "Enriched context" },
      attributes: { skills: ["AI"], interests: ["coordination"] },
      socials: {},
    }));
    profileGraphInvoke = mock(async () => ({}));

    tools = captureTools({
      userDb: {
        getUser: async () => ({ ...currentUser, onboarding }),
        updateUser,
        getProfile: async () => currentProfile,
        getActiveIntents: async () => activeIntents,
        saveProfile,
        setUserSocials,
        getUserSocials: async () => [],
      },
      systemDb: {},
      database: {},
      graphs: { profile: { invoke: profileGraphInvoke } },
      enricher: { enrichUserProfile: enricher },
      grantDefaultSystemPermissions: async () => undefined,
    } as unknown as ToolDeps);
  });

  it("preview never enriches nor persists", async () => {
    const tool = tools.find((t) => t.name === "preview_user_context")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { bioOrDescription: "I build AI tools." } }));

    expect(result.success).toBe(true);
    expect(enricher).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(setUserSocials).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview prefers the authenticated account name over an agent-supplied name", async () => {
    currentUser = { ...currentUser, name: "Steven Paul Jobs", email: "steve@apple.com" };
    const tool = tools.find((t) => t.name === "preview_user_context")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { name: "Steve" } }));

    expect(result.success).toBe(true);
    expect(enricher).not.toHaveBeenCalled();
    expect(generatedInputs[0]).toContain("Name: Steven Paul Jobs");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview uses staged signup data", async () => {
    onboarding = {
      profileSeeds: [{
        source: "experiment_signup",
        networkId: "n1",
        capturedAt: "2026-05-29T00:00:00.000Z",
        name: "Seed Alice",
        bio: "Seed bio from signup",
        location: "Seed City",
        socials: [{ label: "github", value: "seedalice" }],
      }],
    };
    const tool = tools.find((t) => t.name === "preview_user_context")!;
    const result = parseToolResult(await tool.handler({ context: { ...context(), networkId: "n1" }, query: {} }));

    expect(result.success).toBe(true);
    expect(generatedInputs[0]).toContain("Name: Seed Alice");
    expect(generatedInputs[0]).toContain("Location: Seed City");
    expect(generatedInputs[0]).toContain("Seed bio from signup");
    expect(generatedInputs[0]).toContain("github: seedalice");
    expect(enricher).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("confirm saves an approved structured draft and sends it through premise decomposition", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_context")!;
    const draft = {
      identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
      narrative: { context: "Alice builds tools." },
      attributes: { skills: ["TypeScript"], interests: ["agents"] },
    };
    const result = parseToolResult(await tool.handler({ context: context(), query: { draft } }));

    expect(result.success).toBe(true);
    // saveProfile now persists a UserIdentity (identity + context), not the legacy draft shape (WS11).
    expect(saveProfile).toHaveBeenCalledWith({ userId: "u1", identity: draft.identity, context: draft.narrative.context });
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(profileGraphInvoke).toHaveBeenCalledTimes(1);
    expect(profileGraphInvoke).toHaveBeenCalledWith({
      userId: "u1",
      operationMode: "write",
      input: [
        "My name is Alice.",
        "I am based in Healdsburg.",
        "Builder",
        "Alice builds tools.",
        "My skills include TypeScript.",
        "My interests include agents.",
      ].join("\n"),
      forceUpdate: true,
    });
    expect(enricher).not.toHaveBeenCalled();
    expect(onboarding?.profileConfirmedAt).toBeDefined();
    expect(onboarding?.currentStep).toBe("first_signal");
  });

  it("confirm schedules draft premise decomposition without blocking MCP callers", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_context")!;
    const draft = {
      identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
      narrative: { context: "Alice builds tools." },
      attributes: { skills: ["TypeScript"], interests: ["agents"] },
    };
    profileGraphInvoke.mockImplementation(() => new Promise(() => {}));

    const result = parseToolResult(await tool.handler({
      context: { ...context(), isMcp: true } as ResolvedToolContext,
      query: { draft },
    }));

    expect(result.success).toBe(true);
    expect(String(result.data?.message)).toContain("background");
    expect(saveProfile).toHaveBeenCalledTimes(1);
    expect(profileGraphInvoke).toHaveBeenCalledTimes(1);
  });

  it("confirming approved text preserves existing location when no correction is supplied", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_context")!;
    const result = parseToolResult(await tool.handler({
      context: context(),
      query: { bioOrDescription: "I build agent tools.", name: "Alice" },
    }));

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledWith({
      name: "Alice",
      intro: "I build agent tools.",
      location: "Healdsburg",
    });
  });

  it("keeps the legacy create_user_context(confirm=true) approval path compatible with the durable marker", async () => {
    profileGraphInvoke.mockResolvedValue({
      profile: {
        identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
        attributes: { skills: ["TypeScript"], interests: ["agents"] },
      },
      agentTimings: [],
    });
    const tool = tools.find((t) => t.name === "create_user_context")!;

    const result = parseToolResult(await tool.handler({ context: context(), query: { confirm: true } }));

    expect(result.success).toBe(true);
    expect(onboarding?.profileConfirmedAt).toBeDefined();
    expect(onboarding?.currentStep).toBe("first_signal");
  });

  it("emits graph_end when background profile generation rejects", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_context")!;
    const events: Array<{ type: string; name: string }> = [];
    profileGraphInvoke.mockImplementation(async () => {
      throw new Error("profile timeout");
    });

    const result = parseToolResult(await requestContext.run(
      { traceEmitter: (event) => events.push({ type: event.type, name: "name" in event ? event.name : "" }) },
      () => tool.handler({ context: context(), query: { bioOrDescription: "I build agent tools." } }),
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.success).toBe(true);
    expect(events).toEqual([
      { type: "graph_start", name: "enrichment" },
      { type: "graph_end", name: "enrichment" },
    ]);
  });

  it("refuses to complete onboarding without the durable approval marker even when getProfile returns a presentation row", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    currentProfile = {
      userId: "u1",
      identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
      context: "Alice builds tools.",
    };
    activeIntents = [{ id: "intent-1", payload: "Looking for collaborators", summary: null, createdAt: new Date("2026-05-29T00:00:00.000Z") }];

    const result = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-1" } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("confirmed profile");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses to complete onboarding without an active intent", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = {
      profileConfirmedAt: "2026-05-29T00:00:00.000Z",
      currentStep: "first_signal",
    };

    const result = parseToolResult(await tool.handler({ context: context(), query: {} }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("active intent");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects an old active intent supplied as the browser recovery ID", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = {
      profileConfirmedAt: "2026-05-29T00:05:00.000Z",
      currentStep: "first_signal",
    };
    activeIntents = [{ id: "intent-old", payload: "An older signal", summary: null, createdAt: new Date("2026-05-29T00:00:00.000Z") }];

    const result = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-old" } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("created before profile confirmation");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("fails closed when the durable profile confirmation timestamp is invalid", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = { profileConfirmedAt: "not-a-timestamp", currentStep: "first_signal" };
    activeIntents = [{ id: "intent-1", payload: "Looking for collaborators", summary: null, createdAt: new Date("2026-05-29T00:10:00.000Z") }];

    const result = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-1" } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("timestamp is invalid");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("completes onboarding for the exact post-confirmation first signal", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = {
      profileConfirmedAt: "2026-05-29T00:00:00.000Z",
      currentStep: "first_signal",
    };
    activeIntents = [{ id: "intent-1", payload: "Looking for collaborators", summary: null, createdAt: new Date("2026-05-29T00:01:00.000Z") }];

    const result = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-1" } }));

    expect(result.success).toBe(true);
    expect(result.data?.intentId).toBe("intent-1");
    expect(onboarding?.completedAt).toBeDefined();
    expect(onboarding?.firstSignalIntentId).toBe("intent-1");
    expect(onboarding?.currentStep).toBe("complete");

    const retry = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-1" } }));
    expect(retry.success).toBe(true);
    expect(retry.data?.intentId).toBe("intent-1");
    expect(retry.data?.completedAt).toBe(onboarding?.completedAt);
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("legacy completion without an ID selects an eligible post-confirmation active intent", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = { profileConfirmedAt: "2026-05-29T00:05:00.000Z", currentStep: "first_signal" };
    activeIntents = [
      { id: "intent-old", payload: "An older signal", summary: null, createdAt: new Date("2026-05-29T00:00:00.000Z") },
      { id: "intent-new", payload: "A new signal", summary: null, createdAt: new Date("2026-05-29T00:06:00.000Z") },
    ];

    const result = parseToolResult(await tool.handler({ context: context(), query: {} }));

    expect(result.success).toBe(true);
    expect(result.data?.intentId).toBe("intent-new");
    expect(onboarding?.firstSignalIntentId).toBe("intent-new");
  });

  it("refuses a different or inactive first-signal ID", async () => {
    const tool = tools.find((t) => t.name === "complete_onboarding")!;
    onboarding = { profileConfirmedAt: "2026-05-29T00:00:00.000Z", currentStep: "first_signal" };
    activeIntents = [{ id: "intent-1", payload: "Looking for collaborators", summary: null, createdAt: new Date("2026-05-29T00:00:00.000Z") }];

    const result = parseToolResult(await tool.handler({ context: context(), query: { intentId: "intent-2" } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("not active for this user");
    expect(updateUser).not.toHaveBeenCalled();
  });
});
