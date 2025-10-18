import type { IntegrationHandler, UserIdentifier } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { getIntegrationById } from '../integration-utils';

// Constants
const CHANNEL_LIMIT = 200;
const USER_LIMIT = 200;
const MAX_INTENTS_PER_USER = 3;
const INTENT_TIMEOUT = 60000;

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
    data?: {
      members?: SlackUser[];
      response_metadata?: {
        next_cursor?: string;
      };
    };
  };
}


// Return raw Slack messages as objects
async function fetchObjects(integrationId: string, lastSyncAt?: Date): Promise<SlackMessage[]> {
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

    log.info('Slack objects sync start', { integrationId, userId: integration.userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();
    const connectedAccountId = integration.connectedAccountId;

    // Fetch channels
    const channels: SlackChannel[] = [];
    const channelsResp = await composio.tools.execute('SLACK_LIST_ALL_CHANNELS', { 
      userId: integration.userId,
      connectedAccountId, 
      arguments: { limit: CHANNEL_LIMIT } 
    }) as SlackApiResponse;
    
    const channelList = channelsResp?.data?.channels || [];
    for (const ch of channelList) {
      if (ch?.id && !channels.find((c) => c.id === ch.id)) {
        channels.push({ id: ch.id, name: ch.name });
      }
    }

    log.info('Slack channels', { count: channels.length });
    if (!channels.length) return [];

    // Fetch all users from Slack workspace for metadata
    const userMap = new Map<string, SlackUser>();
    try {
      log.info('Fetching all Slack users');
      
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
        
        const userData = usersResp?.data?.data;
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
      
      log.info('Slack users fetched', { count: userMap.size });
    } catch (error) {
      log.error('Failed to fetch Slack users', { error: (error as Error).message });
    }

    // Fetch messages from all channels
    const allMessages: SlackMessage[] = [];
    let messagesTotal = 0;
    
    for (const ch of channels) {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      const args: any = { channel: channelId, include_all_metadata: true };
      if (lastSyncAt) args.oldest = (lastSyncAt.getTime() / 1000).toString();

      const history = await composio.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', { 
        userId: integration.userId,
        connectedAccountId, 
        arguments: args 
      }) as SlackApiResponse;

      // Parse messages directly from API response
      const messages = history?.data?.messages || [];
      messagesTotal += messages.length;
      
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
        
        allMessages.push({
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
          }
        });
      }
    }
    log.info('Slack objects sync done', { integrationId, objects: allMessages.length, total: messagesTotal });
    return allMessages;
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
