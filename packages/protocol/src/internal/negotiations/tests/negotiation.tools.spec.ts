import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { buildLifecycleNarration, createNegotiationTools } from "../negotiation.tools.js";
import { readAuthorizedNegotiationDetail } from '../negotiation.detail-reader.js';
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

type Fixture<T> = T extends (...args: any[]) => unknown
  ? (...args: any[]) => any
  : T extends object
    ? { [K in keyof T]?: Fixture<T[K]> }
    : T;
type ToolDepsFixture = Fixture<ToolDeps>;

function makeContext(userId = "user-src", networkId?: string, intentId?: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(intentId
      ? { scopeType: 'intent' as const, scopeId: intentId }
      : networkId
        ? { scopeType: 'network' as const, scopeId: networkId }
        : {}),
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: ToolDepsFixture) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown; querySchema?: z.ZodType }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

function makeTask(
  state: string,
  sourceUserId: string,
  candidateUserId: string,
  options: { networkId?: string; id?: string; opportunityId?: string; maxTurns?: number | null; omitMaxTurns?: boolean } = {},
) {
  return {
    id: options.id ?? "task-1",
    conversationId: "conv-1",
    state,
    metadata: {
      type: "negotiation",
      sourceUserId,
      candidateUserId,
      ...(!options.omitMaxTurns ? { maxTurns: options.maxTurns ?? 6 } : {}),
      ...(options.networkId ? { networkId: options.networkId } : {}),
      ...(options.opportunityId ? { opportunityId: options.opportunityId } : {}),
    },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
  };
}

function makeMessage(action: string, reasoning: string, message: string | null, suggestedRoles = { ownUser: "peer", otherUser: "peer" }) {
  return {
    parts: [{ kind: "data", data: { action, assessment: { reasoning, suggestedRoles }, message } }],
  };
}

function makeSpeakerMessage(senderUserId: string, action: string) {
  return { ...makeMessage(action, 'reasoning', action), senderId: `agent:${senderUserId}` };
}

const settlementNoise = {
  senderId: 'system:index',
  parts: [{ kind: 'data', data: { action: 'consultation_settled' } }],
};

// ── isUsersTurn ────────────────────────────────────────────────────────────────

describe("list_negotiations — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false even when parity says it is their turn", async () => {
    // 1 message → parity says source's turn → but status=completed → must be false
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("outreach", "reasoning", "outreach message");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
        getNegotiationMessages: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.success).toBe(true);
    expect(result.data.negotiations[0].isUsersTurn).toBe(false);
  });

  test("active negotiation with 0 messages → source's turn → isUsersTurn=true for source", async () => {
    const task = makeTask("working", "user-src", "user-cand");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations[0].status).toBe("active");
    expect(result.data.negotiations[0].isUsersTurn).toBe(true);
  });

  test.each(['user-src', 'user-cand'] as const)(
    'retains the %s floor after ask_user and ignores settlement noise',
    async (speaker) => {
      const task = makeTask('waiting_for_agent', 'user-src', 'user-cand');
      const other = speaker === 'user-src' ? 'user-cand' : 'user-src';
      const deps = {
        negotiationDatabase: {
          getTasksForUser: async () => [task],
          getMessagesForConversation: async () => [
            makeSpeakerMessage(other, 'counter'),
            makeSpeakerMessage(speaker, 'ask_user'),
            settlementNoise,
          ],
        },
      };

      const tool = captureTool('list_negotiations', deps);
      const result = JSON.parse(await tool.handler({ context: makeContext(speaker), query: {} }));

      expect(result.data.negotiations[0].isUsersTurn).toBe(true);
    },
  );
});

// ── latestMessagePreview ───────────────────────────────────────────────────────

describe("list_negotiations — latestMessagePreview", () => {
  test("uses message field, not assessment.reasoning", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "Internal chain-of-thought reasoning here.", "I accept this connection.");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
        getNegotiationMessages: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    const preview = result.data.negotiations[0].latestMessagePreview;
    expect(preview).toBe("I accept this connection.");
    expect(preview).not.toContain("chain-of-thought");
  });

  test("returns null preview when message is null", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "Internal reasoning.", null);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
        getNegotiationMessages: async () => [msg],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations[0].latestMessagePreview).toBeNull();
  });
});

// ── pagination ─────────────────────────────────────────────────────────────────

describe("list_negotiations — pagination", () => {
  function makeTasks(n: number) {
    return Array.from({ length: n }, (_, i) =>
      makeTask("completed", "user-src", `user-cand-${i}`)
    ).map((t, i) => ({ ...t, id: `task-${i}` }));
  }

  test("returns first page with limit=2", async () => {
    const tasks = makeTasks(5);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { limit: 2, page: 1 } })
    );

    expect(result.data.negotiations).toHaveLength(2);
    expect(result.data.totalCount).toBe(5);
    expect(result.data.totalPages).toBe(3);
    expect(result.data.page).toBe(1);
  });

  test("returns second page", async () => {
    const tasks = makeTasks(5);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { limit: 2, page: 2 } })
    );

    expect(result.data.negotiations).toHaveLength(2);
    expect(result.data.page).toBe(2);
  });

  test("returns partial last page", async () => {
    const tasks = makeTasks(5);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { limit: 2, page: 3 } })
    );

    expect(result.data.negotiations).toHaveLength(1);
    expect(result.data.totalPages).toBe(3);
    expect(result.data.page).toBe(3);
  });

  test("no pagination params → returns all results without totalCount", async () => {
    const tasks = makeTasks(3);

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations).toHaveLength(3);
    expect(result.data.totalCount).toBeUndefined();
  });
});

// ── intent-scope enforcement ──────────────────────────────────────────────────

describe("list_negotiations — intent scope", () => {
  test("clamps the pinned signal to matching actor intent and drops unresolvable tasks", async () => {
    const matching = makeTask("working", "user-src", "user-cand", { id: "task-match", opportunityId: "opp-match" });
    const differentIntent = makeTask("working", "user-src", "user-cand", { id: "task-other", opportunityId: "opp-other" });
    const withoutOpportunity = makeTask("working", "user-src", "user-cand", { id: "task-legacy" });
    const withoutIntent = makeTask("working", "user-src", "user-cand", { id: "task-no-intent", opportunityId: "opp-no-intent" });
    let intentLookupCalls = 0;
    const getIntentIdsForOpportunities = async (ids: string[]) => {
      intentLookupCalls += 1;
      return Object.fromEntries(
        ids.map((id) => [id, id === "opp-match" ? "intent-pinned" : id === "opp-no-intent" ? null : "intent-other"]),
      );
    };

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [matching, differentIntent, withoutOpportunity, withoutIntent],
        getIntentIdsForOpportunities,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src", undefined, "intent-pinned"), query: {} }),
    );

    expect(result.data.scope).toBe("signal");
    expect(result.data.intentId).toBe("intent-pinned");
    expect(result.data.negotiations.map((negotiation: { id: string }) => negotiation.id)).toEqual(["task-match"]);
    expect(intentLookupCalls).toBe(1);
  });

  test("scope:'all' widens a pinned session and reports the explicit scope", async () => {
    const first = makeTask("completed", "user-src", "user-cand", { id: "task-1" });
    const second = makeTask("working", "user-src", "user-other", { id: "task-2" });
    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [first, second],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-src", undefined, "intent-pinned"),
        query: { scope: "all" },
      }),
    );

    expect(result.data.scope).toBe("all");
    expect(result.data.negotiations).toHaveLength(2);
  });

  test("defaults an unpinned session to all negotiations", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} }),
    );

    expect(result.data.scope).toBe("all");
    expect(result.data.negotiations).toHaveLength(1);
  });
});

// ── get_negotiation isUsersTurn ───────────────────────────────────────────────

describe("get_negotiation — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "reasoning", "accepted");

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [msg],
        getNegotiationMessages: async () => [msg],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: { negotiationId: "task-1" } })
    );

    expect(result.success).toBe(true);
    expect(result.data.isUsersTurn).toBe(false);
  });
});

describe('readAuthorizedNegotiationDetail', () => {
  test('projects sender-derived turns and authoritative lifecycle without H2H evidence', async () => {
    const detail = await readAuthorizedNegotiationDetail({
      task: {
        id: 'task-1',
        conversationId: 'conv-1',
        state: 'completed',
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
      metadata: {
        sourceUserId: 'user-src',
        candidateUserId: 'user-cand',
        opportunityId: 'opp-1',
        protocolVersion: 'v2',
        initiatorUserId: 'user-src',
      },
      callerUserId: 'user-cand',
      callerRole: 'candidate',
      readMessages: async () => [{
        senderId: 'agent:user-src',
        parts: [{ kind: 'data', data: { action: 'outreach', assessment: { reasoning: 'Agent assessment', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } }, message: 'Hello' } }],
        createdAt: new Date('2026-01-01'),
      }],
      readArtifacts: async () => [{ name: 'negotiation-outcome', parts: [{ kind: 'data', data: { hasOpportunity: true } }] }],
      readLifecycleEvidence: async () => ({ 'opp-1': { status: 'accepted', acceptedByOwner: false } }),
    });

    expect(detail.role).toBe('candidate');
    expect(detail.turns[0].speaker).toBe('source');
    expect(detail.isUsersTurn).toBe(false);
    expect(detail.seat).toBe('counterparty');
    expect(detail.lifecycle).toMatchObject({
      opportunityStatus: 'accepted',
      ownerAction: 'not_recorded',
      directConversationEvidence: 'not_provided',
    });
    expect(detail.lifecycle.lifecycleLabel).not.toMatch(/owner explicitly accepted|completed connection|H2H/i);
  });

  test.each([
    ['source', 'user-src', 'user-cand'],
    ['candidate', 'user-cand', 'user-src'],
  ] as const)('retains the %s caller floor for the ask_user successor', async (callerRole, callerUserId, otherUserId) => {
    const at = new Date('2026-01-01');
    const detail = await readAuthorizedNegotiationDetail({
      task: {
        id: 'task-1', conversationId: 'conv-1', state: 'waiting_for_agent',
        createdAt: at, updatedAt: at,
      },
      metadata: { sourceUserId: 'user-src', candidateUserId: 'user-cand' },
      callerUserId,
      callerRole,
      readMessages: async () => [
        { ...makeSpeakerMessage(otherUserId, 'counter'), createdAt: at },
        { ...makeSpeakerMessage(callerUserId, 'ask_user'), createdAt: at },
        { ...settlementNoise, createdAt: at },
      ],
      readArtifacts: async () => [],
      readLifecycleEvidence: async () => ({}),
    });

    expect(detail.isUsersTurn).toBe(true);
  });
});

// ── respond_to_negotiation — schema validation ───────────────────────────────

describe("respond_to_negotiation — schema validation", () => {
  const tool = captureTool("respond_to_negotiation", {});
  const schema = tool.querySchema! as z.ZodType;

  const validQuery = {
    negotiationId: "task-1",
    action: "accept",
    reasoning: "Good fit for collaboration",
    suggestedRoles: { ownUser: "peer", otherUser: "peer" },
  };

  test("accepts valid input with all required fields", () => {
    const result = schema.safeParse(validQuery);
    expect(result.success).toBe(true);
  });

  test("accepts outreach action", () => {
    const result = schema.safeParse({ ...validQuery, action: "outreach" });
    expect(result.success).toBe(true);
  });

  test("accepts optional message field", () => {
    const result = schema.safeParse({ ...validQuery, action: "counter", message: "I'd like to adjust scope" });
    expect(result.success).toBe(true);
  });

  test("rejects missing reasoning", () => {
    const { reasoning: _, ...without } = validQuery;
    const result = schema.safeParse(without);
    expect(result.success).toBe(false);
  });

  test("rejects missing suggestedRoles", () => {
    const { suggestedRoles: _, ...without } = validQuery;
    const result = schema.safeParse(without);
    expect(result.success).toBe(false);
  });

  test("rejects invalid role value", () => {
    const result = schema.safeParse({
      ...validQuery,
      suggestedRoles: { ownUser: "leader", otherUser: "peer" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid action", () => {
    const result = schema.safeParse({ ...validQuery, action: "negotiate" });
    expect(result.success).toBe(false);
  });

  test("accepts all valid role combinations", () => {
    for (const ownUser of ["agent", "patient", "peer"]) {
      for (const otherUser of ["agent", "patient", "peer"]) {
        const result = schema.safeParse({ ...validQuery, suggestedRoles: { ownUser, otherUser } });
        expect(result.success).toBe(true);
      }
    }
  });
});

// ── respond_to_negotiation — turn data and success messages ──────────────────

describe("respond_to_negotiation — handler", () => {
  function makeRespondDeps(turnCount: number, opts?: {
    dispatchResult?: unknown;
    maxTurns?: number | null;
    omitMaxTurns?: boolean;
    messages?: Array<{ senderId?: string; parts: unknown[] }>;
  }) {
    const createdMessages: unknown[] = [];
    const taskStates: string[] = [];
    const artifacts: unknown[] = [];
    const dispatchPayloads: unknown[] = [];
    return {
      deps: {
        negotiationDatabase: {
          getTask: async () => makeTask("waiting_for_agent", "user-src", "user-cand", {
            ...(opts?.omitMaxTurns ? { omitMaxTurns: true } : {}),
            ...(opts && Object.hasOwn(opts, 'maxTurns') ? { maxTurns: opts.maxTurns } : {}),
          }),
          getMessagesForConversation: async () => opts?.messages ?? Array.from({ length: turnCount }, () => ({
            ...makeMessage("counter", "r", "m"),
            senderId: 'agent:user-cand',
          })),
          createMessage: async (msg: unknown) => { createdMessages.push(msg); return { id: "msg-1", senderId: "s", role: "agent", parts: [], createdAt: new Date() }; },
          updateTaskState: async (_id: string, state: string) => { taskStates.push(state); },
          createArtifact: async (artifact: unknown) => { artifacts.push(artifact); },
        },
        negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
        agentDispatcher: { dispatch: async (_userId: string, _scope: unknown, payload: unknown) => {
          dispatchPayloads.push(payload);
          return opts?.dispatchResult ?? { handled: false, reason: "waiting" };
        } },
      } as ToolDepsFixture,
      createdMessages,
      taskStates,
      artifacts,
      dispatchPayloads,
    };
  }

  test.each(['user-src', 'user-cand'] as const)(
    'admits the %s ask_user consultation successor and persists its response',
    async (speaker) => {
      const other = speaker === 'user-src' ? 'user-cand' : 'user-src';
      const fixture = makeRespondDeps(3, {
        messages: [
          makeSpeakerMessage(other, 'counter'),
          makeSpeakerMessage(speaker, 'ask_user'),
          settlementNoise,
        ],
      });
      const tool = captureTool('respond_to_negotiation', fixture.deps);

      const result = JSON.parse(await tool.handler({
        context: makeContext(speaker),
        query: {
          negotiationId: 'task-1',
          action: 'counter',
          reasoning: 'Consultation resolved',
          suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
          message: 'Continue after consultation',
        },
      }));

      expect(result.success).toBe(true);
      expect(fixture.createdMessages).toHaveLength(1);
    },
  );

  test("turn data uses query.reasoning and query.suggestedRoles", async () => {
    const { deps, createdMessages } = makeRespondDeps(0);
    const tool = captureTool("respond_to_negotiation", deps);

    await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "outreach",
        reasoning: "Strong synergy",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
    });

    const msg = createdMessages[0] as { parts: Array<{ data: { assessment: { reasoning: string; suggestedRoles: { ownUser: string; otherUser: string } } } }> };
    const turnData = msg.parts[0].data;
    expect(turnData.assessment.reasoning).toBe("Strong synergy");
    expect(turnData.assessment.suggestedRoles).toEqual({ ownUser: "agent", otherUser: "patient" });
  });

  test.each([
    ["uncapped zero", { maxTurns: 0 }, 20, false],
    ["absent defaults to six", { omitMaxTurns: true }, 5, true],
    ["positive boundary", { maxTurns: 3 }, 2, true],
    ["positive before boundary", { maxTurns: 4 }, 2, false],
  ] as const)("respond tool applies %s cap semantics", async (_label, options, priorTurns, completed) => {
    const fixture = makeRespondDeps(priorTurns, options);
    const tool = captureTool("respond_to_negotiation", fixture.deps);

    await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Continue",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "Keep negotiating",
      },
    });

    expect(fixture.taskStates.includes("completed")).toBe(completed);
    expect(fixture.artifacts.length > 0).toBe(completed);
    expect(fixture.dispatchPayloads.length > 0).toBe(!completed);
  });

  test.each([
    ["uncapped zero", { maxTurns: 0 }, 20, false],
    ["absent defaults to six", { omitMaxTurns: true }, 4, true],
    ["positive next-turn boundary", { maxTurns: 4 }, 2, true],
    ["positive before next-turn boundary", { maxTurns: 5 }, 2, false],
  ] as const)("counterparty dispatch applies %s final-turn semantics", async (_label, options, priorTurns, expectedFinal) => {
    const fixture = makeRespondDeps(priorTurns, options);
    const tool = captureTool("respond_to_negotiation", fixture.deps);

    await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Continue",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "Keep negotiating",
      },
    });

    expect(fixture.dispatchPayloads[0]).toMatchObject({ isFinalTurn: expectedFinal });
  });

  test("accept finalizes with correct success message", async () => {
    const { deps } = makeRespondDeps(1, { messages: [{ ...makeMessage("outreach", "r", "m"), senderId: "agent:user-src" }] });
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "accept",
        reasoning: "Looks good",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toBe("Negotiation accepted. An opportunity has been created.");
  });

  test("decline finalizes with correct success message", async () => {
    const { deps } = makeRespondDeps(1, { messages: [{ ...makeMessage("outreach", "r", "m"), senderId: "agent:user-src" }] });
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-cand"),
      query: {
        negotiationId: "task-1",
        action: "decline",
        reasoning: "Not a fit",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toBe("Negotiation declined.");
  });

  test("outreach waiting uses 'Outreach' label, not 'Counter-proposal'", async () => {
    const { deps } = makeRespondDeps(0);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "outreach",
        reasoning: "Let's explore",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toContain("Outreach submitted");
    expect(result.data.message).not.toContain("Counter");
  });

  test("counter waiting uses 'Counter-proposal' label", async () => {
    const { deps } = makeRespondDeps(2);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "counter",
        reasoning: "Need to adjust",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "Adjusting scope",
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toContain("Counter-proposal submitted");
  });

  test("question waiting uses 'Question' label", async () => {
    const { deps } = makeRespondDeps(2);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "question",
        reasoning: "Need more info",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        message: "What's the timeline?",
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toContain("Question submitted");
  });
});

// ── network-scope enforcement ─────────────────────────────────────────────────
//
// When `context.scopeType/scopeId` is set (i.e. the caller's API key carries a
// network-scoped agent), every negotiation tool must refuse to surface or act
// on tasks tied to a different network. Tasks created before this hardening
// landed have no `networkId` in their metadata; for those legacy tasks we fall
// back to the per-task `turnContext.indexContext.networkId` once it has been
// persisted (after the first park).

describe("list_negotiations — network scope", () => {
  test("filters out tasks not in the caller's bound network when scope envelope is set", async () => {
    const inScope = makeTask("working", "user-src", "user-cand", { id: "task-in", networkId: "net-A" });
    const outOfScope = makeTask("working", "user-src", "user-cand", { id: "task-out", networkId: "net-B" });

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [inScope, outOfScope],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src", "net-A"), query: {} })
    );

    expect(result.success).toBe(true);
    expect(result.data.negotiations).toHaveLength(1);
    expect(result.data.negotiations[0].id).toBe("task-in");
  });

  test("returns all tasks when scope envelope is unset (global agent)", async () => {
    const t1 = makeTask("working", "user-src", "user-cand", { id: "task-1", networkId: "net-A" });
    const t2 = makeTask("working", "user-src", "user-cand", { id: "task-2", networkId: "net-B" });

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [t1, t2],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations).toHaveLength(2);
  });

  test("excludes legacy tasks (no networkId in metadata) when caller is scoped", async () => {
    // Defense in depth: a network-bound agent must not see negotiations whose
    // network we cannot prove. Legacy tasks created before this change have no
    // `metadata.networkId` and no parked `turnContext` — we drop them rather
    // than fall back to the global view.
    const legacy = makeTask("working", "user-src", "user-cand", { id: "task-legacy" });

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [legacy],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src", "net-A"), query: {} })
    );

    expect(result.data.negotiations).toHaveLength(0);
  });
});

// ── list_negotiations — detail:"narrative" ──────────────────────────────────

describe('list_negotiations — detail:"narrative"', () => {
  function makeTaskWithContext(
    state: string,
    sourceUserId: string,
    candidateUserId: string,
    opts: { networkId?: string; id?: string; indexContextPrompt?: string } = {},
  ) {
    return {
      id: opts.id ?? "task-1",
      conversationId: "conv-1",
      state,
      metadata: {
        type: "negotiation",
        sourceUserId,
        candidateUserId,
        maxTurns: 6,
        ...(opts.networkId ? { networkId: opts.networkId } : {}),
        turnContext: {
          indexContext: { networkId: opts.networkId ?? "net-1", prompt: opts.indexContextPrompt ?? "A community for AI researchers." },
          sourceUser: {},
          candidateUser: {},
          seedAssessment: {},
        },
      },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
  }

  test('summary mode (default) does not include narrative fields', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: {} })
    );

    const item = result.data.negotiations[0];
    expect(item.indexContext).toBeUndefined();
    expect(item.recentTurns).toBeUndefined();
    expect(item.outcome).toBeUndefined();
  });

  test('narrative mode includes indexContext from task metadata', async () => {
    const task = makeTaskWithContext('working', 'user-src', 'user-cand', {
      indexContextPrompt: 'Frontier biotech research community.',
    });

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const item = result.data.negotiations[0];
    expect(item.indexContext).not.toBeNull();
    expect(item.indexContext.prompt).toBe('Frontier biotech research community.');
  });

  test('narrative mode returns indexContext:null for legacy tasks without turnContext', async () => {
    const task = makeTask('working', 'user-src', 'user-cand'); // no turnContext

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    expect(result.data.negotiations[0].indexContext).toBeNull();
  });

  test('narrative mode includes recentTurns — last 3 when more than 3 messages exist', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');
    const messages = [
      makeMessage('outreach', 'r1', 'turn 1'),
      makeMessage('counter', 'r2', 'turn 2'),
      makeMessage('counter', 'r3', 'turn 3'),
      makeMessage('counter', 'r4', 'turn 4'),
      makeMessage('question', 'r5', 'turn 5'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
        getNegotiationMessages: async () => messages,
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const turns = result.data.negotiations[0].recentTurns;
    expect(turns).toHaveLength(3);
    expect(turns[0].turnNumber).toBe(3);
    expect(turns[0].message).toBe('turn 3');
    expect(turns[2].turnNumber).toBe(5);
    expect(turns[2].message).toBe('turn 5');
  });

  test('narrative mode recentTurns — fewer than 3 messages returns all', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');
    const messages = [
      makeMessage('outreach', 'r1', 'only turn'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
        getNegotiationMessages: async () => messages,
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const turns = result.data.negotiations[0].recentTurns;
    expect(turns).toHaveLength(1);
    expect(turns[0].turnNumber).toBe(1);
    expect(turns[0].action).toBe('outreach');
    expect(turns[0].message).toBe('only turn');
  });

  test('narrative mode recentTurns — assigns own/other role relative to caller', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');
    // turn 1: source speaks (index 0, even → source). Caller is source → own
    // turn 2: candidate speaks (index 1, odd → candidate). Caller is source → other
    const messages = [
      makeMessage('outreach', 'r1', 'source speaks'),
      makeMessage('counter', 'r2', 'candidate speaks'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
        getNegotiationMessages: async () => messages,
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const turns = result.data.negotiations[0].recentTurns;
    expect(turns[0].role).toBe('own');   // source calling for source → own
    expect(turns[1].role).toBe('other'); // candidate speaking → other
  });

  test('narrative mode — active negotiation has outcome:null without hitting artifacts DB', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');
    let artifactsCalled = false;

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => { artifactsCalled = true; return []; },
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    expect(result.data.negotiations[0].outcome).toBeNull();
    expect(artifactsCalled).toBe(false);
  });

  test('narrative mode — completed negotiation includes outcome from artifact', async () => {
    const task = makeTask('completed', 'user-src', 'user-cand');
    const outcomeData = { hasOpportunity: true, reasoning: 'Strong alignment.', turnCount: 4 };
    const artifact = {
      name: 'negotiation-outcome',
      parts: [{ kind: 'data', data: outcomeData }],
    };

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => [artifact],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const item = result.data.negotiations[0];
    expect(item.outcome).not.toBeNull();
    expect(item.outcome.hasOpportunity).toBe(true);
    expect(item.outcome.reasoning).toBe('Strong alignment.');
  });

  test('narrative mode — completed negotiation with no artifact has outcome:null', async () => {
    const task = makeTask('completed', 'user-src', 'user-cand');

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    expect(result.data.negotiations[0].outcome).toBeNull();
  });

  test('mixed concluded history preserves opportunity lifecycle and supplies no H2H evidence', async () => {
    const statuses = ['pending', 'rejected', 'stalled', 'draft', 'expired'] as const;
    const tasks = statuses.map((status) => makeTask(
      'completed',
      'user-src',
      `user-${status}`,
      { id: `task-${status}`, opportunityId: `opp-${status}` },
    ));
    let requestedOpportunityIds: string[] = [];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [
          makeMessage('accept', 'Agent-side assessment.', 'I accept this potential match.'),
        ],
        getNegotiationMessages: async () => [
          makeMessage('accept', 'Agent-side assessment.', 'I accept this potential match.'),
        ],
        getArtifactsForTask: async () => [{
          name: 'negotiation-outcome',
          parts: [{ kind: 'data', data: { hasOpportunity: true } }],
        }],
        getOpportunityLifecyclesForNegotiations: async (opportunityIds: string[]) => {
          requestedOpportunityIds = opportunityIds;
          return Object.fromEntries(statuses.map((status) => [`opp-${status}`, {
            status,
            acceptedByOwner: false,
          }]));
        },
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    expect(requestedOpportunityIds).toEqual(statuses.map((status) => `opp-${status}`));
    const byStatus = Object.fromEntries(result.data.negotiations.map((item: {
      lifecycle: { opportunityStatus: string };
    }) => [item.lifecycle.opportunityStatus, item]));

    expect(byStatus.pending.lifecycle).toEqual({
      agentNegotiation: 'concluded',
      opportunityStatus: 'pending',
      connectionState: 'potential_match_awaiting_owner_review',
      ownerAction: 'not_recorded',
      directConversationEvidence: 'not_provided',
      lifecycleLabel: "Agents concluded with a potential match; awaiting the owner's review.",
    });
    expect(byStatus.rejected.lifecycle.connectionState).toBe('rejected');
    expect(byStatus.stalled.lifecycle.connectionState).toBe('negotiation_stalled');
    expect(byStatus.draft.lifecycle.connectionState).toBe('draft_not_sent');
    expect(byStatus.expired.lifecycle.connectionState).toBe('expired');

    const labels = Object.values(byStatus)
      .map((item) => item.lifecycle.lifecycleLabel)
      .join(' ');
    expect(labels).not.toMatch(/\b(?:I|you) accepted\b/i);
    expect(labels).not.toMatch(/completed connection/i);
    expect(labels).not.toMatch(/direct (?:conversation|message)|message thread/i);
    for (const item of Object.values(byStatus)) {
      expect(item.latestActionActor).toBe('agent');
      expect(item.recentTurns[0].actionActor).toBe('agent');
      expect(item.lifecycle.ownerAction).toBe('not_recorded');
      expect(item.lifecycle.directConversationEvidence).toBe('not_provided');
    }
  });

  test('owner acceptance wording requires persisted owner-acceptor evidence', async () => {
    const tasks = [
      makeTask('completed', 'user-src', 'user-owner', { id: 'task-owner', opportunityId: 'opp-owner' }),
      makeTask('completed', 'user-src', 'user-other', { id: 'task-other', opportunityId: 'opp-other' }),
    ];
    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => tasks,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getOpportunityLifecyclesForNegotiations: async () => ({
          'opp-owner': { status: 'accepted', acceptedByOwner: true },
          'opp-other': { status: 'accepted', acceptedByOwner: false },
        }),
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(await tool.handler({ context: makeContext('user-src'), query: {} }));
    const byId = Object.fromEntries(result.data.negotiations.map((item: { id: string }) => [item.id, item]));

    expect(byId['task-owner'].lifecycle.ownerAction).toBe('accepted');
    expect(byId['task-owner'].lifecycle.connectionState).toBe('owner_accepted');
    expect(byId['task-owner'].lifecycle.lifecycleLabel).toBe('The owner explicitly accepted this opportunity.');
    expect(byId['task-other'].lifecycle.ownerAction).toBe('not_recorded');
    expect(byId['task-other'].lifecycle.connectionState).toBe('accepted_without_owner_evidence');
    expect(byId['task-other'].lifecycle.lifecycleLabel).not.toMatch(/\b(?:I|you) accepted\b/i);
    expect(byId['task-owner'].lifecycle.directConversationEvidence).toBe('not_provided');
    expect(byId['task-other'].lifecycle.directConversationEvidence).toBe('not_provided');
  });

  test('lifecycle narration preserves active, waiting, lifecycle, and unavailable branch labels', () => {
    expect(buildLifecycleNarration('active', { status: 'pending', acceptedByOwner: false })).toMatchObject({
      agentNegotiation: 'in_progress',
      connectionState: 'potential_match_awaiting_owner_review',
      lifecycleLabel: "A potential match is awaiting the owner's review.",
    });
    expect(buildLifecycleNarration('waiting_for_agent', { status: 'negotiating', acceptedByOwner: false })).toMatchObject({
      agentNegotiation: 'awaiting_agent',
      connectionState: 'agents_negotiating',
      lifecycleLabel: 'The agents are still negotiating; no owner decision is recorded.',
    });
    expect(buildLifecycleNarration('paused', { status: 'latent', acceptedByOwner: false })).toMatchObject({
      agentNegotiation: 'unknown',
      connectionState: 'latent',
      lifecycleLabel: 'The potential match is latent; no owner decision is recorded.',
    });
    expect(buildLifecycleNarration('completed')).toEqual({
      agentNegotiation: 'concluded',
      opportunityStatus: null,
      connectionState: 'unknown',
      ownerAction: 'not_recorded',
      directConversationEvidence: 'not_provided',
      lifecycleLabel: 'The agent negotiation concluded; the current opportunity lifecycle is unavailable.',
    });
  });
});

describe("get_negotiation — network scope", () => {
  test("returns access denied when task is in a different network than caller's scope", async () => {
    const task = makeTask("working", "user-src", "user-cand", { networkId: "net-B" });

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-src", "net-A"),
        query: { negotiationId: "task-1" },
      })
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network scope|not in your bound|not in scope/i);
  });

  test("returns the task when task's network matches caller's scope", async () => {
    const task = makeTask("working", "user-src", "user-cand", { networkId: "net-A" });

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-src", "net-A"),
        query: { negotiationId: "task-1" },
      })
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("task-1");
    expect(result.data.conversationType).toBe("agent_negotiation");
    expect(result.data.lifecycle.directConversationEvidence).toBe("not_provided");
  });
});

describe("get_negotiation — participant-only A2A visibility (IND-608)", () => {
  test("denies a third party who is neither source nor candidate, without reading the transcript", async () => {
    let messageReads = 0;
    let artifactReads = 0;
    const task = makeTask("working", "user-src", "user-cand");
    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => { messageReads += 1; return []; },
        getNegotiationMessages: async () => { messageReads += 1; return []; },
        getArtifactsForTask: async () => { artifactReads += 1; return []; },
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({
        // A logged-in user who is not a party to this A2A negotiation.
        context: makeContext("user-outsider"),
        query: { negotiationId: "task-1" },
      })
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a party to this negotiation/i);
    // The A2A transcript and artifacts are never read for a non-participant.
    expect(messageReads).toBe(0);
    expect(artifactReads).toBe(0);
  });

  test("admits a participating party (candidate) and projects the counterparty seat", async () => {
    const task = makeTask("working", "user-src", "user-cand");
    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool("get_negotiation", deps);
    const result = JSON.parse(
      await tool.handler({
        context: makeContext("user-cand"),
        query: { negotiationId: "task-1" },
      })
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe("task-1");
  });
});

describe("respond_to_negotiation — network scope", () => {
  test("refuses to respond on a task from a different network", async () => {
    const outOfScope = {
      ...makeTask("waiting_for_agent", "user-src", "user-cand", { networkId: "net-B" }),
    };

    const deps = {
      negotiationDatabase: {
        getTask: async () => outOfScope,
        getMessagesForConversation: async () => [],
        getNegotiationMessages: async () => [],
        createMessage: async () => { throw new Error("must not be called"); },
        updateTaskState: async () => { throw new Error("must not be called"); },
        createArtifact: async () => { throw new Error("must not be called"); },
      },
      negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
    };

    const tool = captureTool("respond_to_negotiation", deps);
    const raw = await tool.handler({
      context: makeContext("user-src", "net-A"),
      query: {
        negotiationId: "task-1",
        action: "accept",
        reasoning: "looks good",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/network scope|not in your bound|not in scope/i);
  });
});
