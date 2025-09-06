#!/usr/bin/env node
import 'dotenv/config';
import { registerSyncProviders } from '../lib/sync/register';
import { enqueue, getRun } from '../lib/sync/queue';

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const provider = (args[0] || '').toLowerCase();
  const out: any = { provider, params: {} };
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--index' || a === '-i') out.params.indexId = args[++i];
    else if (a === '--user' || a === '-u') out.userId = args[++i];
    else if (a === '--wait') out.wait = true;
    else if (a.startsWith('--')) {
      const k = a.slice(2);
      out.params[k] = args[++i];
    }
  }
  return out;
}

async function main() {
  const { provider, params, userId, wait } = parseArgs(process.argv);
  if (!provider) {
    console.error('Usage: yarn sync-all <links|gmail|notion|slack|discord|calendar> [--index <id>] [--user <id>] [--wait]');
    process.exit(1);
  }
  registerSyncProviders();
  const uid = userId || process.env.SYNC_USER_ID;
  if (!uid) {
    console.error('Missing user id. Provide --user or SYNC_USER_ID env.');
    process.exit(1);
  }
  const runId = await enqueue(provider as any, uid, params);
  console.log(JSON.stringify({ runId }));
  if (wait) {
    // naive poll
    for (;;) {
      const run = await getRun(runId);
      if (!run) throw new Error('Run disappeared');
      if (run.status === 'succeeded' || run.status === 'failed') {
        console.log(JSON.stringify({ run }));
        process.exit(run.status === 'succeeded' ? 0 : 1);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

main().catch((e) => {
  console.error('sync-all error:', e?.message || String(e));
  process.exit(1);
});
