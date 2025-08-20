import type { IntegrationHandler, IntegrationFile } from './index';
import { getClient } from './composio';
import { log } from '../log';
import { paginate, withRetry, concurrencyLimit, SlackChannelsResponse, SlackHistoryResponse, SlackMessage, mapSlackMessageToFile } from './util';

async function fetchFiles(userId: string, lastSyncAt?: Date): Promise<IntegrationFile[]> {
  try {
    log.info('Slack sync start', { userId, lastSyncAt: lastSyncAt?.toISOString() });
    const composio = await getClient();

    const connectedAccounts = await withRetry(() => composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: ['slack'],
    }));

    const account = connectedAccounts?.items?.[0];
    if (!account) {
      // No connected accounts; nothing to do
      return [];
    }
    const connectedAccountId = account.id;

    // Fetch channels with pagination
    const channels: Array<{ id: string; name?: string }> = [];
    const chanLimit = 200;
    for await (const page of paginate(
      (args) => composio.tools.execute('SLACK_LIST_ALL_CHANNELS', { userId, connectedAccountId, arguments: args }),
      { limit: chanLimit } as any,
      (resp) => SlackChannelsResponse.safeParse(resp).success ? (resp as any).data?.response_metadata?.next_cursor : undefined,
      (args, cursor) => ({ ...(args as any), cursor }) as any,
      { retries: 3 }
    )) {
      const parsed = SlackChannelsResponse.safeParse(page);
      if (!parsed.success) continue;
      for (const ch of parsed.data.data.channels) {
        if (ch && ch.id && !channels.find((c) => c.id === ch.id)) channels.push(ch);
      }
    }

    log.info('Slack channels', { count: channels.length });
    if (!channels.length) return [];

    const limit = concurrencyLimit(6);
    const files: IntegrationFile[] = [];
    let messagesTotal = 0;
    const tasks = channels.map((ch) => limit(async () => {
      const channelId = ch.id;
      const channelName = ch.name || ch.id;
      const args: any = { channel: channelId };
      if (lastSyncAt) args.oldest = (lastSyncAt.getTime() / 1000).toString();

      const history = await withRetry(
        () => composio.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', { userId, connectedAccountId, arguments: args }),
        { retries: 3 }
      );
      const parsed = SlackHistoryResponse.safeParse(history);
      if (!parsed.success) return;
      const messages = parsed.data.data?.messages || [];
      messagesTotal += messages.length;
      for (const msg of messages) {
        const msgParsed = SlackMessage.safeParse(msg);
        if (!msgParsed.success) continue;
        const file = mapSlackMessageToFile(channelId, channelName, msgParsed.data);
        if (!lastSyncAt || file.lastModified > lastSyncAt) files.push(file);
      }
    }));

    await Promise.all(tasks);
    log.info('Slack messages', { total: messagesTotal });
    log.info('Slack sync done', { userId, files: files.length });
    return files;
  } catch (error) {
    log.error('Slack sync error', { userId, error: (error as Error).message });
    return [];
  }
}

export const slackHandler: IntegrationHandler = { fetchFiles };
