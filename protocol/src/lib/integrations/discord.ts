import type { IntegrationHandler, IntegrationFile } from './index';
import { getClient } from './composio';
import { log } from '../log';
import { withRetry, concurrencyLimit, mapDiscordMessageToFile } from './util';

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    log.info('Discord sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();

    const connectedAccounts = await withRetry(() => composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['discordbot'],
    }));

    const account = connectedAccounts?.items?.[0];
    if (!account) {
      // No connected accounts; nothing to do
      return [];
    }
    const connectedAccountId = account.id;

    // Get guild information from the connected account data
    const guild = account.data?.guild;
    if (!guild?.id) {
      log.info('No guild found in connected account', { userId });
      return [];
    }

    // Fetch channels from the guild
    const channels: Array<{ id: string; name?: string }> = [];
    
    const guildChannels = await withRetry(() => composio.tools.execute('DISCORDBOT_LIST_GUILD_CHANNELS', {
      userId,
      connectedAccountId,
      arguments: { guild_id: guild.id }
    }));

    // Parse channels directly from API response
    const channelList = (guildChannels as any)?.data?.details || [];
    for (const ch of channelList) {
      // Only include text channels (type 0) and news channels (type 5)
      // Skip voice channels (type 2) and category channels (type 4)
      if (ch?.id && (ch.type === 0 || ch.type === 5)) {
        channels.push({ id: ch.id, name: ch.name });
      }
    }

    log.info('Discord channels', { count: channels.length });
    if (!channels.length) return [];

    const limit = concurrencyLimit(6);
    const files: IntegrationFile[] = [];
    let messagesTotal = 0;

    const tasks = channels.map((ch) => limit(async () => {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      const args: any = { channel_id: channelId, limit: 100 };
      
      // Add after timestamp filter if lastSyncAt is provided
      if (lastSyncAt) {
        // Discord uses snowflake IDs which include timestamp
        // Convert timestamp to Discord snowflake format for filtering
        const timestampMs = lastSyncAt.getTime();
        const discordEpoch = 1420070400000; // Discord epoch (2015-01-01)
        const snowflake = ((timestampMs - discordEpoch) << 22).toString();
        args.after = snowflake;
      }

      const messages = await withRetry(
        () => composio.tools.execute('DISCORDBOT_LIST_MESSAGES', { 
          userId, 
          connectedAccountId, 
          arguments: args 
        }),
        { retries: 3 }
      );

      // Parse messages directly from the API response
      const messageList = messages?.data?.details || [];
      messagesTotal += messageList.length;

      for (const msg of messageList) {
        // Debug logging to understand message structure
        log.info('Discord message received', { 
          id: msg?.id, 
          hasContent: !!msg?.content, 
          contentLength: msg?.content?.length || 0,
          author: msg?.author?.username,
          timestamp: msg?.timestamp,
          type: msg?.type
        });
        
        if (!msg?.id || !msg?.timestamp) continue; // Skip invalid messages
        
        // Skip only system messages (type 0 = DEFAULT, others are system messages)
        if (msg.type && msg.type !== 0) {
          continue;
        }
        
        // Log messages with empty content for debugging
        if (!msg.content || msg.content.trim() === '') {
          log.warn('Discord message has empty content - may need MESSAGE_CONTENT intent', {
            messageId: msg.id,
            authorId: msg.author?.id,
            hasEmbeds: !!(msg.embeds && msg.embeds.length > 0),
            hasAttachments: !!(msg.attachments && msg.attachments.length > 0)
          });
        }
        
        const file = mapDiscordMessageToFile(channelId, channelName, msg);
        if (!lastSyncAt || file.lastModified > lastSyncAt) {
          files.push(file);
        }
      }
    }));

    await Promise.all(tasks);
    log.info('Discord messages', { total: messagesTotal });
    log.info('Discord sync done', { userId, files: files.length });
    return files;
  } catch (error) {
    log.error('Discord sync error', { userId, error: (error as Error).message });
    return [];
  }
}

export const discordHandler: IntegrationHandler = { fetchFiles };
