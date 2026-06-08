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
    const { data } = JSON.parse(result);
    expect(data.publicLookup).toEqual({ used: false });
  });

  it("surfaces looked-up identity + confidentMatch when lookup is confident", async () => {
    const enrichment = makeEnrichment({ confidentMatch: true });
    const preview = getPreview(buildDeps(enrichment));
    const result = await preview.handler({
      context: baseContext,
      query: { bioOrDescription: "I build things", allowPublicLookup: true },
    });
    const { data } = JSON.parse(result);
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
    const { data } = JSON.parse(result);
    expect(data.publicLookup.used).toBe(true);
    expect(data.publicLookup.confidentMatch).toBe(false);
    expect(lastGeneratorInput).not.toContain("Unrelated wrong-person bio");
    expect(lastGeneratorInput).not.toContain("Enriched bio");
  });
});
