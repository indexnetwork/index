#!/usr/bin/env node
import 'dotenv/config';
import { Command, Option } from 'commander';
import { runSync } from '../lib/sync/runner';
import type { SyncProviderName } from '../lib/sync/providers';
import { setLevel } from '../lib/log';

const PROVIDERS: ReadonlyArray<SyncProviderName> = [
  'links',
  'gmail',
  'notion',
  'slack',
  'discord',
  'calendar',
] as const;

type GlobalOpts = {
  user?: string;
  index?: string;
  json?: boolean;
  silent?: boolean;
};

type LinkOpts = {
  all?: boolean;
  link?: string;
  count?: number;
  skipBrokers?: boolean;
} & GlobalOpts;

type IntegrationOpts = GlobalOpts;

function resolveUserId(opts: GlobalOpts): string {
  const userId = opts.user || process.env.SYNC_USER_ID;
  if (!userId) throw new Error('Missing user id. Provide --user or set SYNC_USER_ID env.');
  return userId;
}

function printResult(result: any, opts: GlobalOpts) {
  if (opts.json) {
    console.log(JSON.stringify({ ok: true, stats: result.stats }));
    return;
  }
  if (!opts.silent) {
    const { stats } = result;
    const pairs = Object.entries(stats || {});
    if (pairs.length === 0) {
      console.log('Done. No stats returned.');
    } else {
      console.log('Done. Stats:');
      for (const [k, v] of pairs) console.log(`- ${k}: ${v}`);
    }
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('sync-all')
    .description('Run a sync provider to generate intents')
    .option('-u, --user <id>', 'User ID (or set SYNC_USER_ID env)')
    .option('-i, --index <id>', 'Index ID to attach intents to')
    .option('--json', 'Output machine-readable JSON (no extra text)')
    .option('--silent', 'Suppress non-error output');

  // links
  program
    .command('links')
    .description('Sync web links into intents (new links by default)')
    .addOption(new Option('--all', 'Process all saved links, even if already synced').conflicts('link'))
    .addOption(new Option('--link <id>', 'Process a single link by id').conflicts('all'))
    .option(
      '--count <n>',
      'Max intents per page (default 1)',
      (v) => {
        const n = Number.parseInt(`${v}`, 10);
        return Number.isFinite(n) && n > 0 ? n : 1;
      },
      1
    )
    .option('--skip-brokers', 'Do not trigger brokers on intent creation')
    .action(async (subOpts: LinkOpts, cmd: Command) => {
      const root = (cmd.parent as Command).opts() as GlobalOpts;
      const merged: LinkOpts = { ...root, ...subOpts };
      const userId = resolveUserId(merged);
      if (merged.json || merged.silent) setLevel('error');
      const params: Record<string, any> = {
        indexId: merged.index,
        all: merged.all === true,
        linkId: merged.link,
        count: merged.count,
        skipBrokers: merged.skipBrokers === true,
      };
      const result = await runSync('links', userId, params);
      printResult(result, merged);
    });

  // integration helpers
  for (const p of ['gmail', 'notion', 'slack', 'discord', 'calendar'] as const) {
    program
      .command(p)
      .description(`Sync from ${p} integration`)
      .action(async (subOpts: IntegrationOpts, cmd: Command) => {
        const root = (cmd.parent as Command).opts() as GlobalOpts;
        const merged: IntegrationOpts = { ...root, ...subOpts };
        const userId = resolveUserId(merged);
        if (merged.json || merged.silent) setLevel('error');
        const params: Record<string, any> = { indexId: merged.index };
        const result = await runSync(p, userId, params);
        printResult(result, merged);
      });
  }

  program
    .addHelpText(
      'after',
      `\nProviders:\n  ${PROVIDERS.join(' | ')}\n\nExamples:\n  SYNC_USER_ID=123 yarn sync-all links --index 111\n  yarn sync-all notion --index 111 --user 123\n  yarn sync-all links --all --json --user 123\n`
    );

  try {
    await program.parseAsync(process.argv);

    const isJsonMode = program.getOptionValue('json') === true;
    if (!isJsonMode) program.showHelpAfterError();

    // If no subcommand was provided, show help and exit.
    if (!(program.args && program.args.length)) {
      if (isJsonMode) {
        console.log(JSON.stringify({ ok: false, error: 'No subcommand provided' }));
        process.exit(1);
      } else {
        program.help({ error: true });
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    const isJson = (() => {
      try { return program.getOptionValue('json') === true; } catch { return false; }
    })();
    if (isJson) {
      try {
        console.log(JSON.stringify({ ok: false, error: msg }));
      } catch {
        console.error('sync-all error:', msg);
      }
    } else {
      console.error('sync-all error:', msg);
    }
    process.exit(1);
  }
}

main();
