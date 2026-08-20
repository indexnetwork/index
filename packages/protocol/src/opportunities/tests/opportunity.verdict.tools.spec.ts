/**
 * Owner verdict tools on MCP (`reject_opportunity` / `accept_opportunity`).
 *
 * The boundary IS the feature: exactly the session-authenticated class the
 * IND-593 owner-provenance binding admits may pass a verdict, and an API-key
 * agent principal is refused in the handler even if the tool were ever
 * mis-listed (the capability matrix already hides it — see
 * mcp.authorization-policy.spec.ts). Execution goes through the injected
 * verdict host, asserted against a stub.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createOpportunityVerdictTools } from "../opportunity.verdict.tools.js";
import { bindOwnerApprovalProvenance } from "../opportunity.owner-provenance.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { NegotiatorVerdictInput, NegotiatorVerdictResult } from "../../shared/interfaces/negotiator-verdict.interface.js";

const OWNER = "user-owner";
const INTENT_ID = "intent-1";

function makeContext(opts: { sessionAuthenticated?: boolean; agentId?: string; bindProvenance?: boolean } = {}): ResolvedToolContext {
  const context = {
    userId: OWNER,
    user: { id: OWNER, name: "Alice", email: "a@test" },
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(opts.agentId ? { agentId: opts.agentId } : {}),
  } as unknown as ResolvedToolContext;
  if (opts.bindProvenance !== false) {
    bindOwnerApprovalProvenance(context, {
      surface: "mcp",
      sessionAuthenticated: opts.sessionAuthenticated ?? true,
    });
  }
  return context;
}

function makeHost(result: NegotiatorVerdictResult = { status: "executed", counterparty: "Basak" }) {
  const calls: Array<{ verdict: "rejected" | "accepted"; userId: string; input: NegotiatorVerdictInput }> = [];
  return {
    calls,
    host: {
      rejectOpportunity: async (userId: string, input: NegotiatorVerdictInput) => {
        calls.push({ verdict: "rejected", userId, input });
        return result;
      },
      acceptOpportunity: async (userId: string, input: NegotiatorVerdictInput) => {
        calls.push({ verdict: "accepted", userId, input });
        return result;
      },
    },
  };
}

function captureTools(deps: Record<string, unknown>) {
  const captured = new Map<string, { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema: z.ZodType }>();
  const defineTool = (def: { name: string; handler: never; querySchema: z.ZodType }) => {
    captured.set(def.name, def as never);
    return def;
  };
  createOpportunityVerdictTools(defineTool as never, deps as unknown as ToolDeps);
  return captured;
}

describe("MCP owner verdict tools", () => {
  test("a session-authenticated owner's reject executes through the host and names who it landed on", async () => {
    const { host, calls } = makeHost();
    const tools = captureTools({ negotiatorVerdictTools: host });
    const result = JSON.parse(await tools.get("reject_opportunity")!.handler({
      context: makeContext(),
      query: { intentId: INTENT_ID, counterparty: 2, reason: "not this one" },
    }));

    expect(result.success).toBe(true);
    expect(result.data.status).toBe("executed");
    expect(result.data.counterparty).toBe("Basak");
    expect(result.data.message).toContain("Basak");
    expect(calls).toEqual([{
      verdict: "rejected",
      userId: OWNER,
      input: { intentId: INTENT_ID, counterparty: 2, reason: "not this one" },
    }]);
  });

  test("a session-authenticated owner's accept is one side of two", async () => {
    const { host, calls } = makeHost();
    const tools = captureTools({ negotiatorVerdictTools: host });
    const result = JSON.parse(await tools.get("accept_opportunity")!.handler({
      context: makeContext(),
      query: { intentId: INTENT_ID, counterparty: 1 },
    }));

    expect(result.success).toBe(true);
    expect(result.data.message).toContain("when Basak accepts too");
    expect(calls[0]!.verdict).toBe("accepted");
    expect(calls[0]!.input.reason).toBeUndefined();
  });

  test("an API-key agent principal is refused before the host runs", async () => {
    const { host, calls } = makeHost();
    const tools = captureTools({ negotiatorVerdictTools: host });
    const result = JSON.parse(await tools.get("reject_opportunity")!.handler({
      context: makeContext({ sessionAuthenticated: false, agentId: "agent-1" }),
      query: { intentId: INTENT_ID, counterparty: 1 },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("authenticated session");
    expect(calls).toEqual([]);
  });

  test("a context without host-bound provenance is refused — a caller cannot forge admission", async () => {
    const { host, calls } = makeHost();
    const tools = captureTools({ negotiatorVerdictTools: host });
    const result = JSON.parse(await tools.get("accept_opportunity")!.handler({
      context: makeContext({ bindProvenance: false }),
      query: { intentId: INTENT_ID, counterparty: 1 },
    }));

    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });

  test("an unknown counterparty re-lists instead of deciding", async () => {
    const { host } = makeHost({ status: "unknown_counterparty", count: 2, actionable: ["Basak — waiting on your decision", "Deren — parked, waiting on you"] });
    const tools = captureTools({ negotiatorVerdictTools: host });
    const result = JSON.parse(await tools.get("reject_opportunity")!.handler({
      context: makeContext(),
      query: { intentId: INTENT_ID, counterparty: 7 },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("nothing was decided");
    expect(result.error).toContain("1. Basak — waiting on your decision");
    expect(result.error).toContain("2. Deren — parked, waiting on you");
  });

  test("a missing host is an honest unavailability error", async () => {
    const tools = captureTools({});
    const result = JSON.parse(await tools.get("reject_opportunity")!.handler({
      context: makeContext(),
      query: { intentId: INTENT_ID, counterparty: 1 },
    }));
    expect(result.success).toBe(false);
    expect(result.error).toContain("not available");
  });
});
