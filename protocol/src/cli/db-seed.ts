#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

console.log(process.env.DATABASE_URL);

import { Command } from 'commander';
import { eq } from 'drizzle-orm';
import db, { closeDb } from '../lib/db';
import { intents, intentIndexes, intentStakes, indexMembers, indexes, users } from '../lib/schema';
import { privyClient } from '../lib/privy';
import { setLevel } from '../lib/log';

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';
const SEMANTIC_RELEVANCY_AGENT_ID = '028ef80e-9b1c-434b-9296-bb6130509482';

const PRIVY_TEST_ACCOUNTS = [
  { name: 'Casey Harper', email: 'test-6285@privy.io', phoneNumber: '+1 555 555 1625', otpCode: '607027' },
  { name: 'Devon Brooks', email: 'test-9716@privy.io', phoneNumber: '+1 555 555 2920', otpCode: '670543' },
  { name: 'Morgan Li', email: 'test-1761@privy.io', phoneNumber: '+1 555 555 5724', otpCode: '888893' },
  { name: 'Riley Nguyen', email: 'test-5331@privy.io', phoneNumber: '+1 555 555 6283', otpCode: '094228' },
  { name: 'Taylor Singh', email: 'test-6462@privy.io', phoneNumber: '+1 555 555 8175', otpCode: '066860' },
  { name: 'Quinn Ramirez', email: 'test-7106@privy.io', phoneNumber: '+1 555 555 8469', otpCode: '991478' },
  { name: 'Emerson Blake', email: 'test-6945@privy.io', phoneNumber: '+1 555 555 9096', otpCode: '510460' },
  { name: 'Peyton Alvarez', email: 'test-2676@privy.io', phoneNumber: '+1 555 555 9419', otpCode: '503536' },
  { name: 'Sydney Clarke', email: 'test-7561@privy.io', phoneNumber: '+1 555 555 9497', otpCode: '737681' },
  { name: 'Hayden Moore', email: 'test-1093@privy.io', phoneNumber: '+1 555 555 9779', otpCode: '934435' },
];

const INTENTS = [
  'Looking for AI researchers to collaborate on machine learning projects',
  'Seeking blockchain developers for DeFi partnerships', 
  'Connecting with designers for UI/UX collaborations',
  'Building cross-functional teams for product development',
  'Open to mentoring junior developers in web3 space',
];

async function ensurePrivyIdentity(email: string): Promise<string> {
  let privyUser = await privyClient.getUserByEmail(email);
  if (!privyUser) {
    privyUser = await privyClient.importUser({
      linkedAccounts: [{ type: 'email', address: email }],
    });
  }
  return privyUser.id;
}

async function createUser(account: typeof PRIVY_TEST_ACCOUNTS[0]): Promise<any> {
  const privyId = await ensurePrivyIdentity(account.email);
  
  try {
    const [user] = await db.insert(users).values({
      privyId,
      email: account.email,
      name: account.name,
      intro: `Test account for ${account.name}`,
      onboarding: {}
    }).returning();
    return user;
  } catch {
    const [existing] = await db.select().from(users).where(eq(users.email, account.email)).limit(1);
    return existing;
  }
}

async function createIntent(user: any, payload: string): Promise<string> {
  const [intent] = await db.insert(intents).values({
    payload,
    summary: payload.slice(0, 100),
    userId: user.id,
  }).returning();

  await db.insert(intentIndexes).values({
    intentId: intent.id,
    indexId: INDEX_ID,
  });

  return intent.id;
}

async function seedDatabase(): Promise<{ ok: boolean; error?: string }> {
  try {
    console.log('Generating minimal mock data...');

    // Create index
    try {
      await db.insert(indexes).values({
        id: INDEX_ID,
        title: 'Mock Demo Network',
        prompt: 'Share collaboration opportunities',
      });
    } catch {}

    // Create users and intents
    const createdUsers = [];
    const intentIds = [];

    for (const [i, account] of PRIVY_TEST_ACCOUNTS.entries()) {
      const user = await createUser(account);
      createdUsers.push(user);

      // Add to index
      try {
        await db.insert(indexMembers).values({
          indexId: INDEX_ID,
          userId: user.id,
          permissions: i === 0 ? ['owner'] : ['member'],
          prompt: 'everything',
          autoAssign: true,
        });
      } catch {}

      // Create intent
      const payload = INTENTS[i % INTENTS.length];
      const intentId = await createIntent(user, payload);
      intentIds.push(intentId);
    }

    // Connect all users to everyone (create stakes between all pairs of intents)
    for (let i = 0; i < createdUsers.length; i++) {
      for (let j = i + 1; j < createdUsers.length; j++) {
        const intentPair = [intentIds[i], intentIds[j]].sort();

        try {
          await db.insert(intentStakes).values({
            intents: intentPair,
            stake: BigInt(100),
            reasoning: `${createdUsers[i].name} and ${createdUsers[j].name} should connect`,
            agentId: SEMANTIC_RELEVANCY_AGENT_ID,
          });
        } catch {}
      }
    }

    console.log(`✅ Created ${createdUsers.length} users with connected intents`);
    console.log('\nLogin credentials:');
    PRIVY_TEST_ACCOUNTS.forEach(acc => 
      console.log(`${acc.name}: ${acc.email} | ${acc.phoneNumber} | OTP: ${acc.otpCode}`)
    );

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('db-seed')
    .description('Seed database with mock data')
    .option('--silent', 'Suppress non-error output')
    .option('--confirm', 'Skip confirmation prompt')
    .action(async (opts: GlobalOpts) => {
      if (opts.silent) setLevel('error');

      // Prevent seeding in production
      if (process.env.NODE_ENV === 'production') {
        console.error('❌ db:seed cannot be run in production environment');
        process.exit(1);
      }

      if (!opts.confirm) {
        console.log('⚠️  This will add mock data to the database.');
        console.log('Use --confirm to skip this warning.');
        process.exit(1);
      }

      const result = await seedDatabase();
      
      if (!result.ok) {
        console.error('❌ Seed failed:', result.error);
        process.exit(1);
      }
    });

  program.addHelpText(
    'after',
    '\nExamples:\n  yarn db:seed --confirm\n  yarn db:seed --silent --confirm\n'
  );

  try {
    await program.parseAsync(process.argv);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : `${e}`;
    console.error('db-seed error:', msg);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
