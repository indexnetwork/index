#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { syncIntegration } from '../lib/sync';
import { setLevel } from '../lib/log';

type Opts = {
  json?: boolean;
  silent?: boolean;
};

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('trigger-integration')
    .description('Manually trigger an integration sync by integration ID')
    .argument('<integrationId>', 'Integration ID to trigger')
    .option('--json', 'Output machine-readable JSON')
    .option('--silent', 'Suppress non-error output')
    .action(async (integrationId: string, opts: Opts) => {
      if (opts.json || opts.silent) setLevel('error');

      if (!opts.silent) {
        console.log(`Triggering integration: ${integrationId}`);
      }

      const result = await syncIntegration(integrationId);

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
    '\nExamples:\n  yarn trigger-integration abc123\n  yarn trigger-integration abc123 --json\n'
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

