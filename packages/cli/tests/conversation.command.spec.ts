import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleConversation, renderSSEStream } from "../src/conversation.command";
import { createMockServer, createMockSSEServer } from "./helpers/mock-http";

// ── Argument parsing tests ────────────────────────────────────────

describe("parseArgs — conversation command", () => {
  it("parses 'conversation' with no subcommand as conversation-help", () => {
    const result = parseArgs(["conversation"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'conversation list'", () => {
    const result = parseArgs(["conversation", "list"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'conversation with <user-id>'", () => {
    const result = parseArgs(["conversation", "with", "user-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("with");
    expect(result.positionals).toEqual(["user-abc-123"]);
  });

  it("parses 'conversation show <id>'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
  });

  it("parses 'conversation show <id> --limit 5'", () => {
    const result = parseArgs(["conversation", "show", "conv-abc-123", "--limit", "5"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["conv-abc-123"]);
    expect(result.limit).toBe(5);
  });

  it("parses 'conversation send <id> <message>'", () => {
    const result = parseArgs(["conversation", "send", "conv-abc-123", "Hello", "there"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("send");
    expect(result.positionals).toEqual(["conv-abc-123", "Hello", "there"]);
  });

  it("parses 'conversation stream'", () => {
    const result = parseArgs(["conversation", "stream"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("stream");
  });

  it("parses 'conversation list --api-url <url>'", () => {
    const result = parseArgs(["conversation", "list", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("conversation");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});

// ── API client conversation methods ───────────────────────────────

describe("ApiClient — conversation methods", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(async () => {
    await mock.stop();
  });

  it("listConversations returns conversations array", async () => {
    mock.on("GET", "/api/conversations", () =>
      Response.json({
        conversations: [
          { id: "c1", createdAt: "2026-01-01", participants: [] },
          { id: "c2", createdAt: "2026-01-02", participants: [] },
        ],
      }),
    );

    const conversations = await client.listConversations();
    expect(conversations).toHaveLength(2);
    expect(conversations[0].id).toBe("c1");
  });

  it("getOrCreateDM sends peerUserId and returns conversation", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/conversations/dm", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        conversation: { id: "dm-1", createdAt: "2026-01-01", participants: [] },
      });
    });

    const conversation = await client.getOrCreateDM("peer-user-id");
    expect(receivedBody.peerUserId).toBe("peer-user-id");
    expect(conversation.id).toBe("dm-1");
  });

  it("getMessages returns messages array", async () => {
    mock.on("GET", "/api/conversations/c1/messages", () =>
      Response.json({
        messages: [
          { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01" },
        ],
      }),
    );

    const messages = await client.getMessages("c1");
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("m1");
  });

  it("sendMessage sends parts and returns message", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/conversations/c1/messages", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json(
        { message: { id: "m1", role: "user", parts: [{ type: "text", text: "Hi" }], createdAt: "2026-01-01" } },
        { status: 201 },
      );
    });

    const msg = await client.sendMessage("c1", "Hi there");
    expect(receivedBody.parts).toEqual([{ type: "text", text: "Hi there" }]);
    expect(msg.id).toBe("m1");
  });

  it("hideConversation calls DELETE", async () => {
    let called = false;
    mock.on("DELETE", "/api/conversations/c1", () => {
      called = true;
      return Response.json({ success: true });
    });

    await client.hideConversation("c1");
    expect(called).toBe(true);
  });
});

// ── handleConversation integration tests ──────────────────────────

describe("handleConversation", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(async () => {
    await mock.stop();
  });

  it("lists conversations", async () => {
    mock.on("GET", "/api/conversations", () =>
      Response.json({
        conversations: [
          {
            id: "c1",
            createdAt: "2026-01-01",
            participants: [
              { participantId: "u1", participantType: "user", user: { name: "Alice" } },
              { participantId: "u2", participantType: "user", user: { name: "Bob" } },
            ],
          },
        ],
      }),
    );

    await handleConversation(client, "list", []);
  });

  it("opens a DM with a user", async () => {
    mock.on("POST", "/api/conversations/dm", () =>
      Response.json({
        conversation: {
          id: "dm-1",
          createdAt: "2026-01-01",
          participants: [
            { participantId: "u1", participantType: "user", user: { name: "Alice" } },
            { participantId: "u2", participantType: "user", user: { name: "Bob" } },
          ],
        },
      }),
    );

    await handleConversation(client, "with", ["u2"]);
  });

  it("shows messages in a conversation", async () => {
    mock.on("GET", "/api/conversations/c1/messages", () =>
      Response.json({
        messages: [
          { id: "m1", role: "user", senderId: "u1", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01T10:00:00Z" },
          { id: "m2", role: "user", senderId: "u2", parts: [{ type: "text", text: "Hi there!" }], createdAt: "2026-01-01T10:01:00Z" },
        ],
      }),
    );

    await handleConversation(client, "show", ["c1"]);
  });

  it("sends a message", async () => {
    mock.on("POST", "/api/conversations/c1/messages", () =>
      Response.json(
        { message: { id: "m1", role: "user", parts: [{ type: "text", text: "Hello" }], createdAt: "2026-01-01" } },
        { status: 201 },
      ),
    );

    await handleConversation(client, "send", ["c1", "Hello"]);
  });

  it("starts REPL when no subcommand given", async () => {
    // In non-interactive mode stdin closes immediately, so REPL exits cleanly
    await handleConversation(client, undefined, []);
  });
});

// ── renderSSEStream tests ────────────────────────────────────────

/** Helper to build a `data: {JSON}\n\n` SSE event string. */
function sseEvent(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe("renderSSEStream", () => {
  it("extracts text tokens from token events", async () => {
    const events = [
      sseEvent({ type: "status", sessionId: "s1", timestamp: "t", message: "Processing..." }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "Hello " }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "world!" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "Hello world!", title: "Test" }),
    ];

    const server = await createMockSSEServer(events);
    try {
      const response = await fetch(`${server.url}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const tokens: string[] = [];
      const result = await renderSSEStream(response, { onToken: (text) => tokens.push(text) });

      expect(tokens.join("")).toBe("Hello world!");
      expect(result.sessionId).toBe("s1");
      expect(result.title).toBe("Test");
    } finally {
      await server.stop();
    }
  });

  it("captures session ID from done event", async () => {
    const events = [
      sseEvent({ type: "done", sessionId: "abc-123", timestamp: "t", response: "Hi", title: "Chat" }),
    ];

    const server = await createMockSSEServer(events);
    try {
      const response = await fetch(`${server.url}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, { onToken: () => {} });
      expect(result.sessionId).toBe("abc-123");
    } finally {
      await server.stop();
    }
  });

  it("reports errors from error events", async () => {
    const events = [
      sseEvent({ type: "error", sessionId: "s1", timestamp: "t", message: "Something went wrong", code: "STREAM_ERROR" }),
    ];

    const server = await createMockSSEServer(events);
    try {
      const response = await fetch(`${server.url}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, { onToken: () => {} });
      expect(result.error).toBe("Something went wrong");
    } finally {
      await server.stop();
    }
  });

  it("shows tool activity in status callback", async () => {
    const events = [
      sseEvent({ type: "tool_activity", sessionId: "s1", timestamp: "t", toolName: "search", description: "Searching...", phase: "start" }),
      sseEvent({ type: "tool_activity", sessionId: "s1", timestamp: "t", toolName: "search", description: "Searching...", phase: "end" }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "result" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "result" }),
    ];

    const server = await createMockSSEServer(events);
    try {
      const response = await fetch(`${server.url}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const statuses: string[] = [];
      const tokens: string[] = [];
      await renderSSEStream(
        response,
        {
          onToken: (text) => tokens.push(text),
          onToolActivity: (desc, phase) => { if (phase === "start") statuses.push(desc); },
        },
      );

      expect(tokens.join("")).toBe("result");
      expect(statuses.length).toBeGreaterThan(0);
      expect(statuses.some((s) => s.includes("Searching"))).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it("handles response_reset by clearing accumulated text", async () => {
    const events = [
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "wrong answer" }),
      sseEvent({ type: "response_reset", sessionId: "s1", timestamp: "t", reason: "hallucination" }),
      sseEvent({ type: "token", sessionId: "s1", timestamp: "t", content: "correct answer" }),
      sseEvent({ type: "done", sessionId: "s1", timestamp: "t", response: "correct answer" }),
    ];

    const server = await createMockSSEServer(events);
    try {
      const response = await fetch(`${server.url}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "hi" }),
      });

      const result = await renderSSEStream(response, { onToken: () => {} });
      expect(result.response).toBe("correct answer");
    } finally {
      await server.stop();
    }
  });
});
