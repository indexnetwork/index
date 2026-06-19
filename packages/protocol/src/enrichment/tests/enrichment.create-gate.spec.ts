import { describe, it, expect, mock } from "bun:test";
import { z } from "zod";

import { createEnrichmentTools } from "../enrichment.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

/**
 * Regression: the onboarding "already exists" gate in create_user_context must
 * key on a real enrichment signal (the global user_context via getUserContextText),
 * NOT userDb.getProfile(). Post-WS11 getProfile() returns a presentation row for
 * EVERY existing user, so gating on it always short-circuited onboarding and
 * refused to enrich.
 */

interface CapturedTool {
  name: string;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureCreateTool(deps: ToolDeps): CapturedTool {
  const defs: Array<{ name: string; querySchema: z.ZodType; handler: CapturedTool["handler"] }> = [];
  const defineTool = (def: { name: string; querySchema: z.ZodType; handler: CapturedTool["handler"] }) => {
    defs.push(def);
    return def;
  };
  createEnrichmentTools(defineTool as unknown as Parameters<typeof createEnrichmentTools>[0], deps);
  return defs.find((t) => t.name === "create_user_context")!;
}

// Onboarding context: no completedAt → isOnboarding === true.
const onboardingContext = {
  userId: "u1",
  user: { onboarding: {} },
} as unknown as ResolvedToolContext;

function buildDeps(getUserContextText: (id: string) => Promise<string>): ToolDeps {
  return {
    userDb: {
      // Post-WS11: getProfile() returns a presentation row for EVERY existing user.
      getProfile: mock(async () => ({
        identity: { name: "U", bio: "", location: "" },
        attributes: { skills: [], interests: [] },
      })),
      getUser: mock(async () => ({ id: "u1", name: "U", email: "u@example.com", socials: [] })),
      getUserSocials: mock(async () => []),
      setUserSocials: mock(async () => {}),
      updateUser: mock(async () => ({})),
      getActiveIntents: mock(async () => []),
    },
    systemDb: {},
    database: {},
    graphs: { profile: { invoke: mock(async () => ({ readResult: { hasProfile: false } })) } },
    enricher: { enrichUserProfile: async () => null },
    grantDefaultSystemPermissions: async () => undefined,
    getUserContextText,
  } as unknown as ToolDeps;
}

describe("create_user_context onboarding already-enriched gate (WS11 signal)", () => {
  it("returns alreadyExists when the user already has a global context", async () => {
    const tool = captureCreateTool(buildDeps(async () => "An existing synthesized identity paragraph."));
    const out = JSON.parse(await tool.handler({ context: onboardingContext, query: {} }));
    expect(out.success).toBe(true);
    expect(out.data.alreadyExists).toBe(true);
  });

  it("does NOT short-circuit when there is no global context, even though getProfile() returns a row", async () => {
    const tool = captureCreateTool(buildDeps(async () => ""));
    const out = JSON.parse(await tool.handler({ context: onboardingContext, query: {} }));
    // Gate skipped → falls through to the preview path; with no enrichment/info it asks for clarification.
    expect(out.data?.alreadyExists).toBeUndefined();
    expect(out.needsClarification).toBe(true);
    expect(out.missingFields).toContain("bio_or_social_urls");
  });
});
