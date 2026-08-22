import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createChatTools } from "../chat.tools.js";
import type { ToolDeps } from "../../shared/agent/tool.helpers.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { ChatSessionReader } from "../../../platform/chat/ports.js";

function makeContext(userId = "user-123"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as any,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function makeDeps(chatSession: Partial<ChatSessionReader>): ToolDeps {
  return {
    chatSession: chatSession as ChatSessionReader,
  } as unknown as ToolDeps;
}

interface CapturedTool {
  name: string;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(
  build: (defineTool: unknown, deps: ToolDeps) => void,
  deps: ToolDeps,
): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    toolDefs.push({ name: def.name, handler: def.handler });
    return def;
  };
  build(defineTool, deps);
  return toolDefs;
}

describe("list_conversations", () => {
  test("returns sessions for the authenticated user", async () => {
    const now = new Date("2026-04-14T00:00:00Z");
    const listSessions = async (userId: string, limit?: number) => {
      expect(userId).toBe("alice-id");
      expect(limit).toBe(25);
      return [
        {
          sessionId: "11111111-1111-4111-8111-111111111111",
          title: "Hello",
          messageCount: 3,
          lastMessageAt: now,
          createdAt: now,
        },
      ];
    };
    const tools = captureTools(
      (defineTool, deps) => createChatTools(defineTool as any, deps),
      makeDeps({ listSessions }),
    );
    const tool = tools.find((t) => t.name === "list_conversations")!;
    const result = await tool.handler({ context: makeContext("alice-id"), query: {} });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.conversations[0].sessionId).toBe("11111111-1111-4111-8111-111111111111");
    expect(parsed.data.conversations[0].title).toBe("Hello");
  });

  test("forwards the limit argument", async () => {
    let capturedLimit: number | undefined;
    const listSessions = async (_userId: string, limit?: number) => {
      capturedLimit = limit;
      return [];
    };
    const tools = captureTools(
      (defineTool, deps) => createChatTools(defineTool as any, deps),
      makeDeps({ listSessions }),
    );
    const tool = tools.find((t) => t.name === "list_conversations")!;
    await tool.handler({ context: makeContext(), query: { limit: 10 } });
    expect(capturedLimit).toBe(10);
  });
});

describe("get_conversation", () => {
  const validSessionId = "22222222-2222-4222-8222-222222222222";

  test("returns the conversation when the user owns it", async () => {
    const now = new Date("2026-04-14T00:00:00Z");
    const getSession = async (userId: string, sessionId: string) => {
      expect(userId).toBe("user-123");
      expect(sessionId).toBe(validSessionId);
      return {
        sessionId,
        title: "Chat with Bob",
        messageCount: 1,
        lastMessageAt: now,
        createdAt: now,
        messages: [{ role: "user", content: "hello", createdAt: now }],
      };
    };
    const tools = captureTools(
      (defineTool, deps) => createChatTools(defineTool as any, deps),
      makeDeps({ getSession }),
    );
    const tool = tools.find((t) => t.name === "get_conversation")!;
    const result = await tool.handler({
      context: makeContext(),
      query: { sessionId: validSessionId },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.data.title).toBe("Chat with Bob");
    expect(parsed.data.messages).toHaveLength(1);
  });

  test("returns an error when the session is not found", async () => {
    const tools = captureTools(
      (defineTool, deps) => createChatTools(defineTool as any, deps),
      makeDeps({ getSession: async () => null }),
    );
    const tool = tools.find((t) => t.name === "get_conversation")!;
    const result = await tool.handler({
      context: makeContext(),
      query: { sessionId: validSessionId },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
  });

  test("rejects a non-UUID sessionId", async () => {
    const tools = captureTools(
      (defineTool, deps) => createChatTools(defineTool as any, deps),
      makeDeps({ getSession: async () => null }),
    );
    const tool = tools.find((t) => t.name === "get_conversation")!;
    const result = await tool.handler({
      context: makeContext(),
      query: { sessionId: "not-a-uuid" },
    });
    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.error).toContain("Invalid session ID");
  });
});
