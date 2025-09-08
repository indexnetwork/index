#!/usr/bin/env node
/**
 * sync-all.ts — Unified Sync CLI
 *
 * Purpose
 * - Trigger the same sync providers used by the HTTP API (links/gmail/notion/...)
 * - Suitable for Kubernetes CronJobs and local/manual runs
 *
 * Behavior
 * - Runs provider synchronously and exits 0 on success / 1 on failure
 *
 * Examples
 *   yarn sync-all links --index 00000000-0000-0000-0000-000000000000 --user <USER_ID>
 *   yarn sync-all notion --index <INDEX_ID> --user <USER_ID>
 *   SYNC_USER_ID=<USER_ID> yarn sync-all gmail --index <INDEX_ID>
 */
import 'dotenv/config';
import { runSync } from '../lib/sync/runner';

function usage() {
  const text = `
Usage: yarn sync-all <provider> [options]

Providers:
  links | gmail | notion | slack | discord | calendar

Options:
  -u, --user <id>      User ID (or set SYNC_USER_ID env)
  -i, --index <id>     Index ID (where intents are attached, when applicable)
  -h, --help           Show this help

Examples:
  SYNC_USER_ID=123 yarn sync-all links --index 111
  yarn sync-all notion --index 111 --user 123
`;
  console.log(text);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let provider = (args[0] || '').toLowerCase();
  const out: any = { provider, params: {} };
  // Handle help as the first arg (e.g., `yarn sync-all --help`)
  if (provider === '--help' || provider === '-h') {
    out.help = true;
    out.provider = '';
    provider = '';
  }
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--index' || a === '-i') out.params.indexId = args[++i];
    else if (a === '--user' || a === '-u') out.userId = args[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('--')) { const k = a.slice(2); out.params[k] = args[++i]; }
  }
  return out;
}

async function main() {
  const { provider, params, userId, help } = parseArgs(process.argv);
  if (help || provider === 'help') { usage(); process.exit(0); }
  if (!provider) { usage(); process.exit(1); }
  const uid = userId || process.env.SYNC_USER_ID;
  if (!uid) {
    console.error('Missing user id. Provide --user or set SYNC_USER_ID env.');
    process.exit(1);
  }
  const result = await runSync(provider as any, uid, params);
  console.log(JSON.stringify({ ok: true, stats: result.stats }));
}

main().catch((e) => {
  console.error('sync-all error:', e?.message || String(e));
  process.exit(1);
});
