import type { IntegrationHandler, UserIdentifier } from '../index';
import { processObjects } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';
import { INTEGRATIONS } from '../config';
import { getSlackLogger } from './slack-logger';

// Constants
const CHANNEL_LIMIT = 200;
const USER_LIMIT = 200;
// Slack conversation history rate limits:
// - 1 call per minute
// - 15 messages per call
// - Total: 15 messages per minute
const MESSAGE_LIMIT = 15; // Messages per call
// Get sync delay from config (defaults to 60 seconds)
const RATE_LIMIT_DELAY_MS = INTEGRATIONS.slack.syncDelayMs || 60000;
const RATE_LIMIT_RETRY_MS = INTEGRATIONS.slack.syncDelayMs || 60000; // Use same delay for retries
const MAX_RETRIES = 3; // Max retries per API call

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to check if error is rate limit related
const isRateLimitError = (error: any): boolean => {
  const errorMsg = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.status;
  return errorCode === 429 || 
         errorMsg.includes('rate_limited') || 
         errorMsg.includes('rate limit') ||
         errorMsg.includes('too many requests');
};

// Helper to extract retry-after delay from error
const getRetryAfterDelay = (error: any): number => {
  // Check for Retry-After header in various possible locations
  const retryAfter = 
    error?.response?.headers?.['retry-after'] ||
    error?.response?.headers?.['Retry-After'] ||
    error?.headers?.['retry-after'] ||
    error?.headers?.['Retry-After'] ||
    error?.data?.['retry-after'];
  
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      log.info(`Slack provided Retry-After: ${seconds} seconds`);
      return seconds * 1000; // Convert to milliseconds
    }
  }
  
  // Default to 60 seconds if no Retry-After header found
  log.info('No Retry-After header found, using default 60 seconds');
  return RATE_LIMIT_RETRY_MS;
};

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
  user_profile?: {
    email: string;
    name: string;
    avatar?: string;
  };
  metadata?: {
    createdAt: Date;
  };
}

interface SlackChannel {
  id: string;
  name?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
    image_24?: string;
    image_32?: string;
    image_48?: string;
    image_72?: string;
    image_192?: string;
    image_512?: string;
    image_1024?: string;
    image_original?: string;
  };
}

interface SlackApiResponse {
  data?: {
    channels?: SlackChannel[];
    messages?: any[];
    members?: SlackUser[];
    response_metadata?: {
      next_cursor?: string;
    };
  };
}


// Return raw Slack messages as objects
// Slack only supports index integrations (attribution mode)
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<SlackMessage[]> {
  try {
    const integration = await getIntegrationById(integrationId);
    if (!integration) {
      log.error('Integration not found', { integrationId });
      return [];
    }

    // Slack requires index integration
    if (!integration.indexId) {
      log.warn('Slack integration requires an index (attribution mode)', { integrationId });
      return [];
    }

    if (!integration.connectedAccountId) {
      log.error('No connected account ID found for integration', { integrationId });
      return [];
    }

    const syncFrom = lastSyncAt ? lastSyncAt.toISOString() : 'all time';
    log.info('Slack sync starting', { integrationId, since: syncFrom });
    
    const logger = getSlackLogger();
    logger.updateIntegrationStart(integrationId, syncFrom);
    
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Fetch channels with pagination
    const channels: SlackChannel[] = [];
    let channelCursor: string | undefined;
    
    do {
      const channelsResp = await composio.tools.execute('SLACK_LIST_ALL_CHANNELS', { 
        userId: integration.userId,
        connectedAccountId, 
        arguments: { 
          limit: CHANNEL_LIMIT,
          ...(channelCursor && { cursor: channelCursor })
        } 
      }) as SlackApiResponse;
      
      const channelList = channelsResp?.data?.channels || [];
      for (const ch of channelList) {
        if (ch?.id && !channels.find((c) => c.id === ch.id)) {
          channels.push({ id: ch.id, name: ch.name });
        }
      }
      
      channelCursor = channelsResp?.data?.response_metadata?.next_cursor;
    } while (channelCursor);

    // Apply channel filter from database config
    let filteredChannels = channels;
    const selectedChannelIds = integration.config?.slack?.selectedChannels;
    
    if (selectedChannelIds && selectedChannelIds.length > 0) {
      filteredChannels = channels.filter(ch => selectedChannelIds.includes(ch.id));
    }
    
    log.info('Slack channels', { total: channels.length, selected: filteredChannels.length });
    
    logger.updateChannelCounts(integrationId, channels.length, filteredChannels.length);
    logger.setChannels(
      integrationId,
      filteredChannels.map(ch => ({
        id: ch.id,
        name: ch.name || ch.id
      }))
    );
    
    if (!filteredChannels.length) return [];

    // Fetch all users from Slack workspace for metadata
    const userMap = new Map<string, SlackUser>();
    try {
      let cursor: string | undefined;
      let allUsers: any[] = [];
      
      do {
        const usersResp = await composio.tools.execute('SLACK_LIST_ALL_USERS', {
          userId: integration.userId,
          connectedAccountId,
          arguments: { 
            limit: USER_LIMIT,
            include_locale: true,
            ...(cursor && { cursor })
          }
        }) as SlackApiResponse;
        
        const userData = usersResp?.data;
        if (userData?.members) {
          allUsers = allUsers.concat(userData.members);
          cursor = userData.response_metadata?.next_cursor;
        } else {
          break;
        }
      } while (cursor);
      
      // Store users in map for quick lookup
      for (const user of allUsers) {
        if (user?.id) {
          userMap.set(user.id, user as SlackUser);
        }
      }
      
      log.debug('Slack users fetched', { count: userMap.size });
    } catch (error) {
      log.error('Failed to fetch Slack users', { error: (error as Error).message });
    }

    // Fetch messages from all channels
    let channelsProcessed = 0;
    
    for (const ch of filteredChannels) {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      
      log.info(`Processing channel ${channelsProcessed + 1}/${filteredChannels.length}: ${channelName}`);
      
      logger.updateChannelStatus(integrationId, channelId, 'running');
      
      let channelMessages = 0;
      let messageCursor: string | undefined;
      let pageNum = 0;
      
      // Fetch all messages with pagination
      do {
        pageNum++;
        const args: any = { 
          channel: channelId, 
          limit: MESSAGE_LIMIT, 
          include_all_metadata: true,
          ...(messageCursor && { cursor: messageCursor })
        };
        
        // For kernel-asks, always limit to last 2 months
        if (channelName === 'kernel-asks') {
          const twoMonthsAgo = new Date();
          twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
          const twoMonthsTimestamp = (twoMonthsAgo.getTime() / 1000).toString();
          
          // Use the more recent timestamp between lastSyncAt and 2 months ago
          if (lastSyncAt) {
            const lastSyncTimestamp = (lastSyncAt.getTime() / 1000).toString();
            args.oldest = lastSyncTimestamp > twoMonthsTimestamp ? lastSyncTimestamp : twoMonthsTimestamp;
          } else {
            args.oldest = twoMonthsTimestamp;
          }
        } else if (lastSyncAt) {
          args.oldest = (lastSyncAt.getTime() / 1000).toString();
        }

        let retries = 0;
        let history: SlackApiResponse | null = null;
        
        // Retry loop for rate limit handling
        while (retries <= MAX_RETRIES) {
          try {
            history = await composio.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', { 
              userId: integration.userId,
              connectedAccountId, 
              arguments: args 
            }) as SlackApiResponse;
            
            // Success - clear any rate limit indicator
            logger.clearRateLimit(integrationId, channelId);
            // Success - break out of retry loop
            break;
          } catch (error) {
            if (isRateLimitError(error)) {
              retries++;
              if (retries <= MAX_RETRIES) {
                const retryDelay = getRetryAfterDelay(error);
                logger.updateRateLimit(integrationId, channelId, retryDelay);
                log.warn(`Rate limit hit on page ${pageNum}, waiting ${retryDelay}ms before retry ${retries}/${MAX_RETRIES}`, {
                  channelName,
                  error: (error as Error).message,
                  errorDetails: JSON.stringify(error, null, 2)
                });
                await sleep(retryDelay);
                logger.clearRateLimit(integrationId, channelId);
                continue; // Retry the request
              } else {
                log.error(`Rate limit exceeded max retries for channel`, {
                  channelName,
                  pageNum,
                  error: (error as Error).message
                });
                throw error; // Re-throw after max retries
              }
            } else {
              // Not a rate limit error - throw immediately
              throw error;
            }
          }
        }
        
        if (!history) {
          log.error('Failed to fetch history after retries', { channelName, pageNum });
          break; // Move to next channel
        }

        try {

          // Parse messages directly from API response
          const messages = history?.data?.messages || [];
          channelMessages += messages.length;
          const hasMore = !!history?.data?.response_metadata?.next_cursor;
          
          log.debug(`Fetched page ${pageNum}`, { 
            channelName,
            messagesInPage: messages.length,
            channelMessagesTotal: channelMessages,
            hasMore
          });
          
          // Update page progress (estimate total pages if we have cursor)
          const lastMessage = messages[messages.length - 1];
          const lastMessageAt = lastMessage?.ts ? new Date(parseFloat(lastMessage.ts) * 1000) : undefined;

          logger.updateChannelProgress(integrationId, channelId, {
            currentPage: pageNum,
            hasMore,
            lastMessageAt,
            messagesProcessed: channelMessages
          });
          
          // Process messages from this page immediately
          const pageMessages: SlackMessage[] = [];
          
          for (const msg of messages) {
            if (!isValidMessage(msg, lastSyncAt)) {
              continue;
            }
            
            // Get user profile for metadata
            const userProfile = userMap.get(msg.user);
            
            // Only include messages with valid user profiles
            if (!userProfile?.profile?.email) {
              log.debug('Skipping message without user email', { userId: msg.user });
              continue;
            }
            
            // Convert Slack timestamp to Date
            const messageDate = new Date(parseFloat(msg.ts) * 1000);
            
            pageMessages.push({
              ts: msg.ts,
              text: msg.text || '',
              user: msg.user,
              username: msg.username || userProfile.name,
              real_name: msg.real_name || userProfile.real_name,
              display_name: msg.display_name || userProfile.profile.display_name,
              channel_id: channelId,
              channel_name: channelName,
              bot_id: msg.bot_id,
              subtype: msg.subtype,
              user_profile: {
                email: userProfile.profile.email,
                name: userProfile.real_name || userProfile.profile.real_name || userProfile.profile.display_name || msg.user,
                avatar: userProfile.profile.image_original
              },
              metadata: {
                createdAt: messageDate
              }
            });
          }
          
          // Process this page of messages immediately (all at once for parallel user processing)
          if (pageMessages.length > 0) {
            const result = await processObjects(pageMessages, {
              id: integration.id,
              indexId: integration.indexId || undefined,
              userId: integration.userId,
              enableUserAttribution: true
            }, slackHandler);
            
            // Update user creation count
            if (result.newUsersCreated > 0) {
              logger.incrementUsersCreated(integrationId, result.newUsersCreated);
            }
          }
          
          messageCursor = history?.data?.response_metadata?.next_cursor;
          
          // Add delay before next API call to avoid rate limiting
          if (messageCursor) {
            logger.updateRateLimit(integrationId, channelId, RATE_LIMIT_DELAY_MS);
            await sleep(RATE_LIMIT_DELAY_MS);
            logger.clearRateLimit(integrationId, channelId);
          }
        } catch (error) {
          // This catch is for message processing errors, not API errors (those are caught above)
          log.error('Failed to process messages for channel', { 
            channelName, 
            channelId, 
            error: (error as Error).message 
          });
          break; // Move to next channel on error
        }
      } while (messageCursor);
      
      channelsProcessed++;
      logger.updateChannelStatus(integrationId, channelId, 'done', channelMessages);
      log.info(`Channel done: ${channelName}`, { messages: channelMessages });
      
      // Add delay between channels to respect rate limits (especially for non-Marketplace apps)
      if (channelsProcessed < filteredChannels.length) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
    }
    
    logger.completeIntegration(integrationId);
    log.info('Slack sync complete', { integrationId, channels: channelsProcessed });
    // Return empty array since messages are processed incrementally
    return [];
  } catch (error) {
    log.error('Slack objects sync error', { integrationId, error: (error as Error).message });
    return [];
  }
}

/**
 * Helper function to validate if a message should be processed
 */
function isValidMessage(msg: any, lastSyncAt?: Date): boolean {
  if (!msg?.ts || !msg?.user) {
    return false;
  }
  
  // Skip bots and system messages
  if (msg.bot_id || msg.subtype) {
    return false;
  }
  
  // Check if message is newer than last sync
  if (lastSyncAt) {
    const messageTime = new Date(parseFloat(msg.ts) * 1000);
    if (messageTime <= lastSyncAt) {
      return false;
    }
  }
  
  return true;
}

/**
 * Extract unique users from Slack messages
 */
function extractUsers(messages: SlackMessage[]): UserIdentifier[] {
  const userMap = new Map<string, UserIdentifier>();

  for (const message of messages) {
    if (!message.user_profile) continue;

    const slackUserId = message.user;
    if (userMap.has(slackUserId)) continue;

    userMap.set(slackUserId, {
      id: slackUserId,
      email: message.user_profile.email,
      name: message.user_profile.name,
      provider: 'slack',
      providerId: slackUserId,
      avatar: message.user_profile.avatar
    });
  }

  return Array.from(userMap.values());
}

export const slackHandler: IntegrationHandler<SlackMessage> = {
  enableUserAttribution: true,
  fetchObjects,
  extractUsers
};
