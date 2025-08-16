import type { IntegrationHandler, IntegrationFile } from './index';

let composio: any;
export const __setComposio = (client: any) => {
  composio = client;
};
const initComposio = async () => {
  if (!composio) {
    const { Composio } = await import('@composio/core');
    composio = new Composio({
      apiKey: process.env.COMPOSIO_API_KEY,
    });
  }
  return composio;
};

function formatMessage(channelName: string, message: any): { content: string; lastModified: Date } {
  const ts = typeof message.ts === 'string' ? parseFloat(message.ts) * 1000 : Date.now();
  const lastModified = new Date(ts);
  const sender = message.user || message.username || 'unknown';
  const text = message.text || '';
  const markdown = `# ${channelName}\n\n**From:** ${sender}\n\n**Sent:** ${lastModified.toISOString()}\n\n${text}`;
  return { content: markdown, lastModified };
}

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    console.log(`[Integration Sync] Fetching Slack messages for user ${userId}. Last sync: ${lastSyncAt?.toISOString() ?? 'never'}`);
    const composioClient = await initComposio();

    const connectedAccounts = await composioClient.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['slack'],
    });
    if (!connectedAccounts || connectedAccounts.items.length === 0) {
      console.warn('No connected Slack accounts found for user');
      return [];
    }

    const connectedAccountId = connectedAccounts.items[0].id;
    const files: IntegrationFile[] = [];

    const channelsResp = await composioClient.tools.execute('SLACK_LIST_ALL_CHANNELS', {
      userId,
      connectedAccountId,
      arguments: {},
    });
    const channels = channelsResp.data?.response_data?.channels || [];

    for (const channel of channels) {
      const channelId = channel.id;
      const channelName = channel.name || channelId;
      const args: any = { channel: channelId };
      if (lastSyncAt) {
        args.oldest = (lastSyncAt.getTime() / 1000).toString();
      }
      const historyResp = await composioClient.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', {
        userId,
        connectedAccountId,
        arguments: args,
      });
      const messages = historyResp.data?.response_data?.messages || [];
      for (const message of messages) {
        const { content, lastModified } = formatMessage(channelName, message);
        if (lastSyncAt && lastModified <= lastSyncAt) continue;
        const id = `${channelId}-${message.ts}`;
        files.push({
          id,
          name: `${channelName}-${message.ts}.md`,
          content,
          lastModified,
          type: 'text/markdown',
          size: content.length,
        });
      }
    }
    console.log(`[Integration Sync] Total Slack files fetched: ${files.length}`);
    return files;
  } catch (error) {
    console.error('Error fetching Slack files:', error);
    return [];
  }
}

export const slackHandler: IntegrationHandler = {
  fetchFiles,
};

