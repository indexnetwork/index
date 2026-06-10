import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createIntentTools } from "../intent.tools.js";
import { DEFAULT_SPECIFICITY_WARNING } from "../intent.specificity.js";

import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

interface CapturedTool {
  name: string;
  querySchema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    toolDefs.push({ name: def.name, querySchema: def.querySchema, handler: def.handler });
    return def;
  };
  createIntentTools(defineTool as any, deps);
  return toolDefs;
}

function extractFirstIntentProposal(message: string): Record<string, unknown> {
  const match = message.match(/```intent_proposal\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("intent proposal block not found");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("create_intent", () => {
  test("falls back to approved user intro when structured profile is still pending", async () => {
    const capturedProfiles: string[] = [];
    const tools = captureTools({
      userDb: {
        getUser: async () => ({
          id: "alice",
          name: "Alice",
          email: "alice@example.com",
          intro: "I build agent tools.",
          location: "Healdsburg",
          socials: [],
        }),
      },
      systemDb: {},
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async (input: { userProfile?: string; operationMode?: string }) => {
            capturedProfiles.push(input.userProfile ?? "");
            if (input.operationMode === "propose") {
              return {
                verifiedIntents: [{ description: "Find agent builders", score: 0.91, verification: { classification: "request" } }],
                agentTimings: [],
                trace: [],
              };
            }
            return { executionResults: [{ success: true }], agentTimings: [] };
          },
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "create_intent")!;

    const result = JSON.parse(await tool.handler({
      context: makeContext("alice"),
      query: { description: "Find agent builders", autoApprove: true },
    }));

    expect(result.success).toBe(true);
    expect(capturedProfiles[0]).toContain("I build agent tools.");
    expect(capturedProfiles[0]).toContain("Healdsburg");
  });

  test("rejects broad referential-breadth signals in MCP auto-approve mode", async () => {
    let createCalls = 0;
    const tools = captureTools({
      userDb: {},
      systemDb: {},
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async (input: { operationMode?: string }) => {
            if (input.operationMode === "propose") {
              return {
                verifiedIntents: [{
                  description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
                  score: 82,
                  verification: {
                    classification: "DIRECTIVE",
                    semantic_entropy: 0.42,
                    referential_breadth: "broad",
                    missing_selectional_constraints: ["role", "outcome", "timeframe"],
                    specificity_warning: "This signal is broad and may produce many weak matches.",
                  },
                }],
                agentTimings: [],
                trace: [],
              };
            }
            createCalls++;
            return { executionResults: [{ success: true }], agentTimings: [] };
          },
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "create_intent")!;

    const result = JSON.parse(await tool.handler({
      context: makeContext("alice"),
      query: {
        description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
        autoApprove: true,
      },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("broad");
    expect(result.error).toContain("role, outcome, timeframe");
    expect(createCalls).toBe(0);
  });

  test("uses default broad warning in MCP auto-approve mode when verifier emits a null-like string", async () => {
    let createCalls = 0;
    const tools = captureTools({
      userDb: {},
      systemDb: {},
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async (input: { operationMode?: string }) => {
            if (input.operationMode === "propose") {
              return {
                verifiedIntents: [{
                  description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
                  score: 82,
                  verification: {
                    classification: "DIRECTIVE",
                    semantic_entropy: 0.42,
                    referential_breadth: "broad",
                    missing_selectional_constraints: ["role", "outcome", "timeframe"],
                    specificity_warning: " null ",
                  },
                }],
                agentTimings: [],
                trace: [],
              };
            }
            createCalls++;
            return { executionResults: [{ success: true }], agentTimings: [] };
          },
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "create_intent")!;

    const result = JSON.parse(await tool.handler({
      context: makeContext("alice"),
      query: {
        description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
        autoApprove: true,
      },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain(DEFAULT_SPECIFICITY_WARNING);
    expect(result.error).not.toMatch(/\bnull\b/i);
    expect(result.error).toContain("role, outcome, timeframe");
    expect(createCalls).toBe(0);
  });

  test("normalizes null-like specificity warnings in web proposal cards", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {},
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async () => ({
            verifiedIntents: [{
              description: "Find agent builders for TypeScript protocol tooling",
              score: 77,
              verification: {
                classification: "DIRECTIVE",
                semantic_entropy: 0.33,
                referential_breadth: "moderate",
                missing_selectional_constraints: [],
                specificity_warning: " undefined ",
              },
            }],
            agentTimings: [],
            trace: [],
          }),
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "create_intent")!;
    const context = { ...makeContext("alice"), isMcp: false } as ResolvedToolContext;

    const result = JSON.parse(await tool.handler({
      context,
      query: {
        description: "Find agent builders for TypeScript protocol tooling",
        autoApprove: false,
      },
    }));

    expect(result.success).toBe(true);
    const proposal = extractFirstIntentProposal(result.data.message);
    expect(proposal.referentialBreadth).toBe("moderate");
    expect(proposal.specificityWarning).toBeNull();
    expect(proposal.semanticEntropy).toBe(0.33);
  });

  test("surfaces referential-breadth warnings in web proposal cards", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {},
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async () => ({
            verifiedIntents: [{
              description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
              score: 82,
              verification: {
                classification: "DIRECTIVE",
                semantic_entropy: 0.42,
                referential_breadth: "broad",
                missing_selectional_constraints: ["role", "outcome", "timeframe"],
                specificity_warning: "This signal is broad and may produce many weak matches.",
              },
            }],
            agentTimings: [],
            trace: [],
          }),
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "create_intent")!;
    const context = { ...makeContext("alice"), isMcp: false } as ResolvedToolContext;

    const result = JSON.parse(await tool.handler({
      context,
      query: {
        description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
        autoApprove: false,
      },
    }));

    expect(result.success).toBe(true);
    const proposal = extractFirstIntentProposal(result.data.message);
    expect(proposal.referentialBreadth).toBe("broad");
    expect(proposal.specificityWarning).toContain("broad");
    expect(proposal.missingSelectionalConstraints).toEqual(["role", "outcome", "timeframe"]);
    expect(proposal.semanticEntropy).toBe(0.42);
  });
});

describe("update_intent", () => {
  test("accepts description and rejects legacy newDescription", () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "user-123" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null }) },
        intent: { invoke: async () => ({ executionResults: [] }) },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "update_intent")!;

    expect(
      tool.querySchema.safeParse({
        intentId: "11111111-1111-4111-8111-111111111111",
        description: "Updated intent",
      }).success,
    ).toBe(true);
    expect(
      tool.querySchema.safeParse({
        intentId: "11111111-1111-4111-8111-111111111111",
        newDescription: "Updated intent",
      }).success,
    ).toBe(false);
  });

  test("forwards description into the intent graph update call", async () => {
    let capturedInputContent: string | undefined;
    const tools = captureTools({
      userDb: {},
      systemDb: {
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "alice" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async (input: { inputContent?: string }) => {
            capturedInputContent = input.inputContent;
            return {
              executionResults: [{ success: true }],
              agentTimings: [],
            };
          },
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "update_intent")!;

    const result = await tool.handler({
      context: makeContext("alice"),
      query: {
        intentId: "11111111-1111-4111-8111-111111111111",
        description: "Find a design partner for a CRPG UI",
      },
    });
    const parsed = JSON.parse(result);

    expect(capturedInputContent).toBe("Find a design partner for a CRPG UI");
    expect(parsed.success).toBe(true);
    expect(parsed.data.message).toBe("Intent updated.");
  });

  test("returns an error when verification filters the update into a no-op", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "alice" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: { invoke: async () => ({ verifiedIntents: [], actions: [], executionResults: [], agentTimings: [] }) },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "update_intent")!;

    const result = JSON.parse(await tool.handler({
      context: makeContext("alice"),
      query: {
        intentId: "11111111-1111-4111-8111-111111111111",
        description: "Meet creative people, builders, and makers interested in AI and somatic exploration",
      },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("not applied");
    expect(result.error).toContain("too broad");
  });
});

describe("update_intent — ownership", () => {
  test("returns error when intent does not exist", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => null,
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: { invoke: async () => ({ executionResults: [] }) },
      },
    } as unknown as ToolDeps);

    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("returns error when intent belongs to another user", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "other-user" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: { invoke: async () => ({ executionResults: [] }) },
      },
    } as unknown as ToolDeps);

    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("own");
  });

  test("returns error when intent is archived", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({
          id: "11111111-1111-4111-8111-111111111111",
          userId: "caller-user",
          archivedAt: new Date(),
        }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: { invoke: async () => ({ executionResults: [] }) },
      },
    } as unknown as ToolDeps);

    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/archived/i);
  });

  test("proceeds when intent belongs to the caller", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        isNetworkMember: async () => true,
        getNetworksByScope: async () => [],
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: { invoke: async () => ({ executionResults: [{ success: true }], inferredIntents: [] }) },
      },
    } as unknown as ToolDeps);

    const tool = tools.find((t) => t.name === "update_intent")!;
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: { intentId: "11111111-1111-4111-8111-111111111111", description: "Updated" },
      })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_intent — response shape", () => {
  test("success response includes intentId and description", async () => {
    const tools = captureTools({
      userDb: {},
      systemDb: {
        getIntent: async () => ({ id: "11111111-1111-4111-8111-111111111111", userId: "caller-user" }),
      },
      graphs: {
        profile: { invoke: async () => ({ profile: null, agentTimings: [] }) },
        intent: {
          invoke: async () => ({ executionResults: [{ success: true }], agentTimings: [] }),
        },
      },
    } as unknown as ToolDeps);
    const tool = tools.find((t) => t.name === "update_intent")!;

    const result = JSON.parse(
      await tool.handler({
        context: makeContext("caller-user"),
        query: {
          intentId: "11111111-1111-4111-8111-111111111111",
          description: "Find a TypeScript architect for a 3-month contract",
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.data.intentId).toBe("11111111-1111-4111-8111-111111111111");
    expect(result.data.description).toBe("Find a TypeScript architect for a 3-month contract");
  });
});
