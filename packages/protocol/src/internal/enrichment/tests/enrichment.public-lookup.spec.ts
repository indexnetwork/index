import { describe, it, expect } from "bun:test";

import { createEnrichmentTools } from "../enrichment.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { EnrichmentResult } from "../../../platform/enrichment/ports.js";

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

function getResearchProfile(deps: ToolDeps): CapturedTool {
  return captureTools(deps).find((t) => t.name === "research_profile")!;
}

function buildDeps(enrichment: EnrichmentResult | null): ToolDeps {
  return {
    userDb: {
      getUser: async () => ({ id: "test-user", name: "Test User", email: "test@example.com" }),
      getUserSocials: async () => [],
    },
    enricher: { enrichUserProfile: async () => enrichment },
  } as unknown as ToolDeps;
}

const context = {
  userId: "test-user",
  userName: "Test User",
  userEmail: "test@example.com",
  user: { onboarding: null },
} as unknown as ResolvedToolContext;

describe("research_profile", () => {
  it("returns a suggested profile with mapped socials on a confident human match", async () => {
    const enrichment = makeEnrichment({ socials: { github: "github.com/user", linkedin: "linkedin.com/in/user" } });
    const tool = getResearchProfile(buildDeps(enrichment));
    const result = await tool.handler({ context, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.enriched).toBe(true);
    expect(parsed.data.profile).toEqual({
      name: "Ada Lovelace",
      intro: "Founder at Analytical Engines",
      location: "London",
      socials: [
        { label: "linkedin", value: "linkedin.com/in/user" },
        { label: "github", value: "github.com/user" },
      ],
      avatarUrl: null,
    });
  });

  it("returns no profile when enrichment finds no social handles", async () => {
    const enrichment = makeEnrichment({ socials: {} });
    const tool = getResearchProfile(buildDeps(enrichment));
    const result = await tool.handler({ context, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.enriched).toBe(true);
    expect(parsed.data.profile.socials).toEqual([]);
  });

  it("returns enriched:false when enrichment is not a confident match", async () => {
    const enrichment = makeEnrichment({ confidentMatch: false });
    const tool = getResearchProfile(buildDeps(enrichment));
    const result = await tool.handler({ context, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.enriched).toBe(false);
    expect(parsed.data.profile).toBeNull();
  });

  it("returns enriched:false when the match is not a human", async () => {
    const enrichment = makeEnrichment({ isHuman: false });
    const tool = getResearchProfile(buildDeps(enrichment));
    const result = await tool.handler({ context, query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.enriched).toBe(false);
    expect(parsed.data.profile).toBeNull();
  });
});
