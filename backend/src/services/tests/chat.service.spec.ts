/**
 * Tests for ChatSessionService — H2A conversation session layer.
 *
 * All database and protocol dependencies are mocked so these tests are
 * fast, hermetic, and free of external I/O.
 *
 * Run: bun test src/services/tests/chat.service.spec.ts
 */

// Env must be set before module imports that read process.env
process.env.OPENROUTER_API_KEY = "test-key";
process.env.NODE_ENV = "test";

import { mock, describe, it, expect } from "bun:test";

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
      createGraph() {
        return { invoke: mockGraphInvoke };
      }
      // Used by the factory getter — no-op stubs for the rest
      createStreamingGraph() { return { invoke: mockGraphInvoke }; }
      streamChatEventsWithContext() { return (async function* () {})(); }
      streamChatEvents() { return (async function* () {})(); }
    },
    ChatTitleGenerator: class {
      invoke = mockTitleInvoke;
    },
  };
});

// ─── Mock infrastructure adapters (instantiated in constructor) ───────────────
mock.module("../../adapters/database.adapter", () => ({
  conversationDatabaseAdapter: {},
  ConversationDatabaseAdapter: class {},
  ChatDatabaseAdapter: class {
    getNetwork = mock(() => Promise.resolve(null));
    isNetworkMember = mock(() => Promise.resolve(false));
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

import { ChatGraphFactory } from "@indexnetwork/protocol";
import { ChatSessionService } from "../chat.service";
import type { ConversationDatabaseAdapter } from "../../adapters/database.adapter";

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
    networkId: null,
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

describe("ChatSessionService.createSession", () => {
  it("returns a UUID and persists the session", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    await svc.createSession(USER_ID, undefined, "network-42");

    const [arg] = db.createChatSession.mock.calls[0] as [Record<string, unknown>];
    expect(arg.networkId).toBe("network-42");
  });
});

// ─── getSession ───────────────────────────────────────────────────────────────

describe("ChatSessionService.getSession", () => {
  it("returns the session when userId matches", async () => {
    const session = makeSession();
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, USER_ID);

    expect(result).toEqual(session);
  });

  it("returns null when session does not exist", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, USER_ID);

    expect(result).toBeNull();
  });

  it("returns null when userId does not match session owner", async () => {
    const session = makeSession({ userId: USER_ID });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getSession(SESSION_ID, OTHER_USER_ID);

    expect(result).toBeNull();
  });
});

// ─── getUserSessions ──────────────────────────────────────────────────────────

describe("ChatSessionService.getUserSessions", () => {
  it("delegates to db and returns sessions", async () => {
    const sessions = [makeSession(), makeSession({ id: "session-002" })];
    const db = createMockDb({
      getUserChatSessions: mock(() => Promise.resolve(sessions)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.getUserSessions(USER_ID, 10);

    expect(result).toEqual(sessions);
    expect(db.getUserChatSessions).toHaveBeenCalledWith(USER_ID, 10);
  });
});

// ─── addMessage ───────────────────────────────────────────────────────────────

describe("ChatSessionService.addMessage", () => {
  it("persists the message and returns a snowflake ID string", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.deleteSession(SESSION_ID, USER_ID);

    expect(result).toBe(true);
    expect(db.deleteChatSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("returns false and does not delete when user is not the owner", async () => {
    const session = makeSession({ userId: USER_ID });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.updateSessionTitle(SESSION_ID, USER_ID, "New Title");

    expect(result).toBe(true);
    expect(db.updateChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, "New Title");
  });

  it("returns false and does not update for a non-owner", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const token = await svc.shareSession(SESSION_ID, USER_ID);

    expect(token).toBe(existingToken);
    expect(db.setChatShareToken).not.toHaveBeenCalled();
  });

  it("returns null for a non-owner", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.unshareSession(SESSION_ID, USER_ID);

    expect(result).toBe(true);
    expect(db.setChatShareToken).toHaveBeenCalledWith(SESSION_ID, null);
  });

  it("returns false for a non-owner", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const result = await svc.unshareSession(SESSION_ID, USER_ID);

    expect(result).toBe(false);
  });
});

// ─── getSharedSession ─────────────────────────────────────────────────────────

describe("ChatSessionService.getSharedSession", () => {
  it("returns null when token does not match any session", async () => {
    const db = createMockDb();
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);
    svc.setFactory(new ChatGraphFactory(null as never, null as never, null as never, null as never, null as never));

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBeUndefined();
  });

  it("returns existing title without calling the LLM", async () => {
    const session = makeSession({ title: "Existing Title" });
    const db = createMockDb({
      getChatSession: mock(() => Promise.resolve(session)),
    });
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

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
    const svc = new ChatSessionService(db as unknown as ConversationDatabaseAdapter);

    const title = await svc.generateSessionTitle(SESSION_ID, USER_ID);

    expect(title).toBe("Generated Title");
    expect(mockTitleInvoke).toHaveBeenCalledTimes(1);
    expect(db.updateChatSessionTitle).toHaveBeenCalledWith(SESSION_ID, "Generated Title");
  });
});
