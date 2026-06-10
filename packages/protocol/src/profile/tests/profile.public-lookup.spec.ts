import { describe, it, expect, mock, beforeEach } from "bun:test";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { EnrichmentResult } from "../../shared/interfaces/enrichment.interface.js";

// Replace the LLM-backed generator BEFORE profile.tools.js is imported.
let lastGeneratorInput: string | undefined;
mock.module("../profile.generator.js", () => ({
  ProfileGenerator: class {
    async invoke(input: string) {
      lastGeneratorInput = input;
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

const { createProfileTools } = await import("../profile.tools.js");

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
  createProfileTools(defineTool as unknown as Parameters<typeof createProfileTools>[0], deps);
  return toolDefs;
}

const baseContext = {
  userId: "test-user",
  userName: "Test User",
  userEmail: "test@example.com",
  user: { onboarding: { privacy: { publicProfileLookup: { granted: true } } } },
} as unknown as ResolvedToolContext;

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

function buildDeps(enrichment: EnrichmentResult | null): ToolDeps {
  return {
    userDb: {
      getUser: async () => ({
        id: "test-user",
        name: "Test User",
        email: "test@example.com",
        socials: [],
        onboarding: { privacy: { publicProfileLookup: { granted: true } } },
      }),
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

function getPreview(deps: ToolDeps): CapturedTool {
  return captureTools(deps).find((t) => t.name === "preview_user_profile")!;
}

describe("preview_user_profile publicLookup block", () => {
  beforeEach(() => { lastGeneratorInput = undefined; });

  it("reports used:false when no public lookup runs", async () => {
    const preview = getPreview(buildDeps(null));
    const result = await preview.handler({
      context: baseContext,
      query: { bioOrDescription: "I build things", allowPublicLookup: false },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    const { data } = parsed;
    expect(data.publicLookup).toEqual({ used: false });
  });

  it("surfaces looked-up identity + confidentMatch when lookup is confident", async () => {
    const enrichment = makeEnrichment({ confidentMatch: true });
    const preview = getPreview(buildDeps(enrichment));
    const result = await preview.handler({
      context: baseContext,
      query: { bioOrDescription: "I build things", allowPublicLookup: true },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    const { data } = parsed;
    expect(data.publicLookup.used).toBe(true);
    expect(data.publicLookup.confidentMatch).toBe(true);
    expect(data.publicLookup.identity).toEqual({
      name: "Ada Lovelace",
      role: "Founder at Analytical Engines",
      location: "London",
    });
    expect(data.publicLookup.socials).toEqual({ linkedin: "adalovelace" });
    expect(lastGeneratorInput).toContain("Founder at Analytical Engines");
  });

  it("never feeds not-confident lookup facts into the draft (load-bearing gate)", async () => {
    const enrichment = makeEnrichment({
      confidentMatch: false,
      identity: { name: "Wrong Person", bio: "Unrelated wrong-person bio", location: "Nowhere" },
    });
    const preview = getPreview(buildDeps(enrichment));
    const result = await preview.handler({
      context: baseContext,
      query: { bioOrDescription: "I build things", allowPublicLookup: true },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    const { data } = parsed;
    expect(data.publicLookup.used).toBe(true);
    expect(data.publicLookup.confidentMatch).toBe(false);
    expect(lastGeneratorInput).not.toContain("Unrelated wrong-person bio");
    expect(lastGeneratorInput).not.toContain("Enriched bio");
  });
});

function getCreateUserProfile(deps: ToolDeps): CapturedTool {
  return captureTools(deps).find((t) => t.name === "create_user_profile")!;
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

describe("create_user_profile detectedSocials preview", () => {
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
