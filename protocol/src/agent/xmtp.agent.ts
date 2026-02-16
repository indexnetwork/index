import { Agent } from '@xmtp/agent-sdk';
import { CONVERSATION_TYPES, type ConversationAppData } from './xmtp.types';

let agentInstance: Agent | null = null;

export async function startXMTPAgent(): Promise<Agent> {
  if (agentInstance) return agentInstance;

  const agent = await Agent.createFromEnv({
    dbPath: (inboxId) =>
      `${process.env.XMTP_DB_PATH ?? '.'}/${process.env.XMTP_ENV ?? 'dev'}-${inboxId.slice(0, 8)}.db3`,
  });

  agent.on('start', () => {
    console.log(`[XMTP Agent] Started. Address: ${agent.address}`);
  });

  agent.on('text', async (ctx) => {
    try {
      const senderAddress = await ctx.getSenderAddress();
      if (senderAddress === ctx.getClientAddress()) return;

      const appData = getAppData(ctx.conversation);
      if (!appData) return;

      switch (appData.type) {
        case CONVERSATION_TYPES.AI_CHAT:
          console.log(`[XMTP Agent] AI chat message in ${ctx.conversation.id}`);
          break;
        case CONVERSATION_TYPES.HOME_FEED:
          console.log(`[XMTP Agent] Home feed message in ${ctx.conversation.id}`);
          break;
        case CONVERSATION_TYPES.HUMAN_CHAT:
          console.log(`[XMTP Agent] Human chat message in ${ctx.conversation.id}`);
          break;
      }
    } catch (error) {
      console.error('[XMTP Agent] Error handling message:', error);
    }
  });

  agent.on('group', async (ctx) => {
    console.log(`[XMTP Agent] Added to group: ${ctx.conversation.id}`);
  });

  agent.on('unhandledError', (error) => {
    console.error('[XMTP Agent] Unhandled error:', error);
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
