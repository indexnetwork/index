import { Agent, type MessageContext } from '@xmtp/agent-sdk';
import type { Group } from '@xmtp/node-sdk';
import { eq } from 'drizzle-orm';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import db from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { chatSessionService } from '../services/chat.service';
import { log } from '../lib/log';
import { CONVERSATION_TYPES, type ConversationAppData } from './xmtp.types';

const logger = log.agent.from('XMTPAgent');

/** Maximum number of recent XMTP messages to load as conversation context. */
const MAX_CONTEXT_MESSAGES = 20;

/** Default conversation name assigned to new AI chat conversations. */
const DEFAULT_CONVERSATION_NAME = 'New conversation';

let agentInstance: Agent | null = null;

// ══════════════════════════════════════════════════════════════════════════════
// USER RESOLUTION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a platform user ID from an XMTP sender inbox ID.
 *
 * Looks up the `xmtpInboxId` column on the `users` table (populated when the
 * frontend registers its XMTP client via POST /chat/register-inbox).
 */
async function resolveUserIdFromInboxId(inboxId: string): Promise<string | null> {
  const result = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.xmtpInboxId, inboxId))
    .limit(1);
  return result[0]?.id ?? null;
}

// ══════════════════════════════════════════════════════════════════════════════
// AI CHAT PROCESSING
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Handle an incoming text message on an AI chat conversation.
 *
 * 1. Resolve the sender to a platform user ID.
 * 2. Load recent XMTP messages as conversation context.
 * 3. Run the LangGraph chat pipeline (non-streaming -- the SSE sideband
 *    handles real-time token streaming to the frontend independently).
 * 4. Send the final response as an XMTP message.
 * 5. If the conversation still has the default name, generate a title.
 */
async function handleAiChatMessage(ctx: MessageContext<string>): Promise<void> {
  const conversationId = ctx.conversation.id;
  const userMessage = ctx.message.content;
  const senderInboxId = ctx.message.senderInboxId;

  logger.info('Processing AI chat message', { conversationId, senderInboxId });

  // 1. Resolve user
  const userId = await resolveUserIdFromInboxId(senderInboxId);
  if (!userId) {
    logger.warn('Could not resolve user for inbox ID', { senderInboxId });
    await ctx.conversation.sendText(
      'Sorry, I could not identify your account. Please try again later.'
    );
    return;
  }

  // 2. Load recent conversation history from XMTP
  const agentAddress = ctx.getClientAddress();
  const contextMessages = await loadConversationContext(ctx, agentAddress);

  // 3. Run the chat graph
  const factory = chatSessionService.getGraphFactory();
  const graph = factory.createGraph();

  let responseText: string;
  try {
    const result = await graph.invoke({
      userId,
      messages: contextMessages,
    });
    responseText = result.responseText ?? 'I was unable to generate a response. Please try again.';
  } catch (err) {
    logger.error('Chat graph invocation failed', {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    await ctx.conversation.sendText(
      'Sorry, I encountered an error processing your message. Please try again.'
    );
    return;
  }

  // 4. Send final response as XMTP message
  logger.info('Sending AI response', { conversationId, responseLength: responseText.length });
  await ctx.conversation.sendText(responseText);

  // 5. Generate conversation title if this is a new conversation
  await maybeUpdateConversationTitle(ctx, userMessage, responseText);
}

/**
 * Load recent messages from the XMTP conversation and convert them to
 * LangChain message format for the chat graph.
 */
async function loadConversationContext(
  ctx: MessageContext<string>,
  agentAddress: string | undefined
): Promise<(HumanMessage | AIMessage)[]> {
  try {
    // Sync conversation to ensure we have latest messages
    await ctx.conversation.sync();

    const xmtpMessages = await ctx.conversation.messages({
      limit: MAX_CONTEXT_MESSAGES,
    });

    // Convert XMTP messages to LangChain format.
    // The agent's own messages become AIMessage; everything else is HumanMessage.
    const agentInboxId = agentAddress; // The agent's address serves as its inbox identifier
    const langchainMessages: (HumanMessage | AIMessage)[] = [];

    for (const msg of xmtpMessages) {
      const content = msg.content;
      if (typeof content !== 'string' || !content.trim()) continue;

      if (msg.senderInboxId === agentInboxId) {
        langchainMessages.push(new AIMessage(content));
      } else {
        langchainMessages.push(new HumanMessage(content));
      }
    }

    logger.debug('Loaded conversation context', {
      conversationId: ctx.conversation.id,
      xmtpMessageCount: xmtpMessages.length,
      langchainMessageCount: langchainMessages.length,
    });

    return langchainMessages;
  } catch (err) {
    logger.warn('Failed to load conversation context, using current message only', {
      conversationId: ctx.conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
    // Fallback: just the current user message
    return [new HumanMessage(ctx.message.content)];
  }
}

/**
 * If the conversation still has the default name ("New conversation"),
 * generate a title from the first user/assistant exchange and update it.
 */
async function maybeUpdateConversationTitle(
  ctx: MessageContext<string>,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    // Only Group conversations support updateName; DMs do not.
    if (!ctx.isGroup()) return;
    const group = ctx.conversation as unknown as Group;

    if (group.name && group.name !== DEFAULT_CONVERSATION_NAME) return;

    const title = await chatSessionService.generateTitle(userMessage, assistantResponse);
    if (title) {
      await group.updateName(title);
      logger.info('Updated conversation title', {
        conversationId: ctx.conversation.id,
        title,
      });
    }
  } catch (err) {
    // Title generation is best-effort; don't fail the message flow.
    logger.warn('Failed to update conversation title', {
      conversationId: ctx.conversation.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AGENT LIFECYCLE
// ══════════════════════════════════════════════════════════════════════════════

export async function startXMTPAgent(): Promise<Agent> {
  if (agentInstance) return agentInstance;

  const agent = await Agent.createFromEnv({
    dbPath: (inboxId) =>
      `${process.env.XMTP_DB_PATH ?? '.'}/${process.env.XMTP_ENV ?? 'dev'}-${inboxId.slice(0, 8)}.db3`,
  });

  agent.on('start', () => {
    logger.info('Agent started', { address: agent.address });
  });

  agent.on('text', async (ctx) => {
    try {
      const senderAddress = await ctx.getSenderAddress();
      if (senderAddress === ctx.getClientAddress()) return;

      const appData = getAppData(ctx.conversation);
      if (!appData) return;

      switch (appData.type) {
        case CONVERSATION_TYPES.AI_CHAT:
          await handleAiChatMessage(ctx);
          break;
        case CONVERSATION_TYPES.HOME_FEED:
          logger.debug('Home feed message (no-op)', { conversationId: ctx.conversation.id });
          break;
        case CONVERSATION_TYPES.HUMAN_CHAT:
          logger.debug('Human chat message (no-op)', { conversationId: ctx.conversation.id });
          break;
      }
    } catch (error) {
      logger.error('Error handling message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  agent.on('group', async (ctx) => {
    logger.info('Added to group', { conversationId: ctx.conversation.id });
  });

  agent.on('unhandledError', (error) => {
    logger.error('Unhandled error', { error: error instanceof Error ? error.message : String(error) });
  });

  await agent.start();
  agentInstance = agent;
  return agent;
}

export function getXMTPAgent(): Agent | null {
  return agentInstance;
}

export function getAgentAddress(): string | null {
  return agentInstance?.address ?? null;
}

function getAppData(conversation: any): ConversationAppData | null {
  try {
    const metadata = conversation.metadata;
    if (!metadata?.appData) return null;
    return typeof metadata.appData === 'string'
      ? JSON.parse(metadata.appData)
      : metadata.appData;
  } catch {
    return null;
  }
}
