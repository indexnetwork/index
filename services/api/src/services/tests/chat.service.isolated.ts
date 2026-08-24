/** Tests for ChatSessionService with constructor-injected dependencies. */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';

// ─── Mock @indexnetwork/protocol ──────────────────────────────────────────────
// Intercepts `import { ChatGraphFactory, ChatTitleGenerator } from …`
// Must come before the service import.

let mockGraphInvoke: ReturnType<typeof mock>;
let mockTitleInvoke: ReturnType<typeof mock>;

mock.module("@indexnetwork/protocol", () => {
  mockGraphInvoke = mock(() =>
    Promise.resolve({ responseText: "agent reply", error: undefined })
  );
  mockTitleInvoke = mock(() => Promise.resolve("Generated Title"));

  return {
    ChatGraphFactory: class {
      persona: unknown;
      constructor(persona?: unknown) { this.persona = persona; }
      createGraph() {
        return { invoke: mockGraphInvoke };
      }
      withPersona(persona: unknown) { return new this.constructor(persona); }
      // Used by the factory getter — no-op stubs for the rest
      createStreamingGraph() { return { invoke: mockGraphInvoke }; }
      streamChatEventsWithContext() { return (async function* () {})(); }
      streamChatEvents() { return (async function* () {})(); }
    },
    ChatTitleGenerator: class {
      invoke = mockTitleInvoke;
    },
    PERSONAL_AGENT_PERSONA_ID: "personal",
    createPersonalAgentPersona: mock((opts?: { agentName?: string }, scope?: string) => ({ id: "personal", scope, ...opts })),
  };
});

// ─── Mock infrastructure adapters (instantiated in constructor) ───────────────
mock.module("../../adapters/database.adapter", () => ({
  conversationDatabaseAdapter: {},
  ConversationDatabaseAdapter: class {},
  ChatDatabaseAdapter: class {
    getNetwork = mock(() => Promise.resolve(null));
    isNetworkMember = mock(() => Promise.resolve(false));
    getIntent = mock(() =>
      Promise.resolve({
        id: "intent-001",
        userId: "user-001",
        summary: "Find a co-founder",
        payload: "",
        archivedAt: null,
      }),
    );
  },
}));
mock.module("../../adapters/embedder.adapter", () => ({
  EmbedderAdapter: class {},
}));
mock.module("../../adapters/scraper.adapter", () => ({
  ScraperAdapter: class {},
}));
mock.module("../../adapters/checkpointer.adapter", () => ({
  getCheckpointer: mock(() => Promise.resolve(undefined)),
}));

afterAll(() => {
  mock.restore();
});

import { ChatSessionService } from "../chat.service";
import type { ConversationDatabaseAdapter } from "../../adapters/database.adapter";

const graphFactory = {
  createGraph: () => ({ invoke: mockGraphInvoke }),
  createStreamingGraph: () => ({ invoke: mockGraphInvoke }),
  streamChatEventsWithContext: () => (async function* () {})(),
  streamChatEvents: () => (async function* () {})(),
};
const graphDatabase = {
  getNetwork: mock(() => Promise.resolve(null)),
  isNetworkMember: mock(() => Promise.resolve(false)),
  getIntent: mock(() => Promise.resolve({
    id: 'intent-001',
    userId: 'user-001',
    summary: 'Find a co-founder',
    payload: '',
    archivedAt: null,
  })),
};

function createService(db: ConversationDatabaseAdapter): ChatSessionService {
  return new ChatSessionService(db, { graphDatabase: graphDatabase as never });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MockDb = {
  [K in keyof ConversationDatabaseAdapter]: ReturnType<typeof mock>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_ID = "session-001";
const USER_ID = "user-001";
const OTHER_USER_ID = "user-999";

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    title: null,
    shareToken: null,
    persona: "orchestrator",
    networkId: null,
    scopeType: null,
    scopeId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    createChatSession: mock(() => Promise.resolve()),
    getChatSession: mock(() => Promise.resolve(null)),
    getUserChatSessions: mock(() => Promise.resolve([])),
    createChatMessage: mock(() => Promise.resolve()),
    updateChatSessionTimestamp: mock(() => Promise.resolve()),
    updateChatSessionIndex: mock(() => Promise.resolve()),
    updateChatSessionTitle: mock(() => Promise.resolve()),
    deleteChatSession: mock(() => Promise.resolve()),
    setChatShareToken: mock(() => Promise.resolve()),
    getChatSessionByShareToken: mock(() => Promise.resolve(null)),
    getChatSessionMessages: mock(() => Promise.resolve([])),
    verifyChatMessageOwnership: mock(() => Promise.resolve(false)),
    upsertChatMessageMetadata: mock(() => Promise.resolve()),
    upsertChatSessionMetadata: mock(() => Promise.resolve()),
    getChatMessageMetadataByIds: mock(() => Promise.resolve([])),
    getChatSessionMetadata: mock(() => Promise.resolve(undefined)),
    ...overrides,
  } as unknown as MockDb;
}

// ─── createSession ────────────────────────────────────────────────────────────

describe("ChatSessionService.resolveNegotiatorIntentSession", () => {
  it("recovers the raced session when create hits a Drizzle-wrapped 23505", async () => {
    // Drizzle wraps the pg error in DrizzleQueryError with the real error on
    // `cause` — the unique-violation detection must walk the cause chain, or a
    // benign create race (e.g. React StrictMode double-bootstrap) becomes a 500.
    const session = makeSession();
    const wrapped = new Error('Failed query: insert into "chat_session_scopes" (...)');
    (wrapped as { cause?: unknown }).cause = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505" },
    );

    let scopeLookups = 0;
    const db = createMockDb({
      getNegotiatorIntentChatSession: mock(() => {
        scopeLookups += 1;
        // First lookup: no session yet. Post-conflict re-read: the winner's row.
        return Promise.resolve(scopeLookups === 1 ? null : session);
      }),
      createNegotiatorIntentChatSession: mock(() => Promise.reject(wrapped)),
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const res = await svc.resolveNegotiatorIntentSession("user-001", "intent-001");

    if ("error" in res) throw new Error(`expected session, got error: ${res.error}`);
    expect(res.session.id).toBe(SESSION_ID);
    expect(res.created).toBe(false);
    expect(scopeLookups).toBe(2);
  });

  it("still rethrows non-unique-violation errors", async () => {
    const db = createMockDb({
      getNegotiatorIntentChatSession: mock(() => Promise.resolve(null)),
      createNegotiatorIntentChatSession: mock(() =>
        Promise.reject(new Error("connection refused")),
      ),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    expect(svc.resolveNegotiatorIntentSession("user-001", "intent-001")).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("ChatSessionService.createSession", () => {
  it("returns a UUID and persists the session", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const id = await svc.createSession(USER_ID, "My chat");

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(db.createChatSession).toHaveBeenCalledTimes(1);
    const [arg] = db.createChatSession.mock.calls[0] as [Record<string, unknown>];
    expect(arg.userId).toBe(USER_ID);
    expect(arg.title).toBe("My chat");
    expect(arg.id).toBe(id);
  });

  it("passes networkId when provided", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    await svc.createSession(USER_ID, undefined, "network-42");

    const [arg] = db.createChatSession.mock.calls[0] as [Record<string, unknown>];
    expect(arg.networkId).toBe("network-42");
  });

  it("persists the explicitly selected persona", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    await svc.createSession(USER_ID, undefined, undefined, undefined, "personal");

    const calls = db.createChatSession.mock.calls as Array<[Record<string, unknown>]>;
    expect(calls[0][0].persona).toBe("personal");
  });
});

// ─── persona policy ───────────────────────────────────────────────────────────

describe("ChatSessionService.resolveStreamPersonaPolicy", () => {
  const svc = new ChatSessionService(createMockDb() as unknown as ConversationDatabaseAdapter);

  it("resolves the one PersonalAgent persona for new and continued chats", () => {
    expect(svc.resolveStreamPersonaPolicy()).toEqual({ ok: true, persona: "personal" });
    expect(svc.resolveStreamPersonaPolicy({ storedPersona: "personal" }))
      .toEqual({ ok: true, persona: "personal" });
  });

  it("makes retired orchestrator and telegram history read-only", () => {
    for (const storedPersona of ["orchestrator", "telegram"]) {
      const result = svc.resolveStreamPersonaPolicy({ storedPersona });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected policy denial");
      expect(result.code).toBe("WEB_SIGNAL_SESSION_REQUIRED");
      expect(result.status).toBe(409);
      expect(result.action).toEqual({ type: "start_signal_session", href: "/" });
    }
  });

  // The retired persona rows (signal/negotiator/onboarding) are migrated to
  // 'personal', and reporter conversations were deleted by migration 0131 —
  // but the policy must still fail closed for any row that outlives its
  // migration. An unknown persona can never drive a turn.
  it("fails closed for unknown or unmigrated persisted personas", () => {
    for (const storedPersona of ["reporter", "signal", "negotiator", "onboarding", "unexpected"]) {
      expect(svc.resolveStreamPersonaPolicy({ storedPersona }))
        .toMatchObject({ ok: false, status: 409, code: "CHAT_PERSONA_UNSUPPORTED" });
    }
  });
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe("ChatSessionService.getSession", () => {
  it("returns the session when userId matches", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, USER_ID);

    expect(result).toEqual(session);
  });

  it("returns null when session does not exist", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, USER_ID);

    expect(result).toBeNull();
  });

  it("returns null when userId does not match session owner", async () => {
    const session = makeSession({ userId: USER_ID });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, OTHER_USER_ID);

    expect(result).toBeNull();
  });
});

// ─── getUserSessions ──────────────────────────────────────────────────────────

describe("ChatSessionService.getUserSessions", () => {
  it("requires an explicit persona and passes it straight through", async () => {
    const sessions = [makeSession(), makeSession({ id: "session-002" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getUserSessions(USER_ID, 10, "orchestrator");

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(USER_ID, 10, "orchestrator", {});
  });

  it("passes an explicit persona filter through to the adapter", async () => {
    const sessions = [makeSession({ persona: "negotiator" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getUserSessions(USER_ID, 10, "negotiator");

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(USER_ID, 10, "negotiator", {});
  });

  it("lists read-only and global PersonalAgent sessions for web history, excluding intent-pinned DMs", async () => {
    const sessions = [makeSession(), makeSession({ id: "personal-session", persona: "personal" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getWebUserSessions(USER_ID, 10);

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(
      USER_ID,
      10,
      ["orchestrator", "telegram", "personal"],
      { excludeIntentPinned: true },
    );
  });
});

// ─── addMessage ───────────────────────────────────────────────────────────────

describe("ChatSessionService.addMessage", () => {
  it("persists the message and returns a snowflake ID string", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const id = await svc.addMessage({
      sessionId: SESSION_ID,
      role: "user",
      content: "Hello!",
    });

    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(db.createChatMessage).toHaveBeenCalledTimes(1);
    const [arg] = db.createChatMessage.mock.calls[0] as [Record<string, unknown>];
    expect(arg.sessionId).toBe(SESSION_ID);
    expect(arg.role).toBe("user");
    expect(arg.content).toBe("Hello!");
  });

  it("updates the session timestamp after adding a message", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    await svc.addMessage({ sessionId: SESSION_ID, role: "assistant", content: "Hi" });

    expect(db.updateChatSessionTimestamp).toHaveBeenCalledWith(SESSION_ID);
  });
});

// ─── deleteSession ────────────────────────────────────────────────────────────

describe("ChatSessionService.deleteSession", () => {
  it("deletes the session and returns true for the owner", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.deleteSession(SESSION_ID, USER_ID);

    expect(result).toBe(true);
    expect(db.deleteChatSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("returns false and does not delete when user is not the owner", async () => {
    const session = makeSession({ userId: USER_ID });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.deleteSession(SESSION_ID, OTHER_USER_ID);

    expect(result).toBe(false);
    expect(db.deleteChatSession).not.toHaveBeenCalled();
  });
});

// ─── updateSessionTitle ───────────────────────────────────────────────────────

describe("ChatSessionService.updateSessionTitle", () => {
  it("updates title and returns true for the owner", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.updateSessionTitle(SESSION_ID, USER_ID, "New Title");

    expect(result).toBe(true);
    expect(db.updateChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, "New Title");
  });

  it("returns false and does not update for a non-owner", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.updateSessionTitle(SESSION_ID, USER_ID, "New Title");

    expect(result).toBe(false);
    expect(db.updateChatSessionTitle).not.toHaveBeenCalled();
  });
});

// ─── shareSession / unshareSession ────────────────────────────────────────────

describe("ChatSessionService.shareSession", () => {
  it("creates and returns a share token for the owner", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const token = await svc.shareSession(SESSION_ID, USER_ID);

    expect(typeof token).toBe("string");
    expect(token!.length).toBeGreaterThan(0);
    expect(db.setChatShareToken).toHaveBeenCalledWith(SESSION_ID, token);
  });

  it("returns existing token without re-generating when already shared", async () => {
    const existingToken = "existing-token-abc";
    const session = makeSession({ shareToken: existingToken });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const token = await svc.shareSession(SESSION_ID, USER_ID);

    expect(token).toBe(existingToken);
    expect(db.setChatShareToken).not.toHaveBeenCalled();
  });

  it("returns null for a non-owner", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const token = await svc.shareSession(SESSION_ID, USER_ID);

    expect(token).toBeNull();
  });
});

describe("ChatSessionService.unshareSession", () => {
  it("clears the share token and returns true for the owner", async () => {
    const session = makeSession({ shareToken: "some-token" });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.unshareSession(SESSION_ID, USER_ID);

    expect(result).toBe(true);
    expect(db.setChatShareToken).toHaveBeenCalledWith(SESSION_ID, null);
  });

  it("returns false for a non-owner", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.unshareSession(SESSION_ID, USER_ID);

    expect(result).toBe(false);
  });
});

// ─── getSharedSession ─────────────────────────────────────────────────────────

describe("ChatSessionService.getSharedSession", () => {
  it("returns null when token does not match any session", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSharedSession("unknown-token");

    expect(result).toBeNull();
  });

  it("returns session and its messages for a valid share token", async () => {
    const session = makeSession({ shareToken: "valid-token" });
    const messages = [
      {
        id: "msg-1",
        sessionId: SESSION_ID,
        role: "user" as const,
        content: "Hi",
        routingDecision: null,
        subgraphResults: null,
        tokenCount: null,
        createdAt: new Date(),
      },
    ];
    const db = createMockDb({
      getChatSessionByShareToken: mock(() => Promise.resolve(session)),
      getChatSessionMessages: mock(() => Promise.resolve(messages)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSharedSession("valid-token");

    expect(result).not.toBeNull();
    expect(result!.session).toEqual(session);
    expect(result!.messages).toEqual(messages);
  });
});

// ─── generateSessionTitle ─────────────────────────────────────────────────────

describe("ChatSessionService.generateSessionTitle", () => {
  it("returns undefined when session is not found", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBeUndefined();
  });

  it("returns existing title without calling the LLM", async () => {
    const session = makeSession({ title: "Existing Title" });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBe("Existing Title");
    expect(mockTitleInvoke).not.toHaveBeenCalled();
  });

  it("returns undefined when there are not enough messages (no assistant turn yet)", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
      getChatSessionMessages: mock(() =>
        Promise.resolve([{ role: "user", content: "Hello" }])
      ),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBeUndefined();
    expect(mockTitleInvoke).not.toHaveBeenCalled();
  });

  it("generates, persists, and returns a title when conversation is ready", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
      getChatSessionMessages: mock(() =>
        Promise.resolve([
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
        ])
      ),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBe("Generated Title");
    expect(mockTitleInvoke).toHaveBeenCalledTimes(1);
    expect(db.updateChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, "Generated Title");
  });
});
