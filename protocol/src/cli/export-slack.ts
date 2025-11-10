#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import * as fs from 'fs';
import { getClient } from '../lib/integrations/composio';

type ComposioClient = any;

interface SlackChannel {
  id: string;
  name?: string;
  is_member?: boolean;
  num_members?: number;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
  profile?: {
    real_name?: string;
    display_name?: string;
    email?: string;
    image_original?: string;
  };
}

interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  type?: string;
  subtype?: string;
  bot_id?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{
    name: string;
    count: number;
    users: string[];
  }>;
  files?: Array<{
    id: string;
    name: string;
    title: string;
    mimetype: string;
    filetype: string;
    url_private: string;
  }>;
}

interface ExportedMessage extends SlackMessage {
  channel_id: string;
  channel_name: string;
  user_name?: string;
  user_real_name?: string;
  user_email?: string;
  timestamp: string;
  date: string;
}

interface ExportData {
  export_date: string;
  channel_id: string;
  channel_name: string;
  message_count: number;
  messages: ExportedMessage[];
  users: {
    [userId: string]: SlackUser;
  };
}

type Opts = {
  userId?: string;
  connectedAccountId?: string;
  channels?: string;
  outputDir?: string;
  startDate?: string;
  batchSize?: string;
  silent?: boolean;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRateLimitError = (error: any): boolean => {
  const errorMsg = error?.message?.toLowerCase() || '';
  const errorCode = error?.code || error?.status;
  return errorCode === 429 || 
         errorMsg.includes('rate_limited') || 
         errorMsg.includes('rate limit') ||
         errorMsg.includes('too many requests');
};

const getRetryAfterDelay = (error: any): number => {
  const retryAfter = 
    error?.response?.headers?.['retry-after'] ||
    error?.response?.headers?.['Retry-After'] ||
    error?.headers?.['retry-after'] ||
    error?.headers?.['Retry-After'];
  
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds)) {
      console.log(`[INFO] Slack provided Retry-After: ${seconds} seconds`);
      return seconds * 1000;
    }
  }
  
  return CONFIG.RATE_LIMIT_RETRY_MS;
};

const formatTimestamp = (ts: string): { timestamp: string; date: string } => {
  const date = new Date(parseFloat(ts) * 1000);
  return {
    timestamp: date.toISOString(),
    date: date.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  };
};

class SlackExporter {
  private composio: ComposioClient | null = null;
  private userId: string;
  private connectedAccountId: string;
  private outputDir: string;
  private channelFilter: string[];
  private startDate: Date | null;
  private messageLimit: number;
  private messageHistoryDelayMs: number;
  private rateLimitRetryMs: number;
  private maxRetries: number;
  private channelLimit: number;
  private userLimit: number;
  private users: { [userId: string]: SlackUser } = {};

  constructor(opts: {
    userId: string;
    connectedAccountId: string;
    outputDir: string;
    channelFilter: string[];
    startDate: Date | null;
    messageLimit: number;
  }) {
    this.userId = opts.userId;
    this.connectedAccountId = opts.connectedAccountId;
    this.outputDir = opts.outputDir;
    this.channelFilter = opts.channelFilter;
    this.startDate = opts.startDate;
    this.messageLimit = opts.messageLimit;
    this.messageHistoryDelayMs = 60000;
    this.rateLimitRetryMs = 60000;
    this.maxRetries = 3;
    this.channelLimit = 200;
    this.userLimit = 200;
  }

  async initialize(): Promise<void> {
    this.composio = await getClient();
  }

  async fetchChannels(): Promise<SlackChannel[]> {
    if (!this.composio) throw new Error('Client not initialized');
    
    console.log('[INFO] Fetching Slack channels...');
    const channels: SlackChannel[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.composio.tools.execute('SLACK_LIST_ALL_CHANNELS', {
        userId: this.userId,
        connectedAccountId: this.connectedAccountId,
        arguments: {
          limit: this.channelLimit,
          ...(cursor && { cursor })
        }
      });

      const channelList = (response as any)?.data?.channels || [];
      channels.push(...channelList);
      cursor = (response as any)?.data?.response_metadata?.next_cursor;
      
      console.log(`[INFO] Fetched ${channelList.length} channels (total: ${channels.length})`);
    } while (cursor);

    const filtered = this.channelFilter.length > 0
      ? channels.filter(ch => ch.name && this.channelFilter.includes(ch.name))
      : channels;

    console.log(`[INFO] Total channels to export: ${filtered.length}`);
    return filtered;
  }

  async fetchUsers(): Promise<void> {
    if (!this.composio) throw new Error('Client not initialized');
    
    console.log('[INFO] Fetching Slack users...');
    let cursor: string | undefined;
    let totalUsers = 0;

    do {
      const response = await this.composio.tools.execute('SLACK_LIST_ALL_USERS', {
        userId: this.userId,
        connectedAccountId: this.connectedAccountId,
        arguments: {
          limit: this.userLimit,
          include_locale: true,
          ...(cursor && { cursor })
        }
      });

      const members = (response as any)?.data?.members || [];
      for (const user of members) {
        if (user?.id) {
          this.users[user.id] = user;
          totalUsers++;
        }
      }

      cursor = (response as any)?.data?.response_metadata?.next_cursor;
      console.log(`[INFO] Fetched users (total: ${totalUsers})`);
    } while (cursor);

    console.log(`[INFO] Total users fetched: ${totalUsers}`);
  }

  async fetchMessagesForChannel(channel: SlackChannel): Promise<ExportedMessage[]> {
    if (!this.composio) throw new Error('Client not initialized');
    
    const channelId = channel.id;
    const channelName = channel.name || channelId;
    console.log(`[INFO] Fetching messages for channel: ${channelName}`);

    const messages: ExportedMessage[] = [];
    let cursor: string | undefined;
    let pageNum = 0;

    do {
      pageNum++;
      const args: any = {
        channel: channelId,
        limit: this.messageLimit,
        include_all_metadata: true,
        ...(cursor && { cursor })
      };

      if (this.startDate) {
        args.oldest = (this.startDate.getTime() / 1000).toString();
      }

      let retries = 0;
      let response: any = null;

      while (retries <= this.maxRetries) {
        try {
          response = await this.composio.tools.execute('SLACK_FETCH_CONVERSATION_HISTORY', {
            userId: this.userId,
            connectedAccountId: this.connectedAccountId,
            arguments: args
          });
          break;
        } catch (error) {
          if (isRateLimitError(error)) {
            retries++;
            if (retries <= this.maxRetries) {
              const retryDelay = getRetryAfterDelay(error);
              console.log(`[WARN] Rate limit hit, waiting ${retryDelay}ms (retry ${retries}/${this.maxRetries})`);
              await sleep(retryDelay);
              continue;
            } else {
              console.error(`[ERROR] Max retries exceeded for channel ${channelName}`);
              throw error;
            }
          } else {
            throw error;
          }
        }
      }

      if (!response) {
        console.error(`[ERROR] Failed to fetch messages for ${channelName} after retries`);
        break;
      }

      const pageMessages = (response as any)?.data?.messages || [];
      
      for (const msg of pageMessages) {
        // Skip bots and system messages
        if (msg.bot_id || (msg.subtype && msg.subtype !== 'thread_broadcast')) {
          continue;
        }

        if (!msg.ts || !msg.user) {
          continue;
        }

        const user = this.users[msg.user];
        const { timestamp, date } = formatTimestamp(msg.ts);

        const exportedMsg: ExportedMessage = {
          ...msg,
          channel_id: channelId,
          channel_name: channelName,
          user_name: user?.name,
          user_real_name: user?.real_name || user?.profile?.real_name,
          user_email: user?.profile?.email,
          timestamp,
          date
        };

        messages.push(exportedMsg);
      }

      cursor = (response as any)?.data?.response_metadata?.next_cursor;
      console.log(`[INFO] Page ${pageNum}: ${pageMessages.length} messages (total: ${messages.length})`);
      
      if (cursor) {
        await sleep(this.messageHistoryDelayMs);
      }
    } while (cursor);

    console.log(`[INFO] Channel ${channelName}: ${messages.length} messages exported`);
    return messages;
  }

  async export(): Promise<{ totalChannels: number; totalMessages: number }> {
    console.log('[INFO] Starting Slack export...');
    console.log(`[INFO] User ID: ${this.userId}`);
    console.log(`[INFO] Connected Account ID: ${this.connectedAccountId}`);

    await this.initialize();
    await this.fetchUsers();

    const channels = await this.fetchChannels();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    let totalMessages = 0;
    
    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const channelName = channel.name || channel.id;
      
      console.log(`[INFO] Processing channel ${i + 1}/${channels.length}: ${channelName}`);
      
      try {
        const messages = await this.fetchMessagesForChannel(channel);
        const sortedMessages = messages.sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        
        const channelData: ExportData = {
          export_date: new Date().toISOString(),
          channel_id: channel.id,
          channel_name: channelName,
          message_count: sortedMessages.length,
          messages: sortedMessages,
          users: this.users
        };
        
        const filename = `slack-export-${channelName}-${timestamp}.json`;
        this.saveChannelToFile(filename, channelData);
        
        totalMessages += messages.length;
      } catch (error) {
        console.error(`[ERROR] Failed to export channel ${channelName}:`, error);
      }
    }

    console.log('\n[SUCCESS] Export completed!');
    console.log(`[INFO] Total channels: ${channels.length}`);
    console.log(`[INFO] Total messages: ${totalMessages}`);

    return { totalChannels: channels.length, totalMessages };
  }

  saveChannelToFile(filename: string, channelData: ExportData): string {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const filepath = path.join(this.outputDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(channelData, null, 2));
    
    console.log(`[INFO] Saved to: ${filepath}`);
    return filepath;
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('export-slack')
    .description('Export Slack messages from channels to JSON files')
    .option('--user-id <id>', 'User ID (or set USER_ID env var)')
    .option('--connected-account-id <id>', 'Connected account ID (or set CONNECTED_ACCOUNT_ID env var)')
    .option('--channels <channels>', 'Comma-separated list of channel names (leave empty for all)')
    .option('--output-dir <dir>', 'Output directory', './slack-exports')
    .option('--start-date <date>', 'Start date (YYYY-MM-DD) for message history')
    .option('--batch-size <size>', 'Number of messages per API call', '15')
    .option('--silent', 'Suppress non-error output')
    .action(async (opts: Opts) => {
      const userId = opts.userId || process.env.USER_ID;
      const connectedAccountId = opts.connectedAccountId || process.env.CONNECTED_ACCOUNT_ID;
      const outputDir = opts.outputDir || './slack-exports';
      const channelFilter = opts.channels ? opts.channels.split(',').map(s => s.trim()) : [];
      const startDate = opts.startDate ? new Date(opts.startDate) : null;
      const messageLimit = parseInt(opts.batchSize || '15', 10);

      if (!userId) {
        throw new Error('User ID is required (use --user-id or set USER_ID env var)');
      }
      if (!connectedAccountId) {
        throw new Error('Connected account ID is required (use --connected-account-id or set CONNECTED_ACCOUNT_ID env var)');
      }

      if (!opts.silent) {
        console.log(`Exporting Slack messages`);
        console.log(`User ID: ${userId}`);
        console.log(`Connected Account ID: ${connectedAccountId}`);
        console.log(`Output Directory: ${outputDir}`);
        if (channelFilter.length > 0) console.log(`Channels: ${channelFilter.join(', ')}`);
        if (startDate) console.log(`Start Date: ${startDate.toISOString()}`);
        console.log(`Batch Size: ${messageLimit}`);
        console.log('');
      }

      const exporter = new SlackExporter({
        userId,
        connectedAccountId,
        outputDir,
        channelFilter,
        startDate,
        messageLimit
      });

      const result = await exporter.export();

      if (!opts.silent) {
        console.log('\n✓ Export completed');
        console.log(`  Total channels: ${result.totalChannels}`);
        console.log(`  Total messages: ${result.totalMessages}`);
        console.log(`  Output directory: ${outputDir}`);
      }
    });

  program.addHelpText(
    'after',
    `
Examples:
  # Export all channels
  yarn export-slack --user-id abc123 --connected-account-id xyz789

  # Export specific channels
  yarn export-slack --user-id abc123 --connected-account-id xyz789 --channels "general,random"

  # Export with date filter
  yarn export-slack --user-id abc123 --connected-account-id xyz789 --start-date 2024-01-01

  # Using environment variables
  export USER_ID=abc123
  export CONNECTED_ACCOUNT_ID=xyz789
  yarn export-slack
`
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('Error:', msg);
    process.exit(1);
  }
}

main();

