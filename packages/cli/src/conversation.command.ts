/**
 * Conversation command handlers for the Index CLI.
 *
 * Human conversations and scoped hosted personal-agent messages over HTTP.
 */

import type { ApiClient } from "./api.client";
import { parseSSEEvents } from "./sse.parser";
import * as output from "./output";

const CONVERSATION_HELP = `
Conversation Commands:
  index conversation list                  List all conversations
  index conversation with <user-id|key>    Open or resume a DM with a user
  index conversation show <id>             Show messages (accepts short ID)
  index conversation show <id> --limit <n> Limit number of messages
  index conversation send <id> <message>   Send a message (accepts short ID)
  index conversation show agent --intent-id <id>  Read scoped agent state
  index conversation send agent <text> --intent-id <id> [--question-id <id>]
  index conversation stream                Listen for real-time events (SSE)
`;

/** Options for the conversation command. */
export interface ConversationOptions {
  limit?: number;
  json?: boolean;
  intentId?: string;
  questionId?: string;
}

/**
 * Route a conversation subcommand to the appropriate handler.
 *
 * @param client - Authenticated API client.
 * @param subcommand - The subcommand (list, with, show, send, stream).
 * @param positionals - Positional arguments after the subcommand.
 * @param options - Additional options (e.g. limit, json).
 */
export async function handleConversation(
  client: ApiClient,
  subcommand: string | undefined,
  positionals: string[],
  options?: ConversationOptions,
): Promise<void> {
  if (positionals[0] === "agent" && (subcommand === "show" || subcommand === "send")) {
    if (!options?.intentId) throw new Error("Personal-agent conversations require --intent-id <id>");
    let result: unknown;
    if (subcommand === "show") result = await client.getAgentConversation(options.intentId);
    else {
      const text = positionals.slice(1).join(" ");
      if (!text.trim()) throw new Error("A message is required");
      result = await client.sendMessage("agent", text, options.intentId, options.questionId);
    }
    console.log(JSON.stringify(result, null, options.json ? undefined : 2));
    return;
  }
  if (!subcommand) throw new Error(CONVERSATION_HELP.trim());

  switch (subcommand) {
    case "list":
      await conversationList(client, options?.json);
      return;
    case "with":
      await conversationWith(client, positionals[0], options?.json);
      return;
    case "show":
      await conversationShow(client, positionals[0], options?.limit, options?.json);
      return;
    case "send":
      await conversationSend(client, positionals[0], positionals.slice(1), options?.json);
      return;
    case "stream":
      await conversationStream(client, options?.json);
      return;
    case "help":
      console.log(options?.json ? JSON.stringify({ help: CONVERSATION_HELP.trim() }) : CONVERSATION_HELP);
      return;
    default:
      output.error(`Unknown conversation subcommand: ${subcommand}`, 1);
  }
}

/**
 * List conversations for the authenticated user.
 */
async function conversationList(client: ApiClient, json?: boolean): Promise<void> {
  const conversations = await client.listConversations();

  if (json) {
    console.log(JSON.stringify(conversations));
    return;
  }
  output.heading("Conversations");
  output.conversationTable(conversations);
  console.log();
}

/**
 * Get or create a DM with a peer user.
 */
async function conversationWith(client: ApiClient, userId: string | undefined, json?: boolean): Promise<void> {
  if (!userId) {
    output.error("Usage: index conversation with <user-id>", 1);
    return;
  }

  const conversation = await client.getOrCreateDM(userId);
  if (json) {
    console.log(JSON.stringify(conversation));
    return;
  }
  output.conversationCard(conversation);
}

/**
 * Show messages in a conversation.
 */
async function conversationShow(
  client: ApiClient,
  id: string | undefined,
  limit?: number,
  json?: boolean,
): Promise<void> {
  if (!id) {
    output.error("Usage: index conversation show <id>", 1);
    return;
  }

  const messages = await client.getMessages(id, { limit: limit ?? 20 });

  if (json) {
    console.log(JSON.stringify(messages));
    return;
  }
  output.heading("Messages");
  output.messageList(messages);
}

/**
 * Send a text message in a conversation.
 */
async function conversationSend(
  client: ApiClient,
  id: string | undefined,
  messageParts: string[],
  json?: boolean,
): Promise<void> {
  if (!id) {
    output.error("Usage: index conversation send <id> <message>", 1);
    return;
  }

  if (messageParts.length === 0) {
    output.error("Missing message. Usage: index conversation send <id> <message>", 1);
    return;
  }

  const text = messageParts.join(" ");
  const msg = await client.sendMessage(id, text);
  if (json) {
    console.log(JSON.stringify(msg));
    return;
  }
  output.success(`Message sent (${msg.id})`);
}

/**
 * Open an SSE stream for real-time conversation events.
 */
async function conversationStream(client: ApiClient, json?: boolean): Promise<void> {
  output.info("Connecting to conversation stream...");
  output.dim("Press Ctrl+C to stop.\n");

  const response = await client.streamConversationEvents();

  if (!response.body) {
    output.error("No response body from stream endpoint.", 1);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Normalize complete CRLF pairs after buffering so split chunks are safe.
      buffer = buffer.replace(/\r\n/g, "\n");
      const boundary = buffer.lastIndexOf("\n\n");
      if (boundary < 0) continue;
      const complete = buffer.slice(0, boundary + 2);
      buffer = buffer.slice(boundary + 2);
      for (const event of parseSSEEvents(complete)) {
        const data: unknown = JSON.parse(event.data);
        if (json) console.log(JSON.stringify({ event: event.event, data }));
        else output.dim(JSON.stringify(data));
      }
    }
  } finally {
    reader.releaseLock();
  }
}
