#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { log, setLevel } from '../lib/log';
import { syncAllTwitterUsers, syncAllLinkedInUsers, syncAllSocialMedia } from '../lib/integrations/social-sync';
import { syncTwitterUser } from '../lib/integrations/providers/twitter';
import { syncLinkedInUser } from '../lib/integrations/providers/linkedin';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Opts = {
  type?: string;
  silent?: boolean;
  userId?: string;
};

let isShuttingDown = false;

const TWITTER_SYNC_DELAY_MS = parseInt(process.env.TWITTER_SYNC_DELAY_MS || '3600000'); // 1 hour default
const LINKEDIN_SYNC_DELAY_MS = parseInt(process.env.LINKEDIN_SYNC_DELAY_MS || '3600000'); // 1 hour default

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('social-worker')
    .description('Run a continuous social media sync worker for Twitter and LinkedIn')
    .option('--type <type>', 'Sync type: twitter, linkedin, or all (default: all)')
    .option('--userId <userId>', 'Sync specific user ID (if provided, runs once and exits)')
    .option('--silent', 'Suppress non-error output')
    .action(async (opts: Opts) => {
      const syncType = opts.type || 'all';

      if (opts.silent) setLevel('error');

      log.info('Starting social worker', { syncType, userId: opts.userId });

      // Handle graceful shutdown
      const shutdown = () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        log.info('Received shutdown signal, waiting for current syncs to complete...');
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      // If userId is provided, sync once and exit
      if (opts.userId) {
        if (syncType === 'twitter') {
          await syncSingleTwitterUser(opts.userId);
        } else if (syncType === 'linkedin') {
          await syncSingleLinkedInUser(opts.userId);
        } else {
          await syncSingleUserAll(opts.userId);
        }
        log.info('Single user sync complete');
        process.exit(0);
        return;
      }

      // Otherwise, run continuous workers
      if (syncType === 'twitter') {
        await runTwitterWorker();
      } else if (syncType === 'linkedin') {
        await runLinkedInWorker();
      } else {
        await runAllSocialWorkers();
      }

      log.info('Social worker shutting down gracefully');
      process.exit(0);
    });

  program.addHelpText(
    'after',
    '\nExamples:\n  yarn social-worker --type twitter\n  yarn social-worker --type linkedin\n  yarn social-worker --type all --silent\n  yarn social-worker --type twitter --userId abc123\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('Error:', msg);
    process.exit(1);
  }
}

async function syncSingleTwitterUser(userId: string): Promise<void> {
  try {
    log.info('Syncing single Twitter user', { userId });
    const result = await syncTwitterUser(userId);
    if (result.success) {
      log.info('Twitter sync successful', { userId, intentsGenerated: result.intentsGenerated, locationUpdated: result.locationUpdated });
    } else {
      log.error('Twitter sync failed', { userId, error: result.error });
      process.exit(1);
    }
  } catch (error) {
    log.error('Twitter sync error', { userId, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function syncSingleLinkedInUser(userId: string): Promise<void> {
  try {
    log.info('Syncing single LinkedIn user', { userId });
    const result = await syncLinkedInUser(userId);
    if (result.success) {
      log.info('LinkedIn sync successful', { userId, intentsGenerated: result.intentsGenerated, locationUpdated: result.locationUpdated });
    } else {
      log.error('LinkedIn sync failed', { userId, error: result.error });
      process.exit(1);
    }
  } catch (error) {
    log.error('LinkedIn sync error', { userId, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function syncSingleUserAll(userId: string): Promise<void> {
  try {
    log.info('Syncing all social media for single user', { userId });
    const [twitterResult, linkedinResult] = await Promise.all([
      syncTwitterUser(userId).catch(err => ({ success: false, error: err instanceof Error ? err.message : String(err) })),
      syncLinkedInUser(userId).catch(err => ({ success: false, error: err instanceof Error ? err.message : String(err) })),
    ]);
    
    log.info('Social sync complete', {
      userId,
      twitter: twitterResult.success ? 'success' : `failed: ${twitterResult.error}`,
      linkedin: linkedinResult.success ? 'success' : `failed: ${linkedinResult.error}`,
    });
  } catch (error) {
    log.error('Social sync error', { userId, error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

async function runTwitterWorker(): Promise<void> {
  while (!isShuttingDown) {
    try {
      log.info('Starting Twitter sync cycle');
      await syncAllTwitterUsers();
      
      if (!isShuttingDown) {
        log.info(`Twitter cycle complete, next sync in ${TWITTER_SYNC_DELAY_MS / 1000 / 60} minutes`);
        await sleep(TWITTER_SYNC_DELAY_MS);
      }
    } catch (error) {
      log.error('Twitter worker error', {
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(TWITTER_SYNC_DELAY_MS);
    }
  }
}

async function runLinkedInWorker(): Promise<void> {
  while (!isShuttingDown) {
    try {
      log.info('Starting LinkedIn sync cycle');
      await syncAllLinkedInUsers();
      
      if (!isShuttingDown) {
        log.info(`LinkedIn cycle complete, next sync in ${LINKEDIN_SYNC_DELAY_MS / 1000 / 60} minutes`);
        await sleep(LINKEDIN_SYNC_DELAY_MS);
      }
    } catch (error) {
      log.error('LinkedIn worker error', {
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(LINKEDIN_SYNC_DELAY_MS);
    }
  }
}

async function runAllSocialWorkers(): Promise<void> {
  while (!isShuttingDown) {
    try {
      log.info('Starting full social media sync cycle');
      await syncAllSocialMedia();
      
      if (!isShuttingDown) {
        // Use the longer delay for full sync
        const delayMs = Math.max(TWITTER_SYNC_DELAY_MS, LINKEDIN_SYNC_DELAY_MS);
        log.info(`Full social sync cycle complete, next sync in ${delayMs / 1000 / 60} minutes`);
        await sleep(delayMs);
      }
    } catch (error) {
      log.error('Social worker error', {
        error: error instanceof Error ? error.message : String(error)
      });
      const delayMs = Math.max(TWITTER_SYNC_DELAY_MS, LINKEDIN_SYNC_DELAY_MS);
      await sleep(delayMs);
    }
  }
}

main();

