import { Agent, type MessageContext } from '@xmtp/agent-sdk';
import type { Group } from '@xmtp/node-sdk';
import { eq } from 'drizzle-orm';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import db from '../lib/drizzle/drizzle';
import { users } from '../schemas/database.schema';
import { chatSessionService } from '../services/chat.service';
import { log } from '../lib/log';
import { CONVERSATION_TYPES, type ConversationAppData } from './xmtp.types';
import { serializeContent, type StructuredContent } from './content-types';

const logger = log.agent.from('XMTPAgent');

/** Maximum number of recent XMTP messages to load as conversation context. */
const MAX_CONTEXT_MESSAGES = 20;

/** Default conversation name assigned to new AI chat conversations. */
const DEFAULT_CONVERSATION_NAME = 'New conversation';

let agentInstance: Agent | null = null;

/**
 * In-memory mapping of user XMTP inbox IDs to their home-feed conversation IDs.
 * Populated when the agent is added to home-feed groups and when conversations
 * are scanned at startup.
 */
const homeFeedByInboxId = new Map<string, string>();

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
// HOME FEED
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Scan all conversations the agent participates in and index any home-feed
 * groups into the in-memory `homeFeedByInboxId` map.
 *
 * Called once at agent startup and when the agent is added to new groups.
 */
async function indexHomeFeedConversations(): Promise<void> {
  const agent = agentInstance;
  if (!agent) return;

  try {
    await agent.client.conversations.sync();
    const conversations = await agent.client.conversations.list();

    for (const conversation of conversations) {
      const data = getAppData(conversation);
      if (data?.type !== CONVERSATION_TYPES.HOME_FEED) continue;

      // Get the conversation members to find the non-agent user
      try {
        const members = await (conversation as any).members?.() ?? [];
        const agentInboxId = agent.client.inboxId;

        for (const member of members) {
          const memberInboxId = member.inboxId ?? member.addresses?.[0];
          if (memberInboxId && memberInboxId !== agentInboxId) {
            homeFeedByInboxId.set(memberInboxId, conversation.id);
            logger.debug('Indexed home feed', {
              inboxId: memberInboxId,
              conversationId: conversation.id,
            });
          }
        }
      } catch {
        // Some SDK versions may not support .members() -- fall back to
        // leaving the mapping incomplete; it will be populated when
        // messages arrive.
      }
    }

    logger.info('Home feed index complete', {
      mappedFeeds: homeFeedByInboxId.size,
    });
  } catch (err) {
    logger.warn('Failed to index home feed conversations', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send an opportunity card to a user's home feed conversation.
 *
 * The function locates the user's home-feed group (via the cached mapping or
 * by rescanning conversations) and sends the structured JSON message.
 *
 * @param userXmtpInboxId  The target user's XMTP inbox ID.
 * @param opportunity      The structured content to send (card or update).
 */
export async function sendOpportunityToHomeFeed(
  userXmtpInboxId: string,
  opportunity: StructuredContent,
): Promise<void> {
  const agent = agentInstance;
  if (!agent) throw new Error('XMTP agent not running');

  // Try cached mapping first
  let conversationId = homeFeedByInboxId.get(userXmtpInboxId);

  // If not found, rescan conversations (the user may have just created the feed)
  if (!conversationId) {
    await indexHomeFeedConversations();
    conversationId = homeFeedByInboxId.get(userXmtpInboxId);
  }

  if (!conversationId) {
    logger.warn('[XMTP Agent] No home feed found for inbox', {
      inboxId: userXmtpInboxId,
    });
    return;
  }

  // Find the conversation object and send the message
  try {
    await agent.client.conversations.sync();
    const conversations = await agent.client.conversations.list();
    const homeFeed = conversations.find((c) => c.id === conversationId);

    if (!homeFeed) {
      logger.warn('[XMTP Agent] Home feed conversation not found after sync', {
        conversationId,
        inboxId: userXmtpInboxId,
      });
      return;
    }

    await homeFeed.sendText(serializeContent(opportunity));

    logger.info('Sent opportunity to home feed', {
      conversationId,
      opportunityId: opportunity.opportunityId,
      inboxId: userXmtpInboxId,
    });
  } catch (err) {
    logger.error('Failed to send opportunity to home feed', {
      conversationId,
      opportunityId: opportunity.opportunityId,
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
    // Re-index home feeds so newly-created feeds are available immediately
    await indexHomeFeedConversations();
  });

  agent.on('unhandledError', (error) => {
    logger.error('Unhandled error', { error: error instanceof Error ? error.message : String(error) });
  });

  await agent.start();
  agentInstance = agent;

  // Build initial home-feed index in the background (best-effort).
  indexHomeFeedConversations().catch((err) => {
    logger.warn('Initial home feed indexing failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

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
