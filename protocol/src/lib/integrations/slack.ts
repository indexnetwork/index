import type { IntegrationHandler, IntegrationFile } from './index';

let composio: any;
export const __setComposio = (client: any) => {
  composio = client;
};
const initComposio = async () => {
  console.log('[Slack Integration] Initializing Composio client...');
  if (!composio) {
    console.log('[Slack Integration] Creating new Composio instance...');
    const { Composio } = await import('@composio/core');
    composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
    console.log('[Slack Integration] Composio client created successfully');
  } else {
    console.log('[Slack Integration] Using existing Composio client');
  }
  return composio;
};

function formatMessage(channelName: string, message: any): { content: string; lastModified: Date } {
  console.log(`[Slack Integration] Formatting message from channel: ${channelName}`, {
    messageTs: message.ts,
    messageUser: message.user || message.username,
    messageText: message.text ? message.text.substring(0, 100) + '...' : 'no text'
  });
  
  const ts = typeof message.ts === 'string' ? parseFloat(message.ts) * 1000 : Date.now();
  const lastModified = new Date(ts);
  const sender = message.user || message.username || 'unknown';
  const text = message.text || '';
  const markdown = `# ${channelName}\n\n**From:** ${sender}\n\n**Sent:** ${lastModified.toISOString()}\n\n${text}`;
  
  console.log(`[Slack Integration] Formatted message:`, {
    lastModified: lastModified.toISOString(),
    contentLength: markdown.length,
    sender
  });
  
  return { content: markdown, lastModified };
}

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    console.log(`[Slack Integration] ===== STARTING SLACK SYNC =====`);
    console.log(`[Slack Integration] User ID: ${userId}`);
    console.log(`[Slack Integration] Last sync time: ${lastSyncAt?.toISOString() ?? 'never'}`);
    
    const composioClient = await initComposio();
    console.log('[Slack Integration] Composio client initialized successfully');

    console.log('[Slack Integration] Fetching connected accounts...');
    const connectedAccounts = await composioClient.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['slack'],
    });
    
    console.log('[Slack Integration] Connected accounts response:', {
      hasItems: !!connectedAccounts?.items,
      itemCount: connectedAccounts?.items?.length || 0,
      items: connectedAccounts?.items?.map((acc: any) => ({ id: acc.id, name: acc.name })) || []
    });
    
    if (!connectedAccounts || connectedAccounts.items.length === 0) {
      console.warn('[Slack Integration] No connected Slack accounts found for user');
      return [];
    }

    const connectedAccountId = connectedAccounts.items[0].id;
    console.log(`[Slack Integration] Using connected account ID: ${connectedAccountId}`);
    
    const files: IntegrationFile[] = [];

    console.log('[Slack Integration] Fetching all channels...');
    const channelsResp = await composioClient.tools.execute('SLACK_LIST_ALL_CHANNELS', {
      userId,
      connectedAccountId,
      arguments: {},
    });
    
    console.log('[Slack Integration] Channels response structure:', {
      hasData: !!channelsResp?.data,
      hasChannels: !!channelsResp?.data?.channels,
      dataKeys: channelsResp?.data ? Object.keys(channelsResp.data) : []
    });
    
    const channels = channelsResp.data?.channels || [];
    console.log(`[Slack Integration] Found ${channels.length} channels:`, channels.map((ch: any) => ({ id: ch.id, name: ch.name, purpose: ch.purpose })));
    
    if (channels.length === 0) {
      console.warn('[Slack Integration] No channels found in response');
      console.log('[Slack Integration] Full channels response:', JSON.stringify(channelsResp, null, 2));
    }

    for (const channel of channels) {
      const channelId = channel.id;
      const channelName = channel.name || channelId;
      console.log(`[Slack Integration] Processing channel: ${channelName} (ID: ${channelId})`);
      
      const args: any = { channel: channelId };
      if (lastSyncAt) {
        args.oldest = (lastSyncAt.getTime() / 1000).toString();
        console.log(`[Slack Integration] Filtering messages from: ${args.oldest} (${lastSyncAt.toISOString()})`);
      }
      
      console.log(`[Slack Integration] Fetching conversation history for channel ${channelName} with args:`, args);
      
      const historyResp = await composioClient.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', {
        userId,
        connectedAccountId,
        arguments: args,
      });
      
      console.log(`[Slack Integration] History response for ${channelName}:`, {
        hasData: !!historyResp?.data,
        hasMessages: !!historyResp?.data?.messages,
        messageCount: historyResp?.data?.messages?.length || 0,
        dataKeys: historyResp?.data ? Object.keys(historyResp.data) : []
      });
      
      const messages = historyResp.data?.messages || [];
      console.log(`[Slack Integration] Found ${messages.length} messages in channel ${channelName}`);
      
      if (messages.length === 0) {
        console.log(`[Slack Integration] No messages found in channel ${channelName}`);
        console.log(`[Slack Integration] Full history response for ${channelName}:`, JSON.stringify(historyResp, null, 2));
      }
      
      for (const message of messages) {
        console.log(`[Slack Integration] Processing message in ${channelName}:`, {
          ts: message.ts,
          user: message.user || message.username,
          textPreview: message.text ? message.text.substring(0, 50) + '...' : 'no text'
        });
        
        const { content, lastModified } = formatMessage(channelName, message);
        
        if (lastSyncAt && lastModified <= lastSyncAt) {
          console.log(`[Slack Integration] Skipping message ${message.ts} - already synced`);
          continue;
        }
        
        const id = `${channelId}-${message.ts}`;
        const file: IntegrationFile = {
          id,
          name: `${channelName}-${message.ts}.md`,
          content,
          lastModified,
          type: 'text/markdown',
          size: content.length,
        };
        
        files.push(file);
        console.log(`[Slack Integration] Added file: ${file.name} (${file.size} bytes)`);
      }
    }
    
    console.log(`[Slack Integration] ===== SYNC COMPLETE =====`);
    console.log(`[Slack Integration] Total files fetched: ${files.length}`);
    console.log(`[Slack Integration] File details:`, files.map(f => ({ name: f.name, size: f.size, lastModified: f.lastModified.toISOString() })));
    
    return files;
  } catch (error) {
    console.error('[Slack Integration] Error fetching Slack files:', error);
    console.error('[Slack Integration] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return [];
  }
}

export const slackHandler: IntegrationHandler = {
  fetchFiles,
};

