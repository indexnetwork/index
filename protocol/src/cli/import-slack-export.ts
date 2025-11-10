#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import * as fs from 'fs';
import { processObjects } from '../lib/integrations/index';
import { slackHandler } from '../lib/integrations/providers/slack';
import type { SlackMessage } from '../lib/integrations/providers/slack';
import { log, setLevel } from '../lib/log';
import { getIntegrationById } from '../lib/integrations/integration-utils';

type Opts = {
  integrationId?: string;
  userId?: string;
  indexId?: string;
  enableUserAttribution?: boolean;
  batchSize?: string;
  json?: boolean;
  silent?: boolean;
};

interface ExportedSlackMessage {
  ts: string;
  text: string;
  user: string;
  type?: string;
  subtype?: string;
  bot_id?: string;
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
  messages: ExportedSlackMessage[];
  users: {
    [userId: string]: {
      id: string;
      name?: string;
      real_name?: string;
      profile?: {
        real_name?: string;
        display_name?: string;
        email?: string;
        image_original?: string;
      };
    };
  };
}

function transformMessage(msg: ExportedSlackMessage, users: ExportData['users']): SlackMessage | null {
  // Skip bots and system messages
  if (msg.bot_id || msg.subtype) {
    return null;
  }

  if (!msg.ts || !msg.user || !msg.text) {
    return null;
  }

  const user = users[msg.user];
  if (!user?.profile?.email) {
    log.debug('Skipping message without user email', { userId: msg.user });
    return null;
  }

  // Convert timestamp string back to Date
  const messageDate = new Date(msg.timestamp);

  const slackMessage: SlackMessage = {
    ts: msg.ts,
    text: msg.text,
    user: msg.user,
    username: msg.user_name || user.name,
    real_name: msg.user_real_name || user.real_name,
    display_name: user.profile.display_name,
    channel_id: msg.channel_id,
    channel_name: msg.channel_name,
    user_profile: {
      email: user.profile.email,
      name: user.real_name || user.profile.real_name || user.profile.display_name || msg.user,
      avatar: user.profile.image_original
    },
    metadata: {
      createdAt: messageDate
    }
  };

  return slackMessage;
}

async function importSlackExport(
  filePath: string,
  opts: Required<Omit<Opts, 'json' | 'silent' | 'batchSize'>> & { batchSize: number }
): Promise<{
  success: boolean;
  totalMessages: number;
  processedMessages: number;
  skippedMessages: number;
  intentsGenerated: number;
  usersProcessed: number;
  newUsersCreated: number;
  error?: string;
}> {
  try {
    // Load export file
    log.info('Loading export file', { file: filePath });
    
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const exportData = JSON.parse(fileContent) as ExportData;
    
    log.info('Export loaded', {
      channel: exportData.channel_name,
      messageCount: exportData.message_count,
      userCount: Object.keys(exportData.users).length
    });

    // Get integration to validate
    const integration = await getIntegrationById(opts.integrationId);
    if (!integration) {
      throw new Error(`Integration not found: ${opts.integrationId}`);
    }

    log.info('Starting import', {
      integrationId: opts.integrationId,
      userId: opts.userId,
      indexId: opts.indexId || 'null',
      enableUserAttribution: opts.enableUserAttribution,
      batchSize: opts.batchSize
    });

    const messages = exportData.messages;
    const batches = Math.ceil(messages.length / opts.batchSize);
    
    let totalIntents = 0;
    let totalUsersProcessed = 0;
    let totalNewUsers = 0;
    let processedMessages = 0;
    let skippedMessages = 0;

    for (let i = 0; i < batches; i++) {
      const start = i * opts.batchSize;
      const end = Math.min(start + opts.batchSize, messages.length);
      const batch = messages.slice(start, end);

      log.info(`Processing batch ${i + 1}/${batches}`, { 
        batchSize: batch.length,
        progress: `${end}/${messages.length}` 
      });

      // Transform messages
      const transformedMessages: SlackMessage[] = [];
      for (const msg of batch) {
        const transformed = transformMessage(msg, exportData.users);
        if (transformed) {
          transformedMessages.push(transformed);
        } else {
          skippedMessages++;
        }
      }

      if (transformedMessages.length === 0) {
        log.info('No valid messages in batch, skipping');
        continue;
      }

      // Process each message individually to preserve timestamps
      for (const message of transformedMessages) {
        try {
          const result = await processObjects([message], {
            id: opts.integrationId,
            indexId: opts.indexId || undefined,
            userId: opts.userId,
            enableUserAttribution: opts.enableUserAttribution || undefined
          }, slackHandler);

          totalIntents += result.intentsGenerated;
          totalUsersProcessed += result.usersProcessed;
          totalNewUsers += result.newUsersCreated;
          processedMessages++;

          if (processedMessages % 10 === 0) {
            log.info('Progress', {
              processed: processedMessages,
              total: messages.length,
              intents: totalIntents,
              users: totalUsersProcessed
            });
          }
        } catch (error) {
          log.error('Failed to process message', { 
            error: (error as Error).message,
            ts: message.ts,
            channel: message.channel_name
          });
        }
      }

      // Small delay between batches to avoid overwhelming the system
      if (i < batches - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    log.info('Import complete', {
      totalMessages: messages.length,
      processedMessages,
      skippedMessages,
      intentsGenerated: totalIntents,
      usersProcessed: totalUsersProcessed,
      newUsersCreated: totalNewUsers
    });

    return {
      success: true,
      totalMessages: messages.length,
      processedMessages,
      skippedMessages,
      intentsGenerated: totalIntents,
      usersProcessed: totalUsersProcessed,
      newUsersCreated: totalNewUsers
    };
  } catch (error) {
    log.error('Import failed', { error: (error as Error).message });
    return {
      success: false,
      totalMessages: 0,
      processedMessages: 0,
      skippedMessages: 0,
      intentsGenerated: 0,
      usersProcessed: 0,
      newUsersCreated: 0,
      error: (error as Error).message
    };
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('import-slack-export')
    .description('Import Slack messages from an exported JSON file')
    .argument('<file>', 'Path to the exported Slack JSON file')
    .option('--integration-id <id>', 'Integration ID (or set INTEGRATION_ID env var)')
    .option('--user-id <id>', 'User ID (or set USER_ID env var)')
    .option('--index-id <id>', 'Index ID (or set INDEX_ID env var)')
    .option('--enable-user-attribution', 'Enable user attribution (or set ENABLE_USER_ATTRIBUTION=true)')
    .option('--batch-size <size>', 'Number of messages to process per batch', '50')
    .option('--json', 'Output machine-readable JSON')
    .option('--silent', 'Suppress non-error output')
    .action(async (file: string, opts: Opts) => {
      if (opts.json || opts.silent) setLevel('error');

      // Get values from options or environment variables
      const integrationId = opts.integrationId || process.env.INTEGRATION_ID;
      const userId = opts.userId || process.env.USER_ID;
      const indexId = opts.indexId || process.env.INDEX_ID;
      const enableUserAttribution = opts.enableUserAttribution || process.env.ENABLE_USER_ATTRIBUTION === 'true';
      const batchSize = parseInt(opts.batchSize || '50', 10);

      if (!integrationId) {
        throw new Error('Integration ID is required (use --integration-id or set INTEGRATION_ID env var)');
      }
      if (!userId) {
        throw new Error('User ID is required (use --user-id or set USER_ID env var)');
      }

      // Resolve file path
      const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);

      if (!opts.silent) {
        console.log(`Importing Slack export from: ${filePath}`);
        console.log(`Integration ID: ${integrationId}`);
        console.log(`User ID: ${userId}`);
        if (indexId) console.log(`Index ID: ${indexId}`);
        console.log(`User Attribution: ${enableUserAttribution ? 'enabled' : 'disabled'}`);
        console.log(`Batch Size: ${batchSize}`);
        console.log('');
      }

      const result = await importSlackExport(filePath, {
        integrationId,
        userId,
        indexId: indexId || null,
        enableUserAttribution,
        batchSize
      });

      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (!opts.silent) {
        if (result.success) {
          console.log('\n✓ Import completed successfully');
          console.log(`  Total messages: ${result.totalMessages}`);
          console.log(`  Processed: ${result.processedMessages}`);
          console.log(`  Skipped: ${result.skippedMessages}`);
          console.log(`  Intents generated: ${result.intentsGenerated}`);
          console.log(`  Users processed: ${result.usersProcessed}`);
          console.log(`  New users created: ${result.newUsersCreated}`);
        } else {
          console.error(`\n✗ Import failed: ${result.error}`);
          process.exit(1);
        }
      }
    });

  program.addHelpText(
    'after',
    `
Examples:
  # Using command-line options
  yarn import-slack-export ../scripts/exported.json --integration-id abc123 --user-id xyz789

  # Using environment variables
  export INTEGRATION_ID=abc123
  export USER_ID=xyz789
  yarn import-slack-export ../scripts/exported.json

  # With all options
  yarn import-slack-export ./data.json \\
    --integration-id abc123 \\
    --user-id xyz789 \\
    --index-id def456 \\
    --enable-user-attribution \\
    --batch-size 100

  # JSON output
  yarn import-slack-export ./data.json --json
`
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    const isJson = (() => {
      try { return program.getOptionValue('json') === true; } catch { return false; }
    })();
    
    if (isJson) {
      console.log(JSON.stringify({ 
        success: false, 
        error: msg,
        totalMessages: 0,
        processedMessages: 0,
        skippedMessages: 0,
        intentsGenerated: 0,
        usersProcessed: 0,
        newUsersCreated: 0
      }));
    } else {
      console.error('Error:', msg);
    }
    process.exit(1);
  }
}

main();


