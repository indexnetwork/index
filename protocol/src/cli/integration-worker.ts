#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { syncIntegration } from '../lib/sync';
import { log, setLevel } from '../lib/log';
import { INTEGRATIONS, type IntegrationName } from '../lib/integrations/config';
import db from '../lib/db';
import { userIntegrations } from '../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { getSlackLogger, resetSlackLogger } from '../lib/integrations/providers/slack-logger';

// Helper function to sleep
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Get all active integrations of a specific type
async function getActiveIntegrations(integrationType: string): Promise<string[]> {
  const integrations = await db.select({ id: userIntegrations.id })
    .from(userIntegrations)
    .where(and(
      eq(userIntegrations.integrationType, integrationType),
      eq(userIntegrations.status, 'connected'),
      isNull(userIntegrations.deletedAt)
    ));
  
  return integrations.map(i => i.id);
}

// Sync a single integration with error handling
async function syncSingleIntegration(integrationId: string, integrationType: string): Promise<void> {
  try {
    const result = await syncIntegration(integrationId);
    
    if (!result.success) {
      log.error(`Sync failed`, { integrationId, error: result.error });
    }
  } catch (error) {
    log.error(`Sync error`, {
      integrationId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

type Opts = {
  integrationType: string;
  silent?: boolean;
};

let isShuttingDown = false;

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('integration-worker')
    .description('Run a continuous integration sync worker for a specific integration type')
    .requiredOption('--integration-type <type>', 'Integration type to sync (slack, discord, notion, airtable, googledocs)')
    .option('--silent', 'Suppress non-error output')
    .action(async (opts: Opts) => {
      const integrationType = opts.integrationType as IntegrationName;
      
      // Validate integration type
      if (!INTEGRATIONS[integrationType]) {
        console.error(`Invalid integration type: ${integrationType}`);
        console.error(`Valid types: ${Object.keys(INTEGRATIONS).join(', ')}`);
        process.exit(1);
      }

      const config = INTEGRATIONS[integrationType];
      const syncDelayMs = config.syncDelayMs || 60000; // Default to 60 seconds

      if (opts.silent) setLevel('error');

      log.info(`Starting integration worker`, { 
        integrationType, 
        syncDelayMs,
        enabled: config.enabled 
      });

      if (!config.enabled) {
        log.warn(`Integration type ${integrationType} is disabled in config`);
      }

      // Handle graceful shutdown
      const shutdown = () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        log.info('Received shutdown signal, waiting for current syncs to complete...');
      };

      process.on('SIGTERM', shutdown);
      process.on('SIGINT', shutdown);

      const slackLogger = integrationType === 'slack' ? getSlackLogger() : null;

      if (integrationType === 'slack') {
        await runSlackIntegrationWorker(syncDelayMs, slackLogger, integrationType);
      } else {
        // Main worker loop for non-Slack integrations
        while (!isShuttingDown) {
          try {
            const integrationIds = await getActiveIntegrations(integrationType);
            
            if (integrationIds.length === 0) {
              log.debug(`No active ${integrationType} integrations, waiting...`);
              await sleep(syncDelayMs);
              continue;
            }

            log.info(`Syncing ${integrationIds.length} ${integrationType} integration(s)`);

            await Promise.all(
              integrationIds.map(id => syncSingleIntegration(id, integrationType))
            );

            if (!isShuttingDown) {
              log.info(`Cycle complete, next sync in ${syncDelayMs / 1000}s`);
              await sleep(syncDelayMs);
            }
          } catch (error) {
            log.error(`Worker error`, {
              integrationType,
              error: error instanceof Error ? error.message : String(error)
            });
            await sleep(syncDelayMs);
          }
        }
      }

      if (slackLogger) {
        slackLogger.stop();
        resetSlackLogger();
      }

      log.info('Integration worker shutting down gracefully');
      process.exit(0);
    });

  program.addHelpText(
    'after',
    '\nExamples:\n  yarn integration-worker --integration-type slack\n  yarn integration-worker --integration-type notion --silent\n'
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

type IntegrationLoopHandle = {
  stop: () => void;
  promise: Promise<void>;
};

async function runSlackIntegrationWorker(
  syncDelayMs: number,
  slackLogger: ReturnType<typeof getSlackLogger> | null,
  integrationType: IntegrationName
): Promise<void> {
  const loops = new Map<string, IntegrationLoopHandle>();
  const pollInterval = Math.min(syncDelayMs, 15000);

  while (!isShuttingDown) {
    const integrationIds = await getActiveIntegrations(integrationType);

    if (slackLogger) {
      slackLogger.setActiveIntegrationIds(integrationIds);
    }

    const idSet = new Set(integrationIds);

    for (const integrationId of integrationIds) {
      if (!loops.has(integrationId)) {
        loops.set(integrationId, createIntegrationLoop(integrationId));
      }
    }

    for (const [integrationId, handle] of loops.entries()) {
      if (!idSet.has(integrationId)) {
        handle.stop();
        loops.delete(integrationId);
        if (slackLogger) {
          slackLogger.removeIntegration(integrationId);
        }
      }
    }

    await sleep(pollInterval);
  }

  for (const handle of loops.values()) {
    handle.stop();
  }

  await Promise.all(Array.from(loops.values()).map(handle => handle.promise));

  function createIntegrationLoop(integrationId: string): IntegrationLoopHandle {
    let stopped = false;

    const promise = (async () => {
      while (!stopped && !isShuttingDown) {
        await syncSingleIntegration(integrationId, integrationType);
        if (slackLogger) {
          slackLogger.setIntegrationWait(integrationId, syncDelayMs / 1000);
        }
        if (stopped || isShuttingDown) break;

        if (slackLogger) {
          slackLogger.setNextSyncIn(syncDelayMs / 1000);
        }

        await sleep(syncDelayMs);
      }
    })().catch(error => {
      log.error('Integration loop error', {
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return {
      stop: () => {
        stopped = true;
      },
      promise
    };
  }
}

