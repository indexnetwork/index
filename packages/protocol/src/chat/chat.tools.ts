import { z } from "zod";

import type { DefineTool, ToolDeps } from "../shared/agent/tool.helpers.js";
import { success, error, UUID_REGEX } from "../shared/agent/tool.helpers.js";

export function createChatTools(defineTool: DefineTool, deps: ToolDeps) {
  const { chatSession } = deps;
  if (!chatSession) {
    throw new Error("createChatTools requires `chatSession` in deps");
  }

  const listConversations = defineTool({
    name: "list_conversations",
    description:
      "Lists the authenticated user's past H2A chat conversations (direct chats with the Index agent), " +
      "most-recently-active first. Use when the user asks about their prior chats, wants to resume a " +
      "conversation, or is orienting themselves in their own history. Only returns H2A sessions the caller " +
      "participates in. Human-to-human (H2H) DMs are NEVER exposed through this tool, and A2A negotiation " +
      "chats are only available via `list_negotiations` / `get_negotiation`.\n\n" +
      "**Returns:** `conversations: [{ sessionId, title, messageCount, lastMessageAt, createdAt }]`. Use " +
      "`sessionId` with `get_conversation` to read the full thread.",
    querySchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .describe("Maximum conversations to return (default 25, max 100)."),
    }),
    handler: async ({ context, query }) => {
      const sessions = await chatSession.listSessions(context.userId, query.limit ?? 25);
      return success({ conversations: sessions });
    },
  });

  const getConversation = defineTool({
    name: "get_conversation",
    description:
      "Fetches a single H2A chat conversation (a direct chat with the Index agent) belonging to the " +
      "authenticated user, including its messages. Use after `list_conversations` has yielded a specific " +
      "`sessionId` — for example when the user asks you to pick up a prior thread by topic or title. Returns " +
      "an error if the session does not exist, the caller is not a participant, or the session is not an H2A " +
      "chat: human-to-human (H2H) DMs are NEVER exposed through this tool, and A2A negotiation transcripts " +
      "are only available via `get_negotiation`.\n\n" +
      "**Returns:** `{ sessionId, title, messageCount, lastMessageAt, createdAt, messages: [{ role, content, createdAt }] }`.",
    querySchema: z.object({
      sessionId: z.string().describe("Session UUID from list_conversations."),
      messageLimit: z
        .number()
        .int()
        .positive()
        .max(500)
        .optional()
        .describe("Maximum messages to include (default 50, max 500)."),
    }),
    handler: async ({ context, query }) => {
      if (!UUID_REGEX.test(query.sessionId)) {
        return error("Invalid session ID format. Pass a sessionId returned by list_conversations.");
      }
      const session = await chatSession.getSession(
        context.userId,
        query.sessionId,
        query.messageLimit ?? 50,
      );
      if (!session) {
        return error("Conversation not found or you are not a participant.");
      }
      return success(session);
    },
  });

  return { listConversations, getConversation };
}
