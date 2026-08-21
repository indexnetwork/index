/**
 * IND-593: update_opportunity owner-approval proof gate (production boundary).
 *
 * Every registered MCP-agent send/accept/reject transition must present an
 * explicit owner-issued, fresh, atomically single-use proof bound to the exact
 * opportunity, target action, owner principal, acting agent, and current
 * server-derived interaction — verified and consumed through the injected
 * protocol-owned OpportunityOwnerApprovalAuthority BEFORE the opportunity
 * mutation graph runs. Missing, stale, generic, forged, wrong-binding, and
 * replayed proofs fail closed. Direct authenticated-owner interactions traverse
 * the same boundary via host attestation; caller-controlled identity and
 * proof-binding fields are never trusted. A2A negotiation approvals, agent
 * self-acknowledgment (acknowledgedUptakeQuestionIds), and server-generated
 * advisory/challenge values are not substitutes for owner authorization.
 */
import { describe, expect, mock, test } from "bun:test";
import { createOpportunityTools } from "../opportunity.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { OpportunityOwnerApprovalAuthority, OpportunityOwnerApprovalBinding, OpportunityOwnerApprovalVerdict } from "../opportunity.owner-approval.js";
import { bindOwnerApprovalProvenance } from "../opportunity.owner-provenance.js";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";

const CALLER_ID = "caller-111";
const OTHER_ID = "other-222";
const AGENT_ID = "agent-1";
const OPP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OPP_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const QUESTION_ID = "uptake-question-1";

function makeAgentContext(userId = CALLER_ID, agentId = AGENT_ID): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    agentId,
  } as unknown as ResolvedToolContext;
}

function makeOwnerContext(userId = CALLER_ID): ResolvedToolContext {
  const context = {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
  } as unknown as ResolvedToolContext;
  bindOwnerApprovalProvenance(context, { surface: "rest", sessionAuthenticated: true });
  return context;
}

/** Session-authenticated owner connected over MCP directly (no agent). */
function makeMcpOwnerContext(userId = CALLER_ID): ResolvedToolContext {
  const context = {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
  bindOwnerApprovalProvenance(context, { surface: "mcp", sessionAuthenticated: true });
  return context;
}

/** Chat-orchestrator turn inside the owner's chat session — mediated, not direct. */
function makeChatContext(userId = CALLER_ID): ResolvedToolContext {
  const context = {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
    sessionId: "chat-session-1",
  } as unknown as ResolvedToolContext;
  bindOwnerApprovalProvenance(context, { surface: "chat", sessionAuthenticated: false });
  return context;
}

/** API-key (CLI-style) tool call — authenticated principal, but no owner session. */
function makeApiKeyContext(userId = CALLER_ID): ResolvedToolContext {
  const context = {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
  } as unknown as ResolvedToolContext;
  bindOwnerApprovalProvenance(context, { surface: "rest", sessionAuthenticated: false });
  return context;
}

/** Caller-shaped fields must not substitute for the host's private provenance tag. */
function makeForgedOwnerishContext(userId = CALLER_ID): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Test", email: "t@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: false,
    isSessionAuth: true,
    ownerApprovalProvenance: { surface: "rest", sessionAuthenticated: true },
  } as unknown as ResolvedToolContext;
}

function makeOpportunity(id = OPP_ID, status = "pending", actorIds = [CALLER_ID, OTHER_ID]): Opportunity {
  return {
    id,
    status,
    actors: actorIds.map((userId) => ({ userId, role: "party" })),
  } as unknown as Opportunity;
}

/**
 * Faithful in-memory contract double for the host authority: challenges are
 * registered on proof-less calls, proofs are issued only against a pending
 * challenge, and consumption is atomically single-use.
 */
class FakeOwnerApprovalAuthority implements OpportunityOwnerApprovalAuthority {
  pending = new Map<string, { binding: OpportunityOwnerApprovalBinding & { agentId: string }; expiresAt: number }>();
  consumed = new Set<string>();
  consumeCalls: Array<{ proof: string | undefined; binding: OpportunityOwnerApprovalBinding & { agentId: string } }> = [];
  attestCalls: Array<{ binding: OpportunityOwnerApprovalBinding & { provenance?: unknown } }> = [];
  admitAttestation = true;
  private counter = 0;

  /** Owner-side issuance, valid only against a pending challenge. */
  issue(interactionId: string): string {
    if (!this.pending.has(interactionId)) throw new Error(`no pending challenge ${interactionId}`);
    return `proof:${interactionId}`;
  }

  expire(interactionId: string): void {
    const entry = this.pending.get(interactionId);
    if (entry) entry.expiresAt = Date.now() - 1;
  }

  async consumeAgentProof(
    proof: string | undefined,
    binding: OpportunityOwnerApprovalBinding & { agentId: string },
  ): Promise<OpportunityOwnerApprovalVerdict> {
    this.consumeCalls.push({ proof, binding });
    if (proof === undefined) {
      const interactionId = `interaction-${++this.counter}`;
      this.pending.set(interactionId, { binding, expiresAt: Date.now() + 600_000 });
      return {
        kind: "denied",
        reason: "missing",
        challenge: { interactionId, expiresAt: new Date(Date.now() + 600_000).toISOString() },
      };
    }
    if (proof === "generic-token") return { kind: "denied", reason: "generic" };
    if (!proof.startsWith("proof:")) return { kind: "denied", reason: "forged" };
    const interactionId = proof.slice("proof:".length);
    if (this.consumed.has(interactionId)) return { kind: "denied", reason: "replayed" };
    const challenge = this.pending.get(interactionId);
    if (!challenge) return { kind: "denied", reason: "forged" };
    if (challenge.expiresAt < Date.now()) return { kind: "denied", reason: "stale" };
    if (challenge.binding.opportunityId !== binding.opportunityId) return { kind: "denied", reason: "wrong_opportunity" };
    if (challenge.binding.action !== binding.action) return { kind: "denied", reason: "wrong_action" };
    if (challenge.binding.ownerId !== binding.ownerId) return { kind: "denied", reason: "wrong_owner" };
    if (challenge.binding.agentId !== binding.agentId) return { kind: "denied", reason: "wrong_agent" };
    // Atomic single-use: delete-then-admit before any other await.
    this.pending.delete(interactionId);
    this.consumed.add(interactionId);
    return { kind: "admitted" };
  }

  async attestOwnerInteraction(
    binding: OpportunityOwnerApprovalBinding & { provenance?: unknown },
  ): Promise<OpportunityOwnerApprovalVerdict> {
    this.attestCalls.push({ binding });
    return this.admitAttestation ? { kind: "admitted" } : { kind: "denied", reason: "untrusted_provenance" };
  }
}

function captureTool(deps: ToolDeps) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: never }) => Promise<string> } | undefined;
  const defineTool = (def: never) => {
    if ((def as { name: string }).name === "update_opportunity") captured = def;
    return def;
  };
  createOpportunityTools(defineTool as never, deps);
  return captured!;
}

function makeDeps(authority?: OpportunityOwnerApprovalAuthority, opportunity: Opportunity = makeOpportunity()) {
  const invoke = mock(async () => ({ mutationResult: { success: true, opportunityId: opportunity.id, message: "ok" } }));
  const deps = {
    systemDb: { getOpportunity: async () => opportunity },
    opportunityOperations: { updateOpportunityStatus: invoke, sendOpportunity: invoke },
    ...(authority ? { opportunityOwnerApproval: authority } : {}),
  } as unknown as ToolDeps;
  return { deps, invoke };
}

type ToolResult = {
  success: boolean;
  error?: string;
  approval?: {
    code?: string;
    reason?: string;
    opportunityId?: string;
    action?: string;
    interactionId?: string;
    expiresAt?: string;
  };
};

describe("update_opportunity — owner approval gate (IND-593)", () => {
  test.each([
    ["pending", "send"],
    ["accepted", "accept"],
    ["rejected", "reject"],
  ] as const)("requires an explicit owner proof for an MCP-agent %s (%s) transition before persistence", async (status, action) => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const result = JSON.parse(
      await captureTool(deps).handler({ context: makeAgentContext(), query: { opportunityId: OPP_ID, status } as never }),
    ) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.approval?.code).toBe("owner_approval_required");
    expect(result.approval?.reason).toBe("missing");
    expect(result.approval?.opportunityId).toBe(OPP_ID);
    expect(result.approval?.action).toBe(action);
    // The denial carries the fresh, server-derived interaction the owner must approve.
    expect(result.approval?.interactionId).toBeTruthy();
    expect(result.approval?.expiresAt).toBeTruthy();
    // The binding is derived from the authenticated context, never the caller.
    expect(authority.consumeCalls).toEqual([{
      proof: undefined,
      binding: { opportunityId: OPP_ID, action, ownerId: CALLER_ID, agentId: AGENT_ID },
    }]);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("fails closed for an agent when no authority is wired", async () => {
    const { deps, invoke } = makeDeps(undefined);
    const result = JSON.parse(
      await captureTool(deps).handler({ context: makeAgentContext(), query: { opportunityId: OPP_ID, status: "accepted" } as never }),
    ) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.approval?.code).toBe("owner_approval_required");
    expect(result.approval?.reason).toBe("missing");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("rejects forged, generic, and stale proofs before persistence", async () => {
    // Forged: never issued against any pending challenge.
    {
      const authority = new FakeOwnerApprovalAuthority();
      const { deps, invoke } = makeDeps(authority);
      const result = JSON.parse(await captureTool(deps).handler({
        context: makeAgentContext(),
        query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: "not-a-real-proof" } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.approval?.reason).toBe("forged");
      expect(invoke).not.toHaveBeenCalled();
    }
    // Generic: a token without an exact binding.
    {
      const authority = new FakeOwnerApprovalAuthority();
      const { deps, invoke } = makeDeps(authority);
      const result = JSON.parse(await captureTool(deps).handler({
        context: makeAgentContext(),
        query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: "generic-token" } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.approval?.reason).toBe("generic");
      expect(invoke).not.toHaveBeenCalled();
    }
    // Stale: issued against a challenge that has since expired.
    {
      const authority = new FakeOwnerApprovalAuthority();
      const { deps, invoke } = makeDeps(authority);
      const tool = captureTool(deps);
      const first = JSON.parse(await tool.handler({
        context: makeAgentContext(),
        query: { opportunityId: OPP_ID, status: "accepted" } as never,
      })) as ToolResult;
      const interactionId = first.approval!.interactionId!;
      const proof = authority.issue(interactionId);
      authority.expire(interactionId);
      const result = JSON.parse(await tool.handler({
        context: makeAgentContext(),
        query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: proof } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.approval?.reason).toBe("stale");
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  test("rejects proofs bound to a different opportunity, action, owner, or agent", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const tool = captureTool(deps);

    const first = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;
    const proof = authority.issue(first.approval!.interactionId!);

    const wrongOpportunity = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_B_ID, status: "accepted", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(wrongOpportunity.approval?.reason).toBe("wrong_opportunity");

    const wrongAction = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "rejected", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(wrongAction.approval?.reason).toBe("wrong_action");

    // The wrong-owner case needs an opportunity the other principal can see,
    // so it reaches the proof gate past the actor-admission guard.
    const wrongOwnerDeps = makeDeps(authority, makeOpportunity(OPP_ID, "pending", ["other-owner-999", OTHER_ID]));
    const wrongOwner = JSON.parse(await captureTool(wrongOwnerDeps.deps).handler({
      context: makeAgentContext("other-owner-999"),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(wrongOwner.approval?.reason).toBe("wrong_owner");

    const wrongAgent = JSON.parse(await tool.handler({
      context: makeAgentContext(CALLER_ID, "agent-2"),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(wrongAgent.approval?.reason).toBe("wrong_agent");

    expect(wrongOpportunity.success).toBe(false);
    expect(wrongAction.success).toBe(false);
    expect(wrongOwner.success).toBe(false);
    expect(wrongAgent.success).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(wrongOwnerDeps.invoke).not.toHaveBeenCalled();
  });

  test("admits one exact fresh proof exactly once; a replay fails closed", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const tool = captureTool(deps);

    const first = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;
    expect(first.approval?.reason).toBe("missing");

    const proof = authority.issue(first.approval!.interactionId!);
    const admitted = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(admitted.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);

    const replayed = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: proof } as never,
    })) as ToolResult;
    expect(replayed.success).toBe(false);
    expect(replayed.approval?.reason).toBe("replayed");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("agent self-acknowledgment, server advisories, and negotiation approvals are not owner authorization", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const invoke = mock(async () => ({ mutationResult: { success: true, opportunityId: OPP_ID, message: "ok" } }));
    const deps = {
      systemDb: { getOpportunity: async () => makeOpportunity() },
      opportunityOperations: { updateOpportunityStatus: invoke, sendOpportunity: invoke },
      opportunityOwnerApproval: authority,
      findPendingQuestions: async () => [{
        id: QUESTION_ID,
        title: "Prep",
        prompt: "Confirm timing?",
        options: [],
        multiSelect: false,
        mode: "negotiation",
        sourceType: "opportunity",
        sourceId: OPP_ID,
        purpose: "uptake",
        createdAt: "2026-01-01T00:00:00.000Z",
        actors: [{ userId: CALLER_ID }],
      }],
    } as unknown as ToolDeps;
    const tool = captureTool(deps);

    // Agent self-acknowledgment of every uptake question is not a proof.
    const selfAck = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted", acknowledgedUptakeQuestionIds: [QUESTION_ID] } as never,
    })) as ToolResult;
    expect(selfAck.success).toBe(false);
    expect(selfAck.approval?.code).toBe("owner_approval_required");
    expect(selfAck.approval?.reason).toBe("missing");

    // The server-generated challenge/advisory value itself is not a proof.
    const advisoryAsProof = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: selfAck.approval!.interactionId! } as never,
    })) as ToolResult;
    expect(advisoryAsProof.success).toBe(false);
    expect(advisoryAsProof.approval?.reason).toBe("forged");

    // An A2A negotiation approval artifact is not a proof either.
    const negotiationApproval = JSON.parse(await tool.handler({
      context: makeAgentContext(),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: "negotiation-approval:task-1" } as never,
    })) as ToolResult;
    expect(negotiationApproval.success).toBe(false);
    expect(negotiationApproval.approval?.reason).toBe("forged");

    expect(invoke).not.toHaveBeenCalled();
  });

  test("direct owner interactions traverse the same boundary via host attestation; caller proof fields are ignored", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeOwnerContext(),
      query: { opportunityId: OPP_ID, status: "accepted", ownerApprovalProof: "caller-controlled-junk" } as never,
    })) as ToolResult;

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    // Host attestation carries only the server-derived principal, binding, and
    // interaction/surface provenance; the caller-controlled proof field never
    // reaches the agent-proof consumer.
    expect(authority.attestCalls).toEqual([{
      binding: {
        opportunityId: OPP_ID,
        action: "accept",
        ownerId: CALLER_ID,
        provenance: { surface: "rest", sessionAuthenticated: true },
      },
    }]);
    expect(authority.consumeCalls).toEqual([]);
  });

  test("a session-authenticated owner over MCP attests with trusted mcp provenance", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeMcpOwnerContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(authority.attestCalls).toEqual([{
      binding: {
        opportunityId: OPP_ID,
        action: "accept",
        ownerId: CALLER_ID,
        provenance: { surface: "mcp", sessionAuthenticated: true },
      },
    }]);
  });

  test("chat and API-key surfaces present non-direct provenance and fail closed when the host denies attestation", async () => {
    // Chat orchestrator turn: surface is chat and no owner session is bound.
    {
      const authority = new FakeOwnerApprovalAuthority();
      authority.admitAttestation = false;
      const { deps, invoke } = makeDeps(authority);
      const result = JSON.parse(await captureTool(deps).handler({
        context: makeChatContext(),
        query: { opportunityId: OPP_ID, status: "accepted" } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.approval?.code).toBe("owner_approval_required");
      expect(result.approval?.reason).toBe("untrusted_provenance");
      expect(authority.attestCalls).toEqual([{
        binding: {
          opportunityId: OPP_ID,
          action: "accept",
          ownerId: CALLER_ID,
          provenance: { surface: "chat", sessionAuthenticated: false },
        },
      }]);
      expect(invoke).not.toHaveBeenCalled();
    }
    // API-key (CLI-style) call: rest surface without a bound owner session.
    {
      const authority = new FakeOwnerApprovalAuthority();
      authority.admitAttestation = false;
      const { deps, invoke } = makeDeps(authority);
      const result = JSON.parse(await captureTool(deps).handler({
        context: makeApiKeyContext(),
        query: { opportunityId: OPP_ID, status: "accepted" } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(result.approval?.reason).toBe("untrusted_provenance");
      expect(authority.attestCalls).toEqual([{
        binding: {
          opportunityId: OPP_ID,
          action: "accept",
          ownerId: CALLER_ID,
          provenance: { surface: "rest", sessionAuthenticated: false },
        },
      }]);
      expect(invoke).not.toHaveBeenCalled();
    }
  });

  test("tool arguments can never supply owner identity, interaction, or surface provenance", async () => {
    // Direct path: junk identity/provenance fields in the query are ignored —
    // the attestation binding is derived exclusively from the resolved context.
    {
      const authority = new FakeOwnerApprovalAuthority();
      const { deps } = makeDeps(authority);
      await captureTool(deps).handler({
        context: makeOwnerContext(),
        query: {
          opportunityId: OPP_ID,
          status: "accepted",
          ownerId: "attacker-owner",
          userId: "attacker-owner",
          interactionId: "attacker-interaction",
          provenance: { surface: "rest", sessionAuthenticated: true },
          surface: "rest",
          sessionAuthenticated: true,
          isSessionAuth: true,
        } as never,
      });
      expect(authority.attestCalls).toEqual([{
        binding: {
          opportunityId: OPP_ID,
          action: "accept",
          ownerId: CALLER_ID,
          provenance: { surface: "rest", sessionAuthenticated: true },
        },
      }]);
    }
    // Mediated path: the same junk cannot upgrade a chat surface to direct.
    {
      const authority = new FakeOwnerApprovalAuthority();
      authority.admitAttestation = false;
      const { deps, invoke } = makeDeps(authority);
      const result = JSON.parse(await captureTool(deps).handler({
        context: makeChatContext(),
        query: {
          opportunityId: OPP_ID,
          status: "accepted",
          provenance: { surface: "rest", sessionAuthenticated: true },
          sessionAuthenticated: true,
          isSessionAuth: true,
        } as never,
      })) as ToolResult;
      expect(result.success).toBe(false);
      expect(authority.attestCalls[0]?.binding.provenance)
        .toEqual({ surface: "chat", sessionAuthenticated: false });
      expect(invoke).not.toHaveBeenCalled();
    }
    // Agent path: junk identity fields never reach the consume binding either.
    {
      const authority = new FakeOwnerApprovalAuthority();
      const { deps } = makeDeps(authority);
      await captureTool(deps).handler({
        context: makeAgentContext(),
        query: {
          opportunityId: OPP_ID,
          status: "accepted",
          ownerId: "attacker-owner",
          agentId: "attacker-agent",
          isSessionAuth: true,
        } as never,
      });
      expect(authority.consumeCalls).toEqual([{
        proof: undefined,
        binding: { opportunityId: OPP_ID, action: "accept", ownerId: CALLER_ID, agentId: AGENT_ID },
      }]);
      expect(authority.attestCalls).toEqual([]);
    }
  });

  test("ordinary context fields cannot forge direct-owner provenance", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    const { deps, invoke } = makeDeps(authority);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeForgedOwnerishContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.approval?.reason).toBe("untrusted_provenance");
    expect(authority.attestCalls).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  test("direct owner interactions fail closed when the host does not attest", async () => {
    const authority = new FakeOwnerApprovalAuthority();
    authority.admitAttestation = false;
    const { deps, invoke } = makeDeps(authority);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeOwnerContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.approval?.code).toBe("owner_approval_required");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("direct owner interactions fail closed when no authority is wired", async () => {
    const { deps, invoke } = makeDeps(undefined);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeOwnerContext(),
      query: { opportunityId: OPP_ID, status: "accepted" } as never,
    })) as ToolResult;

    expect(result.success).toBe(false);
    expect(result.approval?.code).toBe("owner_approval_required");
    expect(result.approval?.reason).toBe("missing");
    expect(invoke).not.toHaveBeenCalled();
  });

  test("system expiry transitions are not owner-gated", async () => {
    const { deps, invoke } = makeDeps(undefined);
    const result = JSON.parse(await captureTool(deps).handler({
      context: makeOwnerContext(),
      query: { opportunityId: OPP_ID, status: "expired" } as never,
    })) as ToolResult;

    expect(result.success).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
