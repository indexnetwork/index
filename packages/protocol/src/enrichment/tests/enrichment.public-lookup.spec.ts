import { describe, it, expect, mock } from "bun:test";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { EnrichmentResult } from "../../shared/interfaces/enrichment.interface.js";

// Replace the LLM-backed generator BEFORE profile.tools.js is imported.
mock.module("../enrichment.generator.js", () => ({
  EnrichmentGenerator: class {
    async invoke() {
      return {
        output: {
          identity: { name: "Drafted Name", bio: "drafted bio", location: "Remote" },
          narrative: { context: "drafted context" },
          attributes: { skills: [], interests: [] },
        },
        textToEmbed: "embed",
      };
    }
  },
}));

const { createEnrichmentTools } = await import("../enrichment.tools.js");

interface CapturedTool {
  name: string;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: { name: string; handler: CapturedTool["handler"] }) => {
    toolDefs.push({ name: def.name, handler: def.handler });
    return def;
  };
  createEnrichmentTools(defineTool as unknown as Parameters<typeof createEnrichmentTools>[0], deps);
  return toolDefs;
}

function makeEnrichment(overrides: Partial<EnrichmentResult>): EnrichmentResult {
  return {
    identity: { name: "Ada Lovelace", bio: "Founder at Analytical Engines", location: "London" },
    narrative: { context: "Pioneer of computing." },
    attributes: { skills: ["mathematics"], interests: ["computing"] },
    socials: { linkedin: "adalovelace" },
    confidentMatch: true,
    isHuman: true,
    ...overrides,
  };
}

function getCreateUserProfile(deps: ToolDeps): CapturedTool {
  return captureTools(deps).find((t) => t.name === "create_user_context")!;
}

function buildOnboardingDeps(enrichment: EnrichmentResult | null): ToolDeps {
  return {
    userDb: {
      getUser: async () => ({
        id: "test-user",
        name: "Test User",
        email: "test@example.com",
        socials: [],
        onboarding: null,
      }),
      getProfile: async () => null,
      updateUser: async () => ({}),
      getUserSocials: async () => [],
      setUserSocials: async () => {},
    },
    systemDb: {},
    database: {},
    graphs: { profile: { invoke: async () => ({}) } },
    enricher: { enrichUserProfile: async () => enrichment },
    grantDefaultSystemPermissions: async () => undefined,
  } as unknown as ToolDeps;
}

const onboardingContext = {
  userId: "test-user",
  userName: "Test User",
  userEmail: "test@example.com",
  user: { onboarding: null },
} as unknown as ResolvedToolContext;

describe("create_user_context detectedSocials preview", () => {
  it("includes detectedSocials in preview when enrichment finds social handles", async () => {
    const enrichment = makeEnrichment({ socials: { github: "github.com/user", linkedin: "linkedin.com/in/user" } });
    const tool = getCreateUserProfile(buildOnboardingDeps(enrichment));
    const result = await tool.handler({ context: onboardingContext, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.preview).toBe(true);
    expect(parsed.data.detectedSocials).toEqual({ github: "github.com/user", linkedin: "linkedin.com/in/user" });
  });

  it("includes empty detectedSocials when enrichment finds no social handles", async () => {
    const enrichment = makeEnrichment({ socials: {} });
    const tool = getCreateUserProfile(buildOnboardingDeps(enrichment));
    const result = await tool.handler({ context: onboardingContext, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.preview).toBe(true);
    expect(parsed.data.detectedSocials).toEqual({});
  });

  it("returns needsClarification (not a preview) when enrichment is not confident", async () => {
    const enrichment = makeEnrichment({ confidentMatch: false });
    const tool = getCreateUserProfile(buildOnboardingDeps(enrichment));
    const result = await tool.handler({ context: onboardingContext, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.needsClarification).toBe(true);
  });
});
