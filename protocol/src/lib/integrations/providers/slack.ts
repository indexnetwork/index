import type { IntegrationHandler } from '../index';

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  username?: string;
  real_name?: string;
  display_name?: string;
  channel_id: string;
  channel_name: string;
  bot_id?: string;
  subtype?: string;
}
import { getClient } from '../composio';
import { log } from '../../log';
import { analyzeObjects } from '../../../agents/core/intent_inferrer';
import { createPrivyUsers } from '../../user-utils';
import { getExistingIntents, saveIntent } from '../../../lib/intent-utils';

// Return raw Slack messages as objects
async function fetchObjects(userId: string, lastSyncAt?: Date): Promise<SlackMessage[]> {
  try {
    log.info('Slack objects sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();

    const connectedAccounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['slack'],
    });

    const account = connectedAccounts?.items?.[0];
    if (!account) return [];
    const connectedAccountId = account.id;

    // Fetch channels
    const channels: Array<{ id: string; name?: string }> = [];
    const channelsResp = await composio.tools.execute('SLACK_LIST_ALL_CHANNELS', { 
      userId, 
      connectedAccountId, 
      arguments: { limit: 200 } 
    });
    const channelList = (channelsResp as any)?.data?.channels || [];
    for (const ch of channelList) {
      if (ch?.id && !channels.find((c) => c.id === ch.id)) {
        channels.push({ id: ch.id, name: ch.name });
      }
    }

    log.info('Slack channels', { count: channels.length });
    if (!channels.length) return [];

    const allMessages: SlackMessage[] = [];
    let messagesTotal = 0;
    
    for (const ch of channels) {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      
      const messagesResp = await composio.tools.execute('SLACK_GET_CHANNEL_MESSAGES', { 
        userId, 
        connectedAccountId, 
        arguments: { channel: channelId, limit: 200 } 
      });
      const messageList = (messagesResp as any)?.data?.messages || [];
      messagesTotal += messageList.length;

      for (const msg of messageList) {
        if (!msg?.ts || !msg?.user) continue;
        if (msg.bot_id || msg.subtype) continue; // Skip bots
        
        const messageTime = new Date(parseFloat(msg.ts) * 1000);
        if (lastSyncAt && messageTime <= lastSyncAt) continue;
        
        allMessages.push({
          ts: msg.ts,
          text: msg.text || '',
          user: msg.user,
          username: msg.username,
          real_name: msg.real_name,
          display_name: msg.display_name,
          channel_id: channelId,
          channel_name: channelName,
          bot_id: msg.bot_id,
          subtype: msg.subtype
        });
      }
    }
    log.info('Slack objects sync done', { userId, objects: allMessages.length, total: messagesTotal });
    return allMessages;
  } catch (error) {
    log.error('Slack objects sync error', { userId, error: (error as Error).message });
    return [];
  }
}

// Process Slack messages to generate intents per user
export async function processSlackMessages(
  messages: SlackMessage[],
  sourceId: string
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!messages.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  // Using static imports from top of file

  log.info('Processing Slack messages', { count: messages.length });

  // Extract and create users
  const extractedUsers = extractSlackUsers(messages);
  const uniqueUsers = Array.from(new Map(extractedUsers.map((u: any) => [u.providerId, u])).values());
  
  if (!uniqueUsers.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }
  
  const createdUsers = await createPrivyUsers(uniqueUsers as any);
  const newUsersCreated = createdUsers.filter((u: any) => u.isNewUser).length;

  // Group messages by Slack user ID
  const messagesByUser = new Map<string, SlackMessage[]>();
  for (const message of messages) {
    const userId = message.user;
    if (!messagesByUser.has(userId)) {
      messagesByUser.set(userId, []);
    }
    messagesByUser.get(userId)!.push(message);
  }

  let totalIntentsGenerated = 0;

  // Generate intents for each user
  for (const createdUser of createdUsers) {
    const extractedUser = uniqueUsers.find((u: any) => u.email === createdUser.email);
    if (!extractedUser) continue;

    const userMessages = messagesByUser.get((extractedUser as any).providerId) || [];
    if (!userMessages.length) continue;

    const existingIntents = await getExistingIntents(createdUser.id);
    
    const result = await analyzeObjects(
      userMessages,
      `Generate intents for Slack user "${createdUser.name}" based on their messages`,
      Array.from(existingIntents),
      3,
      60000
    );

    if (result.success) {
      for (const intentData of result.intents) {
        if (!existingIntents.has(intentData.payload)) {
          await saveIntent(intentData.payload, createdUser.id, sourceId);
          totalIntentsGenerated++;
          existingIntents.add(intentData.payload);
        }
      }
    }
  }

  log.info('Slack processing complete', { 
    intentsGenerated: totalIntentsGenerated,
    usersProcessed: createdUsers.length,
    newUsersCreated
  });

  return { 
    intentsGenerated: totalIntentsGenerated, 
    usersProcessed: createdUsers.length,
    newUsersCreated
  };
}

// Extract Slack users from messages
export function extractSlackUsers(messages: any[]) {
  const userMap = new Map();
  
  for (const message of messages) {
    const userId = message.user;
    if (!userId || userMap.has(userId)) continue;
    
    // Skip bot users and system messages
    if (message.bot_id || message.subtype) continue;
    
    const username = message.username || `slack-user-${userId}`;
    const realName = message.real_name || message.display_name || username;
    const email = `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}+slack-${userId}@slack.index.app`;
    
    userMap.set(userId, {
      email,
      name: realName,
      provider: 'slack',
      providerId: userId
    });
  }
  
  return Array.from(userMap.values());
}

export const slackHandler: IntegrationHandler<SlackMessage> = { fetchObjects };
