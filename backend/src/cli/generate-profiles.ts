#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { and, isNull, sql } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import { userProfiles, users } from '../schemas/database.schema';
import { setLevel } from '../lib/log';
import { ProfileGraphFactory } from '@indexnetwork/protocol';
import { ProfileDatabaseAdapter } from '../adapters/database.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';

const DEFAULT_CONCURRENCY = 100;

type GlobalOpts = {
  silent?: boolean;
  dryRun?: boolean;
  concurrency: number;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  let concurrency = DEFAULT_CONCURRENCY;
  const concurrencyArg = args.find((a) => a.startsWith('--concurrency='));
  if (concurrencyArg) {
    const val = parseInt(concurrencyArg.split('=')[1], 10);
    if (!Number.isNaN(val) && val > 0) concurrency = Math.min(val, 20);
  }
  return {
    silent: args.includes('--silent'),
    dryRun: args.includes('--dry-run'),
    concurrency,
  };
}

async function getUsersWithoutProfiles() {
  const result = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .leftJoin(userProfiles, sql`${userProfiles.userId} = ${users.id}`)
    .where(and(isNull(userProfiles.id), isNull(users.deletedAt)));

  return result;
}

async function generateProfiles(opts: GlobalOpts): Promise<{ ok: boolean; error?: string }> {
  try {
    const usersWithout = await getUsersWithoutProfiles();

    if (usersWithout.length === 0) {
      if (!opts.silent) console.log('All users already have profiles.');
      return { ok: true };
    }

    if (!opts.silent) console.log(`Found ${usersWithout.length} user(s) without profiles.\n`);

    if (opts.dryRun) {
      for (const u of usersWithout) {
        console.log(`  [dry-run] ${u.name} (${u.email})`);
      }
      return { ok: true };
    }

    if (!opts.silent) console.log(`Concurrency: ${opts.concurrency}\n`);

    const factory = new ProfileGraphFactory(
      new ProfileDatabaseAdapter(),
      new ScraperAdapter(),
    );

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let completed = 0;

    async function processUser(u: { id: string; name: string; email: string }) {
      try {
        const graph = factory.createGraph();
        const result = await graph.invoke({ userId: u.id, operationMode: 'generate' as const });

        if (result.needsUserInfo) {
          skipped++;
          if (!opts.silent) console.log(`  [${++completed}/${usersWithout.length}] ${u.name} — skipped (needs: ${(result.missingUserInfo || []).join(', ')})`);
        } else if (result.error) {
          failed++;
          if (!opts.silent) console.log(`  [${++completed}/${usersWithout.length}] ${u.name} — error: ${result.error}`);
        } else {
          succeeded++;
          if (!opts.silent) console.log(`  [${++completed}/${usersWithout.length}] ${u.name} — done`);
        }
      } catch (err) {
        failed++;
        if (!opts.silent) console.log(`  [${++completed}/${usersWithout.length}] ${u.name} — failed: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}`);
      }
    }

    let cursor = 0;
    async function worker() {
      while (cursor < usersWithout.length) {
        const u = usersWithout[cursor++];
        await processUser(u);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(opts.concurrency, usersWithout.length) }, () => worker()),
    );

    if (!opts.silent) {
      console.log(`\nSummary: ${succeeded} succeeded, ${failed} failed, ${skipped} skipped (insufficient info)`);
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  if (opts.silent) setLevel('error');

  const result = await generateProfiles(opts);

  if (!result.ok) {
    console.error('Profile generation failed:', result.error);
    await closeDb();
    process.exit(1);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('generate-profiles error:', msg);
    await closeDb();
    process.exit(1);
  });
