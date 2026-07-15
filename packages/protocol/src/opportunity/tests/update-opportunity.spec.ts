import { afterEach, describe, expect, mock, test } from "bun:test";
import { createOpportunityTools } from "../opportunity.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";

const CALLER_ID = "caller-111";
const OTHER_ID  = "other-222";
const OPP_ID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeContext(userId = CALLER_ID): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function makeOpportunity(status: string, actorIds = [CALLER_ID, OTHER_ID]): Opportunity {
  return {
    id: OPP_ID,
    status,
    actors: actorIds.map((userId) => ({ userId, role: "party" })),
  } as unknown as Opportunity;
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string> } | undefined;
  const defineTool = (def: any) => { if (def.name === "update_opportunity") captured = def; return def; };
  createOpportunityTools(defineTool as any, deps);
  return captured!;
}

const ORIGINAL_QUESTIONER_ENABLED = process.env.QUESTIONER_ENABLED;
const ORIGINAL_UPTAKE_ENABLED = process.env.QUESTIONER_UPTAKE_ENABLED;

function restoreUptakeFlags(): void {
  if (ORIGINAL_QUESTIONER_ENABLED === undefined) delete process.env.QUESTIONER_ENABLED;
  else process.env.QUESTIONER_ENABLED = ORIGINAL_QUESTIONER_ENABLED;
  if (ORIGINAL_UPTAKE_ENABLED === undefined) delete process.env.QUESTIONER_UPTAKE_ENABLED;
  else process.env.QUESTIONER_UPTAKE_ENABLED = ORIGINAL_UPTAKE_ENABLED;
}

afterEach(restoreUptakeFlags);

describe("update_opportunity — state machine", () => {
  test("blocks transition from rejected to accepted", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("rejected"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already|terminal|cannot/i);
  });

  test("blocks transition from accepted to pending", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("accepted"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "pending" } })
    );
    expect(result.success).toBe(false);
  });

  test("blocks update while opportunity is negotiating (in-flight)", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("negotiating"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/negotiating|cannot/i);
  });

  test("allows pending to accepted", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("pending"),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_opportunity — actor guard", () => {
  test("blocks update when caller is not an actor", async () => {
    const deps = {
      systemDb: {
        // Opportunity only has OTHER_ID and a third party — not the caller
        getOpportunity: async () => makeOpportunity("pending", [OTHER_ID, "third-333"]),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(CALLER_ID), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    // Privacy: unauthorized callers should see the same message as missing opportunities.
    expect(result.error).toMatch(/not found/i);
  });

  test("allows update when caller is an actor", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("pending", [CALLER_ID, OTHER_ID]),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext(CALLER_ID), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_opportunity — network scope guard", () => {
  const BOUND_NETWORK = "bound-network-id";
  const OTHER_NETWORK = "other-network-id";

  function scopedContext(networkId: string): ResolvedToolContext {
    const ctx = makeContext(CALLER_ID);
    (ctx as { networkId?: string }).networkId = networkId;
    return ctx;
  }

  function mixedNetworkOpportunity(callerNetworkId: string, otherNetworkId: string): Opportunity {
    return {
      id: OPP_ID,
      status: "pending",
      actors: [
        { userId: CALLER_ID, role: "party", networkId: callerNetworkId },
        { userId: OTHER_ID,  role: "party", networkId: otherNetworkId },
      ],
    } as unknown as Opportunity;
  }

  test("blocks update when caller's actor is on a different network than the bound scope, even if a counterpart is on the bound network", async () => {
    // Mirror the read-path leak: bound scope = BOUND_NETWORK, the caller is
    // anchored on OTHER_NETWORK, only the counterpart is on BOUND_NETWORK.
    // The old check (`actors.find((a) => a.networkId === context.networkId)`)
    // matched the counterpart and let the update through.
    const deps = {
      systemDb: {
        getOpportunity: async () => mixedNetworkOpportunity(OTHER_NETWORK, BOUND_NETWORK),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: scopedContext(BOUND_NETWORK), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(false);
    // Privacy: same opaque message as the actor guard so callers can't probe scope.
    expect(result.error).toMatch(/not found/i);
  });

  test("allows update when caller's own actor is on the bound network", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => mixedNetworkOpportunity(BOUND_NETWORK, OTHER_NETWORK),
      },
      graphs: {
        opportunity: { invoke: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }) },
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: scopedContext(BOUND_NETWORK), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_opportunity — uptake soft interlock", () => {
  const NETWORK_ID = "uptake-network";
  const QUESTION_ID = "question-uptake-1";

  function enableUptakeGuard(): void {
    process.env.QUESTIONER_ENABLED = "true";
    process.env.QUESTIONER_UPTAKE_ENABLED = "true";
  }

  function pendingOpportunity(): Opportunity {
    return {
      id: OPP_ID,
      status: "pending",
      actors: [
        { userId: CALLER_ID, role: "party", networkId: NETWORK_ID },
        { userId: OTHER_ID, role: "party", networkId: NETWORK_ID },
      ],
    } as unknown as Opportunity;
  }

  function uptakeQuestion(overrides: Record<string, unknown> = {}) {
    return {
      id: QUESTION_ID,
      title: "Capacity",
      prompt: "Before accepting this manufacturing collaboration, do you have enough information about the climate founder's pilot-production capacity?",
      options: [
        { label: "Review capacity", description: "Clarify available production capacity before committing." },
        { label: "Proceed", description: "Continue based on the information already available." },
      ],
      multiSelect: false,
      mode: "negotiation" as const,
      purpose: "uptake" as const,
      sourceType: "opportunity",
      sourceId: OPP_ID,
      createdAt: "2026-07-15T12:00:00.000Z",
      actors: [{ userId: CALLER_ID, networkId: NETWORK_ID }, { userId: OTHER_ID, networkId: NETWORK_ID }],
      ...overrides,
    };
  }

  function makeGuardDeps(options?: {
    questions?: ReturnType<typeof uptakeQuestion>[];
    lookupError?: Error;
    reports?: Array<Record<string, unknown>>;
  }) {
    const invoke = mock(async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }));
    const findPendingQuestions = mock(async () => {
      if (options?.lookupError) throw options.lookupError;
      return options?.questions ?? [uptakeQuestion()];
    });
    const deps = {
      systemDb: { getOpportunity: async () => pendingOpportunity() },
      graphs: { opportunity: { invoke } },
      findPendingQuestions,
      reportToolError: (_error: unknown, report: Record<string, unknown>) => options?.reports?.push(report),
    } as unknown as ToolDeps;
    return { deps, invoke, findPendingQuestions };
  }

  function networkContext(): ResolvedToolContext {
    const context = makeContext();
    (context as { networkId?: string }).networkId = NETWORK_ID;
    return context;
  }

  test("flag off preserves acceptance and does not query pending questions", async () => {
    delete process.env.QUESTIONER_ENABLED;
    delete process.env.QUESTIONER_UPTAKE_ENABLED;
    const { deps, invoke, findPendingQuestions } = makeGuardDeps();
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(true);
    expect(findPendingQuestions).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("returns a structured advisory with public questions and no graph mutation", async () => {
    enableUptakeGuard();
    const { deps, invoke, findPendingQuestions } = makeGuardDeps();
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(findPendingQuestions).toHaveBeenCalledWith(CALLER_ID, {
      sourceType: "opportunity",
      sourceId: OPP_ID,
      modes: ["negotiation"],
      purpose: "uptake",
      networkId: NETWORK_ID,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("uptake questions");
    expect(result.advisory).toMatchObject({
      code: "unresolved_uptake_questions",
      advisoryOnly: true,
      opportunityId: OPP_ID,
      acknowledgedUptakeQuestionIds: [QUESTION_ID],
    });
    expect(result.advisory.questions).toEqual([{
      id: QUESTION_ID,
      title: "Capacity",
      prompt: expect.any(String),
      options: expect.any(Array),
      multiSelect: false,
    }]);
    expect(result.advisory.questions[0].actors).toBeUndefined();
    expect(result.advisory.questions[0].purpose).toBeUndefined();
    expect(result.advisory.questions[0].sourceId).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("acknowledging all unresolved ids continues to the graph", async () => {
    enableUptakeGuard();
    const { deps, invoke } = makeGuardDeps();
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: {
        opportunityId: OPP_ID,
        status: "accepted",
        acknowledgedUptakeQuestionIds: [QUESTION_ID],
      },
    }));

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("fails open and reports a lookup error", async () => {
    enableUptakeGuard();
    const reports: Array<Record<string, unknown>> = [];
    const { deps, invoke } = makeGuardDeps({ lookupError: new Error("question store unavailable"), reports });
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(reports).toEqual([expect.objectContaining({
      operation: "opportunity.uptake_lookup",
      toolName: "update_opportunity",
      userId: CALLER_ID,
    })]);
  });

  test("does not interlock non-accept transitions", async () => {
    enableUptakeGuard();
    const { deps, invoke, findPendingQuestions } = makeGuardDeps();
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "rejected" },
    }));

    expect(result.success).toBe(true);
    expect(findPendingQuestions).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("runs actor authorization before the uptake lookup", async () => {
    enableUptakeGuard();
    const { deps, invoke, findPendingQuestions } = makeGuardDeps();
    (deps.systemDb as { getOpportunity: () => Promise<Opportunity> }).getOpportunity = async () =>
      makeOpportunity("pending", [OTHER_ID, "third-user"]);
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
    expect(findPendingQuestions).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  test("does not pick an arbitrary duplicate actor network for unscoped lookup", async () => {
    enableUptakeGuard();
    const { deps, findPendingQuestions } = makeGuardDeps();
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(false);
    const filters = findPendingQuestions.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(filters.networkId).toBeUndefined();
  });

  test("keeps other-network questions private even when the host ignores filters", async () => {
    enableUptakeGuard();
    const { deps, invoke } = makeGuardDeps({
      questions: [uptakeQuestion({
        id: "question-other-network",
        actors: [{ userId: CALLER_ID, networkId: "another-network" }],
      })],
    });
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(true);
    expect(result.advisory).toBeUndefined();
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("defensively rejects mismatched source, mode, and purpose rows", async () => {
    enableUptakeGuard();
    const { deps, invoke } = makeGuardDeps({
      questions: [
        uptakeQuestion({ id: "wrong-source", sourceId: "other-opportunity" }),
        uptakeQuestion({ id: "wrong-mode", mode: "intent" }),
        uptakeQuestion({ id: "wrong-purpose", purpose: undefined }),
      ],
    });
    const result = JSON.parse(await captureTool(deps).handler({
      context: networkContext(),
      query: { opportunityId: OPP_ID, status: "accepted" },
    }));

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
