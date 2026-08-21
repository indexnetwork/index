import { describe, expect, mock, test } from "bun:test";
import { createOpportunityTools } from "../opportunity.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";
import { bindOwnerApprovalProvenance } from "../opportunity.owner-provenance.js";

const CALLER_ID = "caller-111";
const OTHER_ID  = "other-222";
const OPP_ID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeContext(userId = CALLER_ID): ResolvedToolContext {
  const context = {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
  // This state-machine suite exercises the direct authenticated MCP owner
  // path; host-bound provenance keeps the lifecycle assertions reachable.
  bindOwnerApprovalProvenance(context, { surface: "mcp", sessionAuthenticated: true });
  return context;
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
  // IND-593: every context in this spec is a direct authenticated-owner
  // interaction, which the host traverses through the same owner-approval
  // boundary via attestation. Inject an attesting authority by default so the
  // state-machine/actor/scope/uptake behavior under test stays reachable.
  const withAttestation = {
    opportunityOwnerApproval: {
      consumeAgentProof: async () => ({ kind: "denied", reason: "missing" }),
      attestOwnerInteraction: async () => ({ kind: "admitted" }),
    },
    ...deps,
  } as unknown as ToolDeps;
  createOpportunityTools(defineTool as any, withAttestation);
  return captured!;
}

describe("update_opportunity — state machine", () => {
  test("blocks transition from rejected to accepted", async () => {
    const deps = {
      systemDb: {
        getOpportunity: async () => makeOpportunity("rejected"),
      },
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
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
      opportunityOperations: {
        updateOpportunityStatus: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
        sendOpportunity: async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }),
      },
    } as unknown as ToolDeps;

    const tool = captureTool(deps);
    const result = JSON.parse(
      await tool.handler({ context: scopedContext(BOUND_NETWORK), query: { opportunityId: OPP_ID, status: "accepted" } })
    );
    expect(result.success).toBe(true);
  });
});

describe("update_opportunity — retired pre-accept uptake check", () => {
  const NETWORK_ID = "uptake-network";

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

  test("acceptance never consults pending questions or returns an advisory", async () => {
    // The pre-accept uptake interlock is retired (conversational-questions
    // plan, "Retirements"): acceptance proceeds directly, leaving leftover
    // pending uptake rows untouched.
    const invoke = mock(async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }));
    const findPendingQuestions = mock(async () => [{ id: "question-uptake-1" }]);
    const deps = {
      systemDb: { getOpportunity: async () => pendingOpportunity() },
      opportunityOperations: { updateOpportunityStatus: invoke, sendOpportunity: invoke },
      findPendingQuestions,
    } as unknown as ToolDeps;
    const context = makeContext();
    (context as { networkId?: string }).networkId = NETWORK_ID;

    const result = JSON.parse(await captureTool(deps).handler({
      context,
      query: { opportunityId: OPP_ID, status: "accepted", acknowledgedUptakeQuestionIds: ["stale-client-field"] },
    }));

    expect(result.success).toBe(true);
    expect(result.advisory).toBeUndefined();
    expect(findPendingQuestions).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
