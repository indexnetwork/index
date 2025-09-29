import type { IntegrationHandler } from '../index';

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
import { getClient } from '../composio';
import { log } from '../../log';
import { analyzeObjects } from '../../../agents/core/intent_inferrer';
import { saveUser } from '../../user-utils';
import { IntentService } from '../../../services/intent-service';


// Shared function to get raw Discord messages
async function fetchDiscordMessages(userId: string, lastSyncAt?: Date): Promise<any[]> {
  try {
    log.info('Discord sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();

    const connectedAccounts = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['discordbot'],
    });

    const account = connectedAccounts?.items?.[0];
    if (!account) return [];
    const connectedAccountId = account.id;

    // Get guild information from the connected account data
    const guild = account.data?.guild;
    if (!guild?.id) {
      log.info('No guild found in connected account', { userId });
      return [];
    }

    // Fetch channels from the guild
    const channels: Array<{ id: string; name?: string }> = [];
    
    const guildChannels = await composio.tools.execute('DISCORDBOT_LIST_GUILD_CHANNELS', {
      userId,
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
      const args: any = { channel_id: channelId, limit: 100 };
      
      // Add after timestamp filter if lastSyncAt is provided
      if (lastSyncAt) {
        const timestampMs = lastSyncAt.getTime();
        const discordEpoch = 1420070400000; // Discord epoch (2015-01-01)
        const snowflake = ((timestampMs - discordEpoch) << 22).toString();
        args.after = snowflake;
      }

      const messages = await composio.tools.execute('DISCORDBOT_LIST_MESSAGES', { 
        userId, 
        connectedAccountId,
        arguments: args
      });

      const messageList = messages?.data?.details || [];
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
    log.error('Discord sync error', { userId, error: (error as Error).message });
    return [];
  }
}

// Return raw Discord messages as objects
async function fetchObjects(userId: string, lastSyncAt?: Date): Promise<DiscordMessage[]> {
  const messages = await fetchDiscordMessages(userId, lastSyncAt);
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
  
  log.info('Discord objects sync done', { userId, objects: discordMessages.length });
  return discordMessages;
}

// Process Discord messages to generate intents per user
export async function processDiscordMessages(
  messages: DiscordMessage[],
  sourceId: string
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!messages.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  // Using static imports from top of file

  log.info('Processing Discord messages', { count: messages.length });

  // Group messages by Discord user ID first
  const messagesByUser = new Map<string, DiscordMessage[]>();
  for (const message of messages) {
    const userId = message.author.id;
    if (!messagesByUser.has(userId)) {
      messagesByUser.set(userId, []);
    }
    messagesByUser.get(userId)!.push(message);
  }

  let totalIntentsGenerated = 0;
  let usersProcessed = 0;
  let newUsersCreated = 0;

  // Process each user individually
  for (const [discordUserId, userMessages] of messagesByUser) {
    if (!userMessages.length) continue;

    // Extract user info from the first message
    const firstMessage = userMessages[0];
    const extractedUser = {
      email: `${firstMessage.author.username}@discord.local`,
      name: firstMessage.author.global_name || firstMessage.author.username,
      provider: 'discord' as const,
      providerId: firstMessage.author.id
    };

    try {
      // Save user individually
      const createdUser = await saveUser(extractedUser);
      if (createdUser.isNewUser) {
        newUsersCreated++;
      }
      usersProcessed++;

      // Generate intents for this user
      const existingIntents = await IntentService.getUserIntents(createdUser.id);
      
      const result = await analyzeObjects(
        userMessages,
        `Generate intents for Discord user "${createdUser.name}" based on their messages`,
        Array.from(existingIntents),
        3,
        60000
      );

      if (result.success) {
        for (const intentData of result.intents) {
          if (!existingIntents.has(intentData.payload)) {
            await IntentService.createIntent({
              payload: intentData.payload,
              userId: createdUser.id,
              sourceId,
              sourceType: 'integration'
            });
            totalIntentsGenerated++;
            existingIntents.add(intentData.payload);
          }
        }
      }
    } catch (error) {
      log.error('Failed to process Discord user', {
        discordUserId,
        username: firstMessage.author.username,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue processing other users even if one fails
    }
  }

  log.info('Discord processing complete', { 
    intentsGenerated: totalIntentsGenerated,
    usersProcessed,
    newUsersCreated
  });

  return { 
    intentsGenerated: totalIntentsGenerated, 
    usersProcessed,
    newUsersCreated
  };
}


export const discordHandler: IntegrationHandler<DiscordMessage> = { fetchObjects };
