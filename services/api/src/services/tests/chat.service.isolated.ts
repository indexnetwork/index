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
    ORCHESTRATOR_PERSONA_ID: "orchestrator",
    SIGNAL_PERSONA_ID: "signal",
    NEGOTIATOR_PERSONA_ID: "negotiator",
    REPORTER_PERSONA_ID: "reporter",
    SIGNAL_PERSONA: { id: "signal" },
    REPORTER_PERSONA: { id: "reporter" },
    createNegotiatorPersona: mock(() => ({ id: "negotiator" })),
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

afterEach(() => {
  delete process.env.WEB_SIGNAL_AGENT_ENABLED;
  delete process.env.WEB_AGENT_SURFACE_ENABLED;
});

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
    updateChatSessionScope: mock(() => Promise.resolve()),
    updateChatSessionTitle: mock(() => Promise.resolve()),
    getChatSessionByScope: mock(() => Promise.resolve(null)),
    resolveReporterChatSession: mock(() => Promise.resolve({
      session: makeSession({ persona: 'reporter' }),
      created: false,
    })),
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

describe("ChatSessionService.resolveReporterSession", () => {
  it("passes a creation-time cutoff and explicit force claim to the atomic adapter", async () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const reporter = makeSession({ persona: "reporter", createdAt: now });
    const resolveReporterChatSession = mock(() => Promise.resolve({
      session: reporter,
      created: true,
    }));
    const db = createMockDb({ resolveReporterChatSession });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter, {
      graphDatabase: graphDatabase as never,
      now: () => now,
      reporterBriefingTtlMs: () => 60_000,
    });

    const result = await svc.resolveReporterSession(USER_ID, true);

    expect(result).toEqual({ session: reporter, created: true });
    expect(resolveReporterChatSession).toHaveBeenCalledTimes(1);
    expect(resolveReporterChatSession).toHaveBeenCalledWith({
      id: expect.any(String),
      userId: USER_ID,
      freshAfter: new Date("2026-07-22T11:59:00.000Z"),
      forceNew: true,
    });
  });
});

describe("ChatSessionService.resolveSessionForScope", () => {
  it("recovers the winning Signal session after a Drizzle-wrapped 23505", async () => {
    const session = makeSession({ persona: "signal" });
    const wrapped = new Error('Failed query: insert into "chat_session_scopes" (...)');
    (wrapped as { cause?: unknown }).cause = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505" },
    );

    let scopeLookups = 0;
    const getChatSessionByScope = mock(
      (_userId: string, _scopeType: string, _scopeId: string, persona: string) => {
        expect(persona).toBe("signal");
        scopeLookups += 1;
        return Promise.resolve(scopeLookups === 1 ? null : session);
      },
    );
    const db = createMockDb({
      getChatSessionByScope,
      createChatSession: mock(() => Promise.reject(wrapped)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const res = await svc.resolveSessionForScope(
      USER_ID,
      { scopeType: "intent", scopeId: "intent-001" },
      "signal",
    );

    if ("error" in res) throw new Error(`expected session, got error: ${res.error}`);
    expect(res.session).toEqual(session);
    expect(res.created).toBe(false);
    expect(getChatSessionByScope).toHaveBeenNthCalledWith(
      2,
      USER_ID,
      "intent",
      "intent-001",
      "signal",
    );
  });
});

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

  it("persists an explicitly selected Signal persona", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    await svc.createSession(USER_ID, undefined, undefined, undefined, "signal");

    const [arg] = db.createChatSession.mock.calls[0] as [Record<string, unknown>];
    expect(arg.persona).toBe("signal");
  });
});

// ─── persona policy ───────────────────────────────────────────────────────────

describe("ChatSessionService.resolveStreamPersonaPolicy", () => {
  const svc = new ChatSessionService(createMockDb() as unknown as ConversationDatabaseAdapter);

  it("restores the orchestrator default while the cutover flag is off", () => {
    expect(svc.resolveStreamPersonaPolicy({ surface: "web" })).toEqual({
      ok: true,
      persona: "orchestrator",
    });
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "orchestrator",
    })).toEqual({ ok: true, persona: "orchestrator" });
  });

  it("requires an explicit Signal assertion for a new flag-on web chat", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";

    const missing = svc.resolveStreamPersonaPolicy({ surface: "web" });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected policy denial");
    expect(missing.code).toBe("WEB_SIGNAL_PERSONA_REQUIRED");
    expect(missing.action).toEqual({ type: "start_signal_session", href: "/" });

    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      requestedPersona: "signal",
    })).toEqual({ ok: true, persona: "signal" });
  });

  it("inherits a persisted Signal persona without trusting another request assertion", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";

    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "signal",
    })).toEqual({ ok: true, persona: "signal" });

    const mismatch = svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "signal",
      requestedPersona: "negotiator",
    });
    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) throw new Error("expected policy denial");
    expect(mismatch.code).toBe("CHAT_PERSONA_MISMATCH");
  });

  it("makes legacy orchestrator web history read-only when enabled", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";

    const result = svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "orchestrator",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected policy denial");
    expect(result.code).toBe("WEB_SIGNAL_SESSION_REQUIRED");
    expect(result.status).toBe(409);
    expect(result.action).toEqual({ type: "start_signal_session", href: "/" });
  });

  it("fails closed for unknown persisted personas", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";

    const result = svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "unexpected",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected policy denial");
    expect(result.code).toBe("CHAT_PERSONA_UNSUPPORTED");
  });

  it("preserves non-web orchestrator behavior and rejects Signal spoofing", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";

    expect(svc.resolveStreamPersonaPolicy({ surface: "non_web" })).toEqual({
      ok: true,
      persona: "orchestrator",
    });
    const spoofed = svc.resolveStreamPersonaPolicy({
      surface: "non_web",
      requestedPersona: "signal",
    });
    expect(spoofed.ok).toBe(false);
    if (spoofed.ok) throw new Error("expected policy denial");
    expect(spoofed.code).toBe("WEB_SIGNAL_PERSONA_FORBIDDEN");
    expect(spoofed.status).toBe(403);
  });

  it("never downgrades a persisted Signal session when the flag is off", () => {
    const result = svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "signal",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected policy denial");
    expect(result.code).toBe("WEB_SIGNAL_AGENT_DISABLED");
  });

  it("denies a new reporter session when the Agent surface flag is off", () => {
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      requestedPersona: "reporter",
    })).toMatchObject({
      ok: false,
      status: 409,
      code: "WEB_AGENT_SURFACE_DISABLED",
    });
  });

  it("resolves reporter only on web when the Agent surface flag is on", () => {
    process.env.WEB_AGENT_SURFACE_ENABLED = "true";
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      requestedPersona: "reporter",
    })).toEqual({ ok: true, persona: "reporter" });
    expect(svc.resolveStreamPersonaPolicy({
      surface: "non_web",
      requestedPersona: "reporter",
    })).toMatchObject({
      ok: false,
      status: 403,
      code: "WEB_AGENT_PERSONA_FORBIDDEN",
    });
  });

  it("keeps persisted reporter authority and fails closed on mismatch or flag rollback", () => {
    process.env.WEB_AGENT_SURFACE_ENABLED = "true";
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "reporter",
    })).toEqual({ ok: true, persona: "reporter" });
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "reporter",
      requestedPersona: "signal",
    })).toMatchObject({ code: "CHAT_PERSONA_MISMATCH", status: 409 });

    process.env.WEB_AGENT_SURFACE_ENABLED = "false";
    expect(svc.resolveStreamPersonaPolicy({
      surface: "web",
      storedPersona: "reporter",
    })).toMatchObject({ code: "WEB_AGENT_SURFACE_DISABLED", status: 409 });
  });

  it("leaves the separate negotiator persona unchanged", () => {
    process.env.WEB_SIGNAL_AGENT_ENABLED = "true";
    expect(svc.resolveStreamPersonaPolicy({
      surface: "non_web",
      requestedPersona: "negotiator",
    })).toEqual({ ok: true, persona: "negotiator" });
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
  it("delegates to orchestrator history by default", async () => {
    const sessions = [makeSession(), makeSession({ id: "session-002" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getUserSessions(USER_ID, 10);

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(USER_ID, 10, "orchestrator");
  });

  it("passes an explicit persona filter through to the adapter", async () => {
    const sessions = [makeSession({ persona: "negotiator" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = createService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getUserSessions(USER_ID, 10, "negotiator");

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(USER_ID, 10, "negotiator");
  });

  it("lists orchestrator, Signal, and reporter sessions for web history", async () => {
    const sessions = [makeSession(), makeSession({ id: "signal-session", persona: "signal" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getWebUserSessions(USER_ID, 10);

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(
      USER_ID,
      10,
      ["orchestrator", "signal", "reporter"],
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

// ─── processMessage ───────────────────────────────────────────────────────────

describe("ChatSessionService.processMessage", () => {
  it("invokes the graph and returns responseText", async () => {
    const db = createMockDb();
    const svc = createService(db as unknown as ConversationDatabaseAdapter);
    svc.setFactory(graphFactory as never);

    const result = await svc.processMessage(USER_ID, "What can you do?");

    expect(result.responseText).toBe("agent reply");
    expect(result.error).toBeUndefined();
    expect(mockGraphInvoke).toHaveBeenCalledTimes(1);
    const [invokeArg] = mockGraphInvoke.mock.calls[0] as [Record<string, unknown>];
    expect(invokeArg.userId).toBe(USER_ID);
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
