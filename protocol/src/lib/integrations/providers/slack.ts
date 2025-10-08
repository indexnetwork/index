import type { IntegrationHandler } from '../index';
import { getClient } from '../composio';
import { log } from '../../log';
import { analyzeObjects } from '../../../agents/core/intent_inferrer';
import { resolveSlackUser } from '../../user-utils';
import { IntentService } from '../../../services/intent-service';
import { ensureIndexMembership } from '../membership-utils';
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
  user_resolved?: {
    id: string;
    name: string;
    email: string;
    isNewUser: boolean;
  };
}

interface SlackChannel {
  id: string;
  name?: string;
}

interface SlackUser {
  id: string;
  real_name?: string;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
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

/**
 * Helper function to resolve user information for a Slack message
 */
async function resolveUserForMessage(
  msg: any, 
  userMap: Map<string, SlackUser>
): Promise<SlackMessage['user_resolved'] | null> {
  try {
    const userProfile = userMap.get(msg.user);
    if (!userProfile?.profile?.email) {
      log.debug('No email found for user, skipping message', { 
        slackUserId: msg.user, 
        messageTs: msg.ts 
      });
      return null;
    }

    // Simplified name resolution with fallback chain
    const name = userProfile.real_name || 
                 userProfile.profile.real_name || 
                 userProfile.profile.display_name || 
                 msg.real_name || 
                 msg.display_name || 
                 msg.username || 
                 msg.user;
    
    const resolvedUser = await resolveSlackUser(userProfile.profile.email, msg.user, name);
    if (!resolvedUser) {
      return null;
    }

    return {
      id: resolvedUser.id,
      name: resolvedUser.name,
      email: resolvedUser.email,
      isNewUser: resolvedUser.isNewUser
    };
  } catch (error) {
    log.error('Failed to resolve user for message', { 
      slackUserId: msg.user, 
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
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

    // Fetch all users from Slack workspace
    const userMap = new Map<string, SlackUser>();
    try {
      log.info('Fetching all Slack users');
      
      let cursor: string | undefined;
      let allUsers: any[] = [];
      
      do {
        const usersResp = await composio.tools.execute('SLACK_LIST_ALL_USERS', {
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
    
    const allMessages: SlackMessage[] = [];
    let messagesTotal = 0;
    
    for (const ch of channels) {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      const args: any = { channel: channelId, include_all_metadata: true };
      if (lastSyncAt) args.oldest = (lastSyncAt.getTime() / 1000).toString();

      const history = await composio.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', { 
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
        
        // Resolve user information
        const userResolved = await resolveUserForMessage(msg, userMap);
        if (!userResolved) {
          continue;
        }
        
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
          subtype: msg.subtype,
          user_resolved: userResolved
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

// Process Slack messages to generate intents per user
export async function processSlackMessages(
  messages: SlackMessage[],
  integration: { id: string; indexId: string }
): Promise<{ intentsGenerated: number; usersProcessed: number; newUsersCreated: number }> {
  if (!messages.length) {
    return { intentsGenerated: 0, usersProcessed: 0, newUsersCreated: 0 };
  }

  log.info('Processing Slack messages', { count: messages.length });

  // Group messages by Slack user ID first
  const messagesByUser = new Map<string, SlackMessage[]>();
  for (const message of messages) {
    const userId = message.user;
    if (!messagesByUser.has(userId)) {
      messagesByUser.set(userId, []);
    }
    messagesByUser.get(userId)!.push(message);
  }

  let totalIntentsGenerated = 0;
  let usersProcessed = 0;
  let newUsersCreated = 0;

  // Process each user individually
  for (const [slackUserId, userMessages] of messagesByUser) {
    if (!userMessages.length) continue;

    // Get user info from the first message's resolved user data
    const firstMessage = userMessages[0];
    const userResolved = firstMessage.user_resolved;
    
    if (!userResolved) {
      log.error('No resolved user data found for Slack user', { slackUserId });
      continue;
    }

    try {
      if (userResolved.isNewUser) {
        newUsersCreated++;
      }
      usersProcessed++;
      
      log.info('Processing Slack user', { 
        slackUserId, 
        email: userResolved.email, 
        name: userResolved.name, 
        userId: userResolved.id,
        isNewUser: userResolved.isNewUser
      });

      // Add user as index member if not already a member
      await ensureIndexMembership(userResolved.id, integration.indexId);

      // Generate intents for this user
      const existingIntents = await IntentService.getUserIntents(userResolved.id);
      
      const intentResult = await analyzeObjects(
        userMessages,
        `Generate intents for Slack user "${userResolved.name}" based on their messages`,
        Array.from(existingIntents),
        MAX_INTENTS_PER_USER,
        INTENT_TIMEOUT
      );

      if (intentResult.success) {
        for (const intentData of intentResult.intents) {
          if (!existingIntents.has(intentData.payload)) {
            await IntentService.createIntent({
              payload: intentData.payload,
              userId: userResolved.id,
              sourceId: integration.id,
              sourceType: 'integration',
              indexIds: [integration.indexId]
            });
            totalIntentsGenerated++;
            existingIntents.add(intentData.payload);
          }
        }
      }
    } catch (error) {
      log.error('Failed to process Slack user', {
        slackUserId,
        username: firstMessage.username,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue processing other users even if one fails
    }
  }

  log.info('Slack processing complete', { 
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

export const slackHandler: IntegrationHandler<SlackMessage> = { 
  fetchObjects,
  processObjects: processSlackMessages
};
