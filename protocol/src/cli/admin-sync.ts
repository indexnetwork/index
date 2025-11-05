#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { Command } from 'commander';
import { syncIntegration } from '../lib/sync';
import { setLevel } from '../lib/log';
import db from '../lib/db';
import { userIntegrations } from '../lib/schema';
import { eq, and, isNull } from 'drizzle-orm';

type Opts = {
  user?: string;
  integration?: string;
  json?: boolean;
  silent?: boolean;
};

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('admin-sync')
    .description('Admin tool to trigger sync for any user integration')
    .option('-u, --user <userId>', 'User ID')
    .option('-i, --integration <integrationId>', 'Integration ID')
    .option('--json', 'Output machine-readable JSON')
    .option('--silent', 'Suppress non-error output')
    .action(async (opts: Opts) => {
      if (opts.json || opts.silent) setLevel('error');

      // Validate inputs
      if (!opts.integration) {
        const error = 'Integration ID is required (use -i or --integration)';
        if (opts.json) {
          console.log(JSON.stringify({ success: false, error }));
        } else {
          console.error(error);
        }
        process.exit(1);
      }

      if (!opts.silent) {
        console.log(`Triggering sync for integration: ${opts.integration}`);
        if (opts.user) {
          console.log(`  User ID: ${opts.user}`);
        }
      }

      // Optional: Verify the integration exists and belongs to the user
      if (opts.user) {
        const integration = await db.select()
          .from(userIntegrations)
          .where(and(
            eq(userIntegrations.id, opts.integration),
            eq(userIntegrations.userId, opts.user),
            isNull(userIntegrations.deletedAt)
          ))
          .limit(1);

        if (integration.length === 0) {
          const error = 'Integration not found for this user';
          if (opts.json) {
            console.log(JSON.stringify({ success: false, error }));
          } else {
            console.error(`✗ ${error}`);
          }
          process.exit(1);
        }

        if (!opts.silent) {
          console.log(`  Integration type: ${integration[0].integrationType}`);
          console.log(`  Status: ${integration[0].status}`);
        }
      }

      // Trigger the sync
      const result = await syncIntegration(opts.integration);

      if (opts.json) {
        console.log(JSON.stringify(result));
      } else if (!opts.silent) {
        if (result.success) {
          console.log('✓ Integration sync completed successfully');
          console.log(`  Files imported: ${result.filesImported}`);
          console.log(`  Intents generated: ${result.intentsGenerated}`);
          if (result.usersProcessed !== undefined) {
            console.log(`  Users processed: ${result.usersProcessed}`);
          }
          if (result.newUsersCreated !== undefined) {
            console.log(`  New users created: ${result.newUsersCreated}`);
          }
        } else {
          console.error(`✗ Integration sync failed: ${result.error}`);
          process.exit(1);
        }
      }
    });

  program.addHelpText(
    'after',
    '\nExamples:\n' +
    '  yarn admin-sync -i abc123\n' +
    '  yarn admin-sync -u user123 -i abc123\n' +
    '  yarn admin-sync -u user123 -i abc123 --json\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    const isJson = (() => {
      try { return program.getOptionValue('json') === true; } catch { return false; }
    })();
    
    if (isJson) {
      console.log(JSON.stringify({ success: false, error: msg, filesImported: 0, intentsGenerated: 0 }));
    } else {
      console.error('Error:', msg);
    }
    process.exit(1);
  }
}

main();

