import type { IntegrationHandler, UserIdentifier } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';
import { ensureIndexMembership } from '../membership-utils';
import { addGenerateIntentsJob } from '../../queue/llm-queue';

// Constants
const MESSAGE_LIMIT = 100;

export interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    username: string;
    global_name?: string;
  };
  timestamp: string;
  edited_timestamp?: string;
  channel_id: string;
  channel_name: string;
  embeds?: any[];
  attachments?: any[];
}


// Shared function to get raw Discord messages
async function fetchDiscordMessages(integrationId: string, lastSyncAt?: Date): Promise<any[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    log.info('Discord sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Get the connected account details by listing with the specific ID
    const accounts = await composio.connectedAccounts.list({
      userIds: [integration.userId]
    });
    // Find the specific connected account by ID
    const account = accounts?.items?.find((acc: any) => acc.id === connectedAccountId);
    if (!account) {
      log.error('Connected account not found', { connectedAccountId, integrationId });
      return [];
    }

    // Get guild information from the connected account data
    const guild = (account as any).data?.guild;
    if (!guild?.id) {
      log.info('No guild found in connected account', { integrationId });
      return [];
    }

    // Fetch channels from the guild
    const channels: Array<{ id: string; name?: string }> = [];
    
    const guildChannels = await composio.tools.execute('DISCORDBOT_LIST_GUILD_CHANNELS', {
      userId: integration.userId,
      connectedAccountId,
      arguments: { guild_id: guild.id }
    });

    // Parse channels directly from API response
    const channelList = (guildChannels as any)?.data?.details || [];
    for (const ch of channelList) {
      // Only include text channels (type 0) and news channels (type 5)
      if (ch?.id && (ch.type === 0 || ch.type === 5)) {
        channels.push({ id: ch.id, name: ch.name });
      }
    }

    log.info('Discord channels', { count: channels.length });
    if (!channels.length) return [];

    const allMessages: any[] = [];
    let messagesTotal = 0;

    for (const ch of channels) {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      const args: any = { channel_id: channelId, limit: MESSAGE_LIMIT };
      
      // Add after timestamp filter if lastSyncAt is provided
      if (lastSyncAt) {
        const timestampMs = lastSyncAt.getTime();
        const discordEpoch = 1420070400000; // Discord epoch (2015-01-01)
        const snowflake = ((timestampMs - discordEpoch) << 22).toString();
        args.after = snowflake;
      }

      const messages = await composio.tools.execute('DISCORDBOT_LIST_MESSAGES', { 
        userId: integration.userId,
        connectedAccountId,
        arguments: args
      });

      const messageList = (messages as any)?.data?.details || [];
      messagesTotal += messageList.length;

      for (const msg of messageList) {
        if (!msg?.id || !msg?.timestamp) continue; // Skip invalid messages
        if (msg.type && msg.type !== 0) continue; // Skip system messages
        
        // Add channel info to message
        msg.channel_id = channelId;
        msg.channel_name = channelName;
        
        // Filter by lastSyncAt
        const messageTime = new Date(msg.edited_timestamp || msg.timestamp);
        if (!lastSyncAt || messageTime > lastSyncAt) {
          allMessages.push(msg);
        }
      }
    }
    log.info('Discord messages', { total: messagesTotal, filtered: allMessages.length });
    return allMessages;
  } catch (error) {
    log.error('Discord sync error', { integrationId, error: (error as Error).message });
    return [];
  }
}

// Return raw Discord messages as objects
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<DiscordMessage[]> {
  try {
    const messages = await fetchDiscordMessages(integrationId, lastSyncAt);
    const discordMessages: DiscordMessage[] = [];
  
  for (const msg of messages) {
    // Extract content from various sources
    let content = msg.content || '';
    
    // If main content is empty, try to extract from embeds
    if (!content && msg.embeds && msg.embeds.length > 0) {
      const embedTexts: string[] = [];
      for (const embed of msg.embeds) {
        if (embed.title) embedTexts.push(`**${embed.title}**`);
        if (embed.description) embedTexts.push(embed.description);
        if (embed.fields) {
          for (const field of embed.fields) {
            embedTexts.push(`**${field.name}:** ${field.value}`);
          }
        }
      }
      if (embedTexts.length > 0) {
        content = embedTexts.join('\n\n');
      }
    }
    
    // Add attachment information if available
    if (msg.attachments && msg.attachments.length > 0) {
      const attachmentsList = msg.attachments.map((att: any) => 
        `- [${att.filename}](${att.url}) (${att.size} bytes)`
      ).join('\n');
      content += content ? `\n\n**Attachments:**\n${attachmentsList}` : `**Attachments:**\n${attachmentsList}`;
    }
    
    if (!content) {
      content = '*[Message content unavailable - Discord bot may need MESSAGE_CONTENT intent]*';
    }
    
    discordMessages.push({
      id: msg.id,
      content,
      author: {
        id: msg.author?.id || 'unknown',
        username: msg.author?.username || 'unknown',
        global_name: msg.author?.global_name
      },
      timestamp: msg.timestamp,
      edited_timestamp: msg.edited_timestamp,
      channel_id: msg.channel_id,
      channel_name: msg.channel_name,
      embeds: msg.embeds,
      attachments: msg.attachments
    });
  }
  
  log.info('Discord objects sync done', { integrationId, objects: discordMessages.length });
  return discordMessages;
  } catch (error) {
    log.error('Discord objects sync error', { integrationId, error: (error as Error).message });
    return [];
  }
}

/**
 * Extract unique users from Discord messages
 */
function extractUsers(messages: DiscordMessage[]): UserIdentifier[] {
  const userMap = new Map<string, UserIdentifier>();

  for (const message of messages) {
    const discordUserId = message.author.id;
    if (userMap.has(discordUserId)) continue;

    const username = message.author.username;
    const name = message.author.global_name || username;
    const email = `${username}@discord.local`;

    userMap.set(discordUserId, {
      id: discordUserId,
      email,
      name,
      provider: 'discord',
      providerId: discordUserId
    });
  }

  return Array.from(userMap.values());
}

export const discordHandler: IntegrationHandler<DiscordMessage> = {
  enableUserAttribution: true,
  fetchObjects,
  extractUsers
};
