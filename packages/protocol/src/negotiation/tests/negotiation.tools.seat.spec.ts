import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createNegotiationTools } from "../negotiation.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

/**
 * IND-397 — respond_to_negotiation seat + version validation.
 *
 * v2 tasks: the submitted action must be within the caller's seat vocabulary
 * (initiator can never accept). v1 tasks are grandfathered: the legacy
 * vocabulary stays valid. get_negotiation announces seat/version/allowedActions.
 */

function makeContext(userId: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "U", email: "u@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown; querySchema?: z.ZodType }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

function v2Task(initiatorUserId: string) {
  return {
    id: "task-1",
    conversationId: "conv-1",
    state: "waiting_for_agent",
    metadata: {
      type: "negotiation",
      sourceUserId: "user-src",
      candidateUserId: "user-cand",
      initiatorUserId,
      protocolVersion: "v2",
      maxTurns: 6,
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };
}

function msgFrom(senderUserId: string, action: string) {
  return {
    id: "m-1",
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null } }],
    createdAt: new Date(),
  };
}

function makeDeps(task: unknown, messages: unknown[]) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ data: { action: string } }> }> = [];
  return {
    deps: {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => messages,
        createMessage: async (m: { senderId: string; parts: Array<{ data: { action: string } }> }) => {
          createdMessages.push(m);
          return { id: "msg-new", senderId: m.senderId, role: "agent", parts: m.parts, createdAt: new Date() };
        },
        updateTaskState: async () => {},
        createArtifact: async () => {},
        getArtifactsForTask: async () => [],
      },
      negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
      agentDispatcher: { dispatch: async () => ({ handled: false, reason: "waiting" }) },
    } as Partial<ToolDeps>,
    createdMessages,
  };
}

const assessmentQuery = {
  reasoning: "because",
  suggestedRoles: { ownUser: "peer", otherUser: "peer" },
};

describe("respond_to_negotiation — v2 seat validation", () => {
  test("initiator submitting accept is rejected with a seat-violation error", async () => {
    // user-src is the initiator; counterparty (user-cand) spoke last → src's turn
    const { deps } = makeDeps(v2Task("user-src"), [msgFrom("user-cand", "counter")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1", action: "accept", ...assessmentQuery },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("not allowed for your seat (initiator)");
    expect(result.error).toContain("outreach, counter, question, withdraw");
  });

  test("counterparty accept is allowed and finalizes with an opportunity", async () => {
    // user-cand is counterparty; initiator (user-src) spoke last → cand's turn
    const { deps, createdMessages } = makeDeps(v2Task("user-src"), [msgFrom("user-src", "outreach")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1", action: "accept", ...assessmentQuery },
    }));

    expect(result.success).toBe(true);
    expect(result.data.message).toContain("accepted");
    expect(result.data.outcome.hasOpportunity).toBe(true);
    expect(createdMessages[0].senderId).toBe("agent:user-cand");
  });

  test("initiator withdraw finalizes without an opportunity", async () => {
    const { deps } = makeDeps(v2Task("user-src"), [msgFrom("user-cand", "counter")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1", action: "withdraw", ...assessmentQuery },
    }));

    expect(result.success).toBe(true);
    expect(result.data.message).toContain("withdrawn");
    expect(result.data.outcome.hasOpportunity).toBe(false);
  });

  test("counterparty decline finalizes without an opportunity", async () => {
    const { deps } = makeDeps(v2Task("user-src"), [msgFrom("user-src", "outreach")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1", action: "decline", ...assessmentQuery },
    }));

    expect(result.success).toBe(true);
    expect(result.data.message).toContain("declined");
    expect(result.data.outcome.hasOpportunity).toBe(false);
  });

  test("counterparty cannot outreach", async () => {
    const { deps } = makeDeps(v2Task("user-src"), [msgFrom("user-src", "outreach")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1", action: "outreach", ...assessmentQuery },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("counterparty");
  });

  test("seat attribution ignores speaking order: counterparty speaking first still cannot accept as initiator", async () => {
    // Continuation where the counterparty spoke first: 1 message from user-cand.
    // Parity would call the next speaker "candidate"; senderId-based turn-taking
    // correctly gives the turn to user-src, and seat still keys on the stamp.
    const { deps, createdMessages } = makeDeps(v2Task("user-src"), [msgFrom("user-cand", "question")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const violation = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1", action: "accept", ...assessmentQuery },
    }));
    expect(violation.success).toBe(false);
    expect(violation.error).toContain("initiator");

    const ok = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1", action: "counter", message: "adjusting", ...assessmentQuery },
    }));
    expect(ok.success).toBe(true);
    expect(createdMessages[0].senderId).toBe("agent:user-src");
  });
});

describe("respond_to_negotiation — v1 grandfathering", () => {
  function v1Task() {
    return {
      id: "task-1",
      conversationId: "conv-1",
      state: "waiting_for_agent",
      metadata: { type: "negotiation", sourceUserId: "user-src", candidateUserId: "user-cand", maxTurns: 6 },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
  }

  test("in-flight v1 task accepts legacy propose", async () => {
    const { deps } = makeDeps(v1Task(), []);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1", action: "propose", ...assessmentQuery },
    }));

    expect(result.success).toBe(true);
  });

  test("in-flight v1 task accepts legacy reject (either party)", async () => {
    const { deps } = makeDeps(v1Task(), [msgFrom("user-src", "propose")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1", action: "reject", ...assessmentQuery },
    }));

    expect(result.success).toBe(true);
    expect(result.data.message).toContain("rejected");
  });

  test("v1 task rejects the v2-only vocabulary", async () => {
    const { deps } = makeDeps(v1Task(), [msgFrom("user-src", "propose")]);
    const tool = captureTool("respond_to_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1", action: "decline", ...assessmentQuery },
    }));

    expect(result.success).toBe(false);
    expect(result.error).toContain("v1");
  });
});

describe("get_negotiation — seat announcement", () => {
  test("returns seat, protocolVersion, and allowedActions for the caller", async () => {
    const { deps } = makeDeps(v2Task("user-src"), [msgFrom("user-src", "outreach")]);
    const tool = captureTool("get_negotiation", deps);

    const asInitiator = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1" },
    }));
    expect(asInitiator.data.seat).toBe("initiator");
    expect(asInitiator.data.protocolVersion).toBe("v2");
    expect(asInitiator.data.allowedActions).toEqual(["outreach", "counter", "question", "withdraw"]);
    expect(asInitiator.data.isUsersTurn).toBe(false);

    const asCounterparty = JSON.parse(await tool.handler({
      context: makeContext("user-cand"),
      query: { negotiationId: "task-1" },
    }));
    expect(asCounterparty.data.seat).toBe("counterparty");
    expect(asCounterparty.data.allowedActions).toEqual(["accept", "decline", "counter", "question"]);
    expect(asCounterparty.data.isUsersTurn).toBe(true);
  });

  test("v1 task announces the legacy vocabulary", async () => {
    const { deps } = makeDeps(
      { ...v2Task("user-src"), metadata: { type: "negotiation", sourceUserId: "user-src", candidateUserId: "user-cand" } },
      [],
    );
    const tool = captureTool("get_negotiation", deps);

    const result = JSON.parse(await tool.handler({
      context: makeContext("user-src"),
      query: { negotiationId: "task-1" },
    }));
    expect(result.data.protocolVersion).toBe("v1");
    expect(result.data.allowedActions).toEqual(["propose", "accept", "reject", "counter", "question"]);
  });
});
