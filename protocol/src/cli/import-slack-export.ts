#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import * as fs from 'fs';
import type { SlackMessage } from '../lib/integrations/providers/slack';
import { log, setLevel } from '../lib/log';
import { getIntegrationById } from '../lib/integrations/integration-utils';
import { analyzeObjects } from '../agents/core/intent_inferrer';
import { IntentService } from '../lib/intent-service';
import { resolveIntegrationUser } from '../lib/user-utils';
import { ensureIndexMembership } from '../lib/integrations/membership-utils';

interface ExportData {
  messages: Array<{
    ts: string;
    text: string;
    user: string;
    bot_id?: string;
    subtype?: string;
    channel_id: string;
    channel_name: string;
    timestamp: string;
  }>;
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

function transformMessage(msg: any, users: any): SlackMessage | null {
  if (msg.bot_id || msg.subtype || !msg.ts || !msg.user || !msg.text) return null;
  const user = users[msg.user];
  if (!user?.profile?.email) return null;

  return {
    ts: msg.ts,
    text: msg.text,
    user: msg.user,
    username: user.name,
    real_name: user.real_name,
    display_name: user.profile.display_name,
    channel_id: msg.channel_id,
    channel_name: msg.channel_name,
    user_profile: {
      email: user.profile.email,
      name: user.real_name || user.profile.real_name || user.profile.display_name || msg.user,
      avatar: user.profile.image_original
    },
    metadata: { createdAt: new Date(msg.timestamp) }
  };
}

class UserCache {
  private cache = new Map();
  private newUsersCount = 0;

  async resolve(userIdentifier: any, indexId: string) {
    if (this.cache.has(userIdentifier.providerId)) {
      return this.cache.get(userIdentifier.providerId);
    }

    const user = await resolveIntegrationUser({
      email: userIdentifier.email,
      providerId: userIdentifier.providerId,
      name: userIdentifier.name,
      provider: userIdentifier.provider,
      avatar: userIdentifier.avatar,
      updateEmptyFields: true
    });

    if (user) {
      await ensureIndexMembership(user.id, indexId);
      if (user.isNewUser) this.newUsersCount++;
      this.cache.set(userIdentifier.providerId, user);
    }
    return user;
  }

  get stats() {
    return { newUsers: this.newUsersCount, totalUsers: this.cache.size };
  }
}

async function processMessage(message: SlackMessage, integrationId: string, indexId: string, userCache: UserCache) {
  if (!message.user_profile) return 0;
  
  const userIdentifier = {
    email: message.user_profile.email,
    name: message.user_profile.name,
    providerId: message.user,
    provider: 'slack' as const,
    avatar: message.user_profile.avatar
  };

  const user = await userCache.resolve(userIdentifier, indexId);
  if (!user) return 0;

  const existingIntents = await IntentService.getUserIntents(user.id);
  const result = await analyzeObjects([message], 'Generate intents based on integration data', Array.from(existingIntents), undefined, 60000);

  let count = 0;
  if (result?.success && result.intents) {
    for (const intent of result.intents) {
      if (!existingIntents.has(intent.payload)) {
        await IntentService.createIntent({
          payload: intent.payload,
          userId: user.id,
          sourceId: integrationId,
          sourceType: 'integration',
          indexIds: [indexId],
          confidence: intent.confidence,
          inferenceType: intent.type,
          createdAt: message.metadata?.createdAt,
          updatedAt: message.metadata?.createdAt
        });
        count++;
      }
    }
  }
  return count;
}

async function importSlackExport(filePath: string, integrationId: string, indexId: string, batchSize: number) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  
  const exportData = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as ExportData;
  const integration = await getIntegrationById(integrationId);
  if (!integration) throw new Error(`Integration not found: ${integrationId}`);

  const messages = exportData.messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const userCache = new UserCache();
  
  let totalIntents = 0;
  let processed = 0;

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    
    const results = await Promise.all(
      batch.map(async (msg) => {
        const message = transformMessage(msg, exportData.users);
        if (!message) return 0;
        try {
          return await processMessage(message, integrationId, indexId, userCache);
        } catch (error) {
          log.error('Failed to process message', { error: (error as Error).message, ts: msg.ts });
          return 0;
        }
      })
    );

    totalIntents += results.reduce((sum, count) => sum + count, 0);
    processed += batch.length;
    log.info('Progress', { processed, total: messages.length, intents: totalIntents, users: userCache.stats.totalUsers });
  }

  return { processed, intents: totalIntents, ...userCache.stats };
}

async function main() {
  const program = new Command();

  program
    .name('import-slack-export')
    .argument('<file>', 'Path to exported Slack JSON file')
    .option('--integration-id <id>', 'Integration ID')
    .option('--index-id <id>', 'Index ID')
    .option('--batch <size>', 'Batch size for parallel processing', '10')
    .option('--json', 'JSON output')
    .option('--silent', 'Suppress output')
    .action(async (file: string, opts: any) => {
      if (opts.json || opts.silent) setLevel('error');

      const integrationId = opts.integrationId || process.env.INTEGRATION_ID;
      const indexId = opts.indexId || process.env.INDEX_ID;
      const batchSize = parseInt(opts.batch || '10', 10);
      const filePath = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);

      if (!integrationId) throw new Error('Integration ID required');
      if (!indexId) throw new Error('Index ID required');

      const result = await importSlackExport(filePath, integrationId, indexId, batchSize);

      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (!opts.silent) {
        console.log(`✓ Processed: ${result.processed}`);
        console.log(`  Intents: ${result.intents}`);
        console.log(`  Users: ${result.totalUsers} (${result.newUsers} new)`);
      }
    });

  await program.parseAsync(process.argv);
}

main();
