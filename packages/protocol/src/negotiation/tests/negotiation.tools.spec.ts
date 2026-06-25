import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createNegotiationTools } from "../negotiation.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

function makeContext(userId = "user-src", networkId?: string): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
    ...(networkId ? { scopeType: 'network' as const, scopeId: networkId } : {}),
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

function makeTask(
  state: string,
  sourceUserId: string,
  candidateUserId: string,
  options: { networkId?: string; id?: string } = {},
) {
  return {
    id: options.id ?? "task-1",
    conversationId: "conv-1",
    state,
    metadata: {
      type: "negotiation",
      sourceUserId,
      candidateUserId,
      maxTurns: 6,
      ...(options.networkId ? { networkId: options.networkId } : {}),
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

// ── isUsersTurn ────────────────────────────────────────────────────────────────

describe("list_negotiations — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false even when parity says it is their turn", async () => {
    // 1 message → parity says source's turn → but status=completed → must be false
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("propose", "reasoning", "proposal message");

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => [msg],
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
      },
    };

    const tool = captureTool("list_negotiations", deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext("user-src"), query: {} })
    );

    expect(result.data.negotiations[0].status).toBe("active");
    expect(result.data.negotiations[0].isUsersTurn).toBe(true);
  });
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

// ── get_negotiation isUsersTurn ───────────────────────────────────────────────

describe("get_negotiation — isUsersTurn", () => {
  test("completed negotiation always returns isUsersTurn=false", async () => {
    const task = makeTask("completed", "user-src", "user-cand");
    const msg = makeMessage("accept", "reasoning", "accepted");

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [msg],
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

  test("accepts propose action", () => {
    const result = schema.safeParse({ ...validQuery, action: "propose" });
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
  function makeRespondDeps(turnCount: number, opts?: { dispatchResult?: unknown }) {
    const createdMessages: unknown[] = [];
    return {
      deps: {
        negotiationDatabase: {
          getTask: async () => makeTask("waiting_for_agent", "user-src", "user-cand"),
          getMessagesForConversation: async () => Array(turnCount).fill(makeMessage("counter", "r", "m")),
          createMessage: async (msg: unknown) => { createdMessages.push(msg); return { id: "msg-1", senderId: "s", role: "agent", parts: [], createdAt: new Date() }; },
          updateTaskState: async () => {},
          createArtifact: async () => {},
        },
        negotiationTimeoutQueue: { cancelTimeout: async () => {}, enqueueTimeout: async () => {} },
        agentDispatcher: { dispatch: async () => opts?.dispatchResult ?? { handled: false, reason: "waiting" } },
      } as Partial<ToolDeps>,
      createdMessages,
    };
  }

  test("turn data uses query.reasoning and query.suggestedRoles", async () => {
    const { deps, createdMessages } = makeRespondDeps(0);
    const tool = captureTool("respond_to_negotiation", deps);

    await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "propose",
        reasoning: "Strong synergy",
        suggestedRoles: { ownUser: "agent", otherUser: "patient" },
      },
    });

    const msg = createdMessages[0] as { parts: Array<{ data: { assessment: { reasoning: string; suggestedRoles: { ownUser: string; otherUser: string } } } }> };
    const turnData = msg.parts[0].data;
    expect(turnData.assessment.reasoning).toBe("Strong synergy");
    expect(turnData.assessment.suggestedRoles).toEqual({ ownUser: "agent", otherUser: "patient" });
  });

  test("accept finalizes with correct success message", async () => {
    const { deps } = makeRespondDeps(2);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
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

  test("reject finalizes with correct success message", async () => {
    const { deps } = makeRespondDeps(2);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "reject",
        reasoning: "Not a fit",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toBe("Negotiation rejected.");
  });

  test("propose waiting uses 'Proposal' label, not 'Counter-proposal'", async () => {
    const { deps } = makeRespondDeps(0);
    const tool = captureTool("respond_to_negotiation", deps);

    const raw = await tool.handler({
      context: makeContext("user-src"),
      query: {
        negotiationId: "task-1",
        action: "propose",
        reasoning: "Let's explore",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    });

    const result = JSON.parse(raw);
    expect(result.data.message).toContain("Proposal submitted");
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
      makeMessage('propose', 'r1', 'turn 1'),
      makeMessage('counter', 'r2', 'turn 2'),
      makeMessage('counter', 'r3', 'turn 3'),
      makeMessage('counter', 'r4', 'turn 4'),
      makeMessage('question', 'r5', 'turn 5'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
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
      makeMessage('propose', 'r1', 'only turn'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    const turns = result.data.negotiations[0].recentTurns;
    expect(turns).toHaveLength(1);
    expect(turns[0].turnNumber).toBe(1);
    expect(turns[0].action).toBe('propose');
    expect(turns[0].message).toBe('only turn');
  });

  test('narrative mode recentTurns — assigns own/other role relative to caller', async () => {
    const task = makeTask('working', 'user-src', 'user-cand');
    // turn 1: source speaks (index 0, even → source). Caller is source → own
    // turn 2: candidate speaks (index 1, odd → candidate). Caller is source → other
    const messages = [
      makeMessage('propose', 'r1', 'source speaks'),
      makeMessage('counter', 'r2', 'candidate speaks'),
    ];

    const deps = {
      negotiationDatabase: {
        getTasksForUser: async () => [task],
        getMessagesForConversation: async () => messages,
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
        getArtifactsForTask: async () => [],
      },
    };

    const tool = captureTool('list_negotiations', deps);
    const result = JSON.parse(
      await tool.handler({ context: makeContext('user-src'), query: { detail: 'narrative' } })
    );

    expect(result.data.negotiations[0].outcome).toBeNull();
  });
});

describe("get_negotiation — network scope", () => {
  test("returns access denied when task is in a different network than caller's scope", async () => {
    const task = makeTask("working", "user-src", "user-cand", { networkId: "net-B" });

    const deps = {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [],
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
