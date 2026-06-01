import { describe, it, expect, beforeEach, mock } from "bun:test";
import { z } from "zod";

import { requestContext } from "../../shared/observability/request-context.js";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

let generatedInputs: string[] = [];

mock.module("../profile.generator.js", () => ({
  ProfileGenerator: class {
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

const { createProfileTools } = await import("../profile.tools.js");

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
  createProfileTools(defineTool as unknown as Parameters<typeof createProfileTools>[0], deps);
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

  const context = (): ResolvedToolContext => ({
    userId: "u1",
    user: { onboarding: onboarding ?? {} },
  } as unknown as ResolvedToolContext);

  beforeEach(() => {
    generatedInputs = [];
    onboarding = {};
    currentUser = { id: "u1", name: "Alice", email: "alice@example.com", location: "Healdsburg", intro: null, socials: [], onboarding };
    updateUser = mock(async (data: { onboarding?: typeof onboarding }) => {
      if (data.onboarding) onboarding = data.onboarding;
      currentUser = { ...currentUser, ...data, onboarding };
      return currentUser;
    });
    saveProfile = mock(async () => {});
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
        getProfile: async () => null,
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

  it("records one onboarding privacy consent decision without completing onboarding", async () => {
    const tool = tools.find((t) => t.name === "record_onboarding_privacy_consent")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { edgeosImportGranted: true, source: "agentvillage_onboarding" } }));

    expect(result.success).toBe(true);
    expect(updateUser).toHaveBeenCalledTimes(1);
    expect(onboarding?.completedAt).toBeUndefined();
    expect(onboarding?.privacy?.edgeosImport?.granted).toBe(true);
    expect(onboarding?.privacy?.publicProfileLookup).toBeUndefined();
  });

  it("rejects combined EdgeOS and public lookup consent decisions", async () => {
    const tool = tools.find((t) => t.name === "record_onboarding_privacy_consent")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { edgeosImportGranted: true, publicProfileLookupGranted: false, source: "agentvillage_onboarding" } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("separately");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("records onboarding privacy consent without dropping persisted onboarding fields", async () => {
    onboarding = { flow: 2, currentStep: "connections" };
    const tool = tools.find((t) => t.name === "record_onboarding_privacy_consent")!;
    const staleContext = { ...context(), user: { onboarding: {} } } as ResolvedToolContext;
    const result = parseToolResult(await tool.handler({ context: staleContext, query: { edgeosImportGranted: true, source: "agentvillage_onboarding" } }));

    expect(result.success).toBe(true);
    expect(onboarding?.flow).toBe(2);
    expect(onboarding?.currentStep).toBe("connections");
    expect(onboarding?.privacy?.edgeosImport?.granted).toBe(true);
  });

  it("normalizes invalid consent source values", async () => {
    const tool = tools.find((t) => t.name === "record_onboarding_privacy_consent")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { edgeosImportGranted: true, source: "bogus_source" } }));

    expect(result.success).toBe(true);
    expect(onboarding?.privacy?.edgeosImport?.source).toBe("api");
  });

  it("preview without public lookup neither enriches nor persists", async () => {
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { bioOrDescription: "I build AI tools.", allowPublicLookup: false } }));

    expect(result.success).toBe(true);
    expect(enricher).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(setUserSocials).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview with EdgeOS data refuses when persisted import consent is absent", async () => {
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { edgeosProfileText: "Alice joined from an EdgeOS event.", allowPublicLookup: false } }));

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain("EdgeOS import consent");
    expect(enricher).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview with public lookup refuses when persisted consent is absent", async () => {
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { bioOrDescription: "I build AI tools.", allowPublicLookup: true } }));

    expect(result.success).toBe(false);
    expect(enricher).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview with public lookup prefers authenticated identity over agent-supplied name", async () => {
    onboarding = {
      privacy: {
        publicProfileLookup: {
          granted: true,
          decidedAt: "2026-05-29T00:00:00.000Z",
          source: "agentvillage_onboarding",
        },
      },
    };
    currentUser = { ...currentUser, name: "Steven Paul Jobs", email: "steve@apple.com" };
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { name: "Steve", allowPublicLookup: true } }));

    expect(result.success).toBe(true);
    expect(enricher).toHaveBeenCalledTimes(1);
    const enrichmentRequest = enricher.mock.calls[0][0] as Record<string, unknown>;
    expect(enrichmentRequest.name).toBe("Steven Paul Jobs");
    expect(enrichmentRequest.email).toBe("steve@apple.com");
    expect(generatedInputs[0]).toContain("Name: Steven Paul Jobs");
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview uses EdgeOS data after import consent is recorded", async () => {
    onboarding = {
      privacy: {
        edgeosImport: {
          granted: true,
          decidedAt: "2026-05-29T00:00:00.000Z",
          source: "agentvillage_onboarding",
        },
      },
    };
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: context(), query: { edgeosProfileText: "Alice joined from an EdgeOS event.", allowPublicLookup: false } }));

    expect(result.success).toBe(true);
    expect(enricher).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("preview uses staged signup data only after EdgeOS import consent", async () => {
    onboarding = {
      privacy: {
        edgeosImport: {
          granted: true,
          decidedAt: "2026-05-29T00:00:00.000Z",
          source: "agentvillage_onboarding",
        },
      },
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
    const tool = tools.find((t) => t.name === "preview_user_profile")!;
    const result = parseToolResult(await tool.handler({ context: { ...context(), networkId: "n1" }, query: { allowPublicLookup: false } }));

    expect(result.success).toBe(true);
    expect(generatedInputs[0]).toContain("Name: Seed Alice");
    expect(generatedInputs[0]).toContain("Location: Seed City");
    expect(generatedInputs[0]).toContain("Seed bio from signup");
    expect(generatedInputs[0]).toContain("github: seedalice");
    expect(enricher).not.toHaveBeenCalled();
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("confirm saves an approved structured draft", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_profile")!;
    const draft = {
      identity: { name: "Alice", bio: "Builder", location: "Healdsburg" },
      narrative: { context: "Alice builds tools." },
      attributes: { skills: ["TypeScript"], interests: ["agents"] },
    };
    const result = parseToolResult(await tool.handler({ context: context(), query: { draft } }));

    expect(result.success).toBe(true);
    expect(saveProfile).toHaveBeenCalledWith({ ...draft, userId: "u1" });
    expect(enricher).not.toHaveBeenCalled();
  });

  it("confirming approved text preserves existing location when no correction is supplied", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_profile")!;
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

  it("emits graph_end when background profile generation rejects", async () => {
    const tool = tools.find((t) => t.name === "confirm_user_profile")!;
    const events: Array<{ type: string; name: string }> = [];
    profileGraphInvoke.mockImplementation(async () => {
      throw new Error("profile timeout");
    });

    const result = parseToolResult(await requestContext.run(
      { traceEmitter: (event) => events.push({ type: event.type, name: event.name }) },
      () => tool.handler({ context: context(), query: { bioOrDescription: "I build agent tools." } }),
    ));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.success).toBe(true);
    expect(events).toEqual([
      { type: "graph_start", name: "profile" },
      { type: "graph_end", name: "profile" },
    ]);
  });
});
