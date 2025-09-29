#!/usr/bin/env node
import 'dotenv/config';
import { and, eq, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/db';
import {
  intents,
  intentIndexes,
  intentStakes,
  indexMembers,
  indexes,
  indexLinks,
  users,
  type Intent,
  type User,
} from '../lib/schema';
import { initializeBrokers, triggerBrokersOnIntentCreated } from '../agents/context_brokers/connector';
import { privyClient } from '../lib/privy';

const INDEX_ID = '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c';
const INTENTS_PER_USER = 2;
const SEMANTIC_RELEVANCY_AGENT_ID = '028ef80e-9b1c-434b-9296-bb6130509482';

type MockUser = {
  name: string;
  email: string;
  intro: string;
  linkUrl: string;
  phoneNumber: string;
  otpCode: string;
};

type TestAccountSeed = {
  key: string;
  accountName: string;
  email: string;
  phoneNumber: string;
  otpCode: string;
};

type DatabaseError = Error & { code?: string };

type GeneratedIntent = {
  record: Intent;
  owner: User;
};

type IntentSource = {
  type: 'link';
  id: string;
};

const PRIVY_TEST_ACCOUNTS: readonly TestAccountSeed[] = [
  {
    key: 'test-account-1',
    accountName: 'Casey Harper',
    email: 'test-6285@privy.io',
    phoneNumber: '+1 555 555 1625',
    otpCode: '607027',
  },
  {
    key: 'test-account-2',
    accountName: 'Devon Brooks',
    email: 'test-9716@privy.io',
    phoneNumber: '+1 555 555 2920',
    otpCode: '670543',
  },
  {
    key: 'test-account-3',
    accountName: 'Morgan Li',
    email: 'test-1761@privy.io',
    phoneNumber: '+1 555 555 5724',
    otpCode: '888893',
  },
  {
    key: 'test-account-4',
    accountName: 'Riley Nguyen',
    email: 'test-5331@privy.io',
    phoneNumber: '+1 555 555 6283',
    otpCode: '094228',
  },
  {
    key: 'test-account-5',
    accountName: 'Taylor Singh',
    email: 'test-6462@privy.io',
    phoneNumber: '+1 555 555 8175',
    otpCode: '066860',
  },
  {
    key: 'test-account-6',
    accountName: 'Quinn Ramirez',
    email: 'test-7106@privy.io',
    phoneNumber: '+1 555 555 8469',
    otpCode: '991478',
  },
  {
    key: 'test-account-7',
    accountName: 'Emerson Blake',
    email: 'test-6945@privy.io',
    phoneNumber: '+1 555 555 9096',
    otpCode: '510460',
  },
  {
    key: 'test-account-8',
    accountName: 'Peyton Alvarez',
    email: 'test-2676@privy.io',
    phoneNumber: '+1 555 555 9419',
    otpCode: '503536',
  },
  {
    key: 'test-account-9',
    accountName: 'Sydney Clarke',
    email: 'test-7561@privy.io',
    phoneNumber: '+1 555 555 9497',
    otpCode: '737681',
  },
  {
    key: 'test-account-10',
    accountName: 'Hayden Moore',
    email: 'test-1093@privy.io',
    phoneNumber: '+1 555 555 9779',
    otpCode: '934435',
  },
];

const mockUsers: readonly MockUser[] = PRIVY_TEST_ACCOUNTS.map((account) => ({
  name: account.accountName,
  email: account.email,
  intro: `Privy test account for ${account.accountName}.`,
  linkUrl: `https://demo-network.local/${account.email.split('@')[0]}`,
  phoneNumber: account.phoneNumber,
  otpCode: account.otpCode,
}));

const userLinkCache = new Map<string, string>();

const DEFAULT_INTENT_NOUNS = {
  collaborate: 'projects',
  partner: 'initiatives',
  connect: 'collaborations',
  build: 'developments',
  target: 'partnerships',
  outreach: 'projects',
} as const;

type TemplateKey = keyof typeof DEFAULT_INTENT_NOUNS;

type IntentTemplate = {
  prefix: string;
  joiner: string;
  nounKey: TemplateKey;
};

type TopicBlueprint = {
  base: string;
  overrides?: Partial<Record<TemplateKey, string>>;
};

const INTENT_TEMPLATES = [
  { prefix: 'Looking for', joiner: 'to collaborate on', nounKey: 'collaborate' },
  { prefix: 'Seeking', joiner: 'to partner on', nounKey: 'partner' },
  { prefix: 'Connecting with', joiner: 'for', nounKey: 'connect' },
  { prefix: 'Partnering with', joiner: 'on', nounKey: 'build' },
  { prefix: 'Targeting', joiner: 'for', nounKey: 'target' },
  { prefix: 'Reaching out to', joiner: 'about', nounKey: 'outreach' },
] as const satisfies readonly IntentTemplate[];

const AUDIENCE_TOPICS = {
  'AI researchers': [
    { base: 'machine learning model optimization' },
    { base: 'deep learning optimization' },
    { base: 'algorithm optimization' },
  ],
  'AI specialists': [
    { base: 'machine learning optimization', overrides: { collaborate: 'research' } },
    { base: 'deep learning model' },
    { base: 'algorithm development' },
  ],
  'AI experts': [
    { base: 'machine learning model', overrides: { collaborate: 'research' } },
    { base: 'neural network optimization' },
    { base: 'computational optimization' },
  ],
  'machine learning researchers': [{ base: 'AI optimization' }],
  'machine learning specialists': [{ base: 'AI model' }],
  'machine learning experts': [{ base: 'AI research' }],
  'deep learning researchers': [{ base: 'AI optimization' }],
  'deep learning specialists': [{ base: 'machine learning' }],
  'deep learning experts': [{ base: 'AI model' }],
  'neural network researchers': [{ base: 'optimization' }],
  'neural network specialists': [{ base: 'AI' }],
  'neural network experts': [{ base: 'machine learning' }],
} as const satisfies Record<string, readonly TopicBlueprint[]>;

const intentAudiences = Object.keys(AUDIENCE_TOPICS) as (keyof typeof AUDIENCE_TOPICS)[];

function getRandomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function buildIntent(
  template: IntentTemplate,
  audience: keyof typeof AUDIENCE_TOPICS,
  topic: TopicBlueprint,
): string {
  const nounOverrides = topic.overrides ?? {};
  const nouns = {
    ...DEFAULT_INTENT_NOUNS,
    ...nounOverrides,
  } as Record<TemplateKey, string>;
  return `${template.prefix} ${audience} ${template.joiner} ${topic.base} ${nouns[template.nounKey]}.`;
}

function getRandomIntentPayload(): string {
  const audience = getRandomItem(intentAudiences);
  const topic = getRandomItem(AUDIENCE_TOPICS[audience]);
  const template = getRandomItem(INTENT_TEMPLATES);
  return buildIntent(template, audience, topic);
}

async function ensurePrivyIdentity(email: string): Promise<string> {
  const normalized = email.toLowerCase();

  try {
    let privyUser = await privyClient.getUserByEmail(normalized);

    if (!privyUser) {
      privyUser = await privyClient.importUser({
        linkedAccounts: [
          {
            type: 'email',
            address: normalized,
          },
        ],
      });
      console.log(`Imported Privy test account for ${normalized}`);
    }

    return privyUser.id;
  } catch (error) {
    throw new Error(
      `Failed to ensure Privy identity for ${normalized}: ${error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function ensureUserLink(user: User, seed: MockUser): Promise<string> {
  const cached = userLinkCache.get(user.id);
  if (cached) return cached;

  const [existing] = await db
    .select()
    .from(indexLinks)
    .where(and(eq(indexLinks.userId, user.id), eq(indexLinks.url, seed.linkUrl)))
    .limit(1);

  if (existing) {
    userLinkCache.set(user.id, existing.id);
    return existing.id;
  }

  const [created] = await db
    .insert(indexLinks)
    .values({
      userId: user.id,
      url: seed.linkUrl,
    })
    .returning();

  userLinkCache.set(user.id, created.id);
  console.log(`Created library link for ${user.name}`);
  return created.id;
}

async function ensureIndexExists(): Promise<void> {
  const [index] = await db.select().from(indexes).where(eq(indexes.id, INDEX_ID)).limit(1);
  if (index) return;

  try {
    await db
      .insert(indexes)
      .values({
        id: INDEX_ID,
        title: 'Mock Demo Network',
        prompt: 'Share collaboration opportunities and updates.',
      });
    console.log(`Created mock index ${INDEX_ID}`);
  } catch (error) {
    if ((error as DatabaseError).code === '23505') {
      console.log(`Index ${INDEX_ID} already exists.`);
      return;
    }
    throw error;
  }
}

async function upsertUser(seed: MockUser, privyId: string): Promise<User> {
  try {
    const [inserted] = await db
      .insert(users)
      .values({
        privyId,
        email: seed.email,
        name: seed.name,
        intro: seed.intro,
      })
      .returning();
    console.log(`Created user: ${seed.name} (${seed.email})`);
    return inserted;
  } catch (error) {
    if ((error as DatabaseError).code === '23505') {
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, seed.email))
        .limit(1);
      if (existing) {
        const requiresUpdate =
          existing.privyId !== privyId ||
          existing.name !== seed.name ||
          existing.intro !== seed.intro;

        if (requiresUpdate) {
          const [updated] = await db
            .update(users)
            .set({
              privyId,
              name: seed.name,
              intro: seed.intro,
            })
            .where(eq(users.id, existing.id))
            .returning();
          console.log(`Updated user profile: ${seed.name} (${seed.email})`);
          return updated;
        }

        console.log(`Using existing user: ${seed.name} (${seed.email})`);
        return existing;
      }
    }
    throw error;
  }
}

async function ensureIndexMembership(user: User, { owner }: { owner: boolean }): Promise<void> {
  const permissions = owner
    ? ['owner', 'can-read-intents', 'can-write-intents']
    : ['can-read-intents', 'can-write-intents'];

  try {
    await db.insert(indexMembers).values({
      indexId: INDEX_ID,
      userId: user.id,
      permissions,
      prompt: 'everything',
      autoAssign: true,
    });
    console.log(`Added ${user.name} as ${owner ? 'owner' : 'member'} of index ${INDEX_ID}`);
  } catch (error) {
    if ((error as DatabaseError).code === '23505') {
      await db
        .update(indexMembers)
        .set({ permissions })
        .where(and(eq(indexMembers.indexId, INDEX_ID), eq(indexMembers.userId, user.id)))
        .execute();
      console.log(`${user.name} already member of index ${INDEX_ID}; permissions refreshed`);
      return;
    }
    throw error;
  }
}

async function createIntent(
  user: User,
  payload: string,
  options?: { source?: IntentSource }
): Promise<GeneratedIntent> {
  const summary = payload.length > 100 ? `${payload.slice(0, 97)}...` : payload;

  const [intent] = await db
    .insert(intents)
    .values({
      payload,
      summary,
      userId: user.id,
      ...(options?.source
        ? {
          sourceType: options.source.type,
          sourceId: options.source.id,
        }
        : {}),
    })
    .returning();

  try {
    await db.insert(intentIndexes).values({
      intentId: intent.id,
      indexId: INDEX_ID,
    });
    console.log(`Associated intent ${intent.id.slice(0, 8)}… with index ${INDEX_ID}`);
  } catch (error) {
    if ((error as DatabaseError).code === '23505') {
      console.log(`Intent ${intent.id.slice(0, 8)}… is already linked to index ${INDEX_ID}`);
    } else {
      throw error;
    }
  }

  return { record: intent, owner: user };
}

async function createIntentsForUser(user: User): Promise<GeneratedIntent[]> {
  const intentsForUser: GeneratedIntent[] = [];

  for (let i = 0; i < INTENTS_PER_USER; i += 1) {
    const payload = getRandomIntentPayload();
    const intent = await createIntent(user, payload);
    intentsForUser.push(intent);

    try {
      await triggerBrokersOnIntentCreated(intent.record.id);
      console.log(`Triggered brokers for intent ${intent.record.id.slice(0, 8)}…`);
    } catch (error) {
      console.warn(
        `Warning: Failed to trigger brokers for intent ${intent.record.id.slice(0, 8)}…: ${error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return intentsForUser;
}

async function generateMockData(): Promise<void> {
  console.log('Starting mock data generation…');

  await ensureIndexExists();

  console.log('Initializing context brokers…');
  await initializeBrokers();
  console.log('Context brokers ready');

  const createdUsers: User[] = [];
  const userSeedById = new Map<string, MockUser>();

  for (const [index, seed] of mockUsers.entries()) {
    const privyId = await ensurePrivyIdentity(seed.email);
    const user = await upsertUser(seed, privyId);
    await ensureIndexMembership(user, { owner: index === 0 });
    createdUsers.push(user);
    userSeedById.set(user.id, seed);
  }

  console.log(`Creating ${INTENTS_PER_USER} intents for ${createdUsers.length} users…`);
  const generatedIntents: GeneratedIntent[] = [];

  for (const user of createdUsers) {
    console.log(`Creating intents for ${user.name}…`);
    const intentsForUser = await createIntentsForUser(user);
    generatedIntents.push(...intentsForUser);
  }

  const collaborationIntentMap = new Map<string, string>();

  if (createdUsers.length > 1) {
    console.log('Creating collaboration intents to encourage discovery…');
    for (let i = 0; i < createdUsers.length; i += 1) {
      const owner = createdUsers[i];
      const partner = createdUsers[(i + 1) % createdUsers.length];
      const payload = `Open to collaborate with ${partner.name} on cross-functional projects inside Mock Demo Network.`;
      const seed = userSeedById.get(owner.id);
      let sourceId: string | undefined;
      if (seed) {
        sourceId = await ensureUserLink(owner, seed);
      }
      const collabIntent = await createIntent(owner, payload, {
        source: sourceId ? { type: 'link', id: sourceId } : undefined,
      });
      generatedIntents.push(collabIntent);
      collaborationIntentMap.set(owner.id, collabIntent.record.id);

      try {
        await triggerBrokersOnIntentCreated(collabIntent.record.id);
        console.log(`Triggered brokers for collaboration intent ${collabIntent.record.id.slice(0, 8)}…`);
      } catch (error) {
        console.warn(
          `Warning: Failed to trigger brokers for collaboration intent ${collabIntent.record.id.slice(0, 8)}…: ${error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  if (collaborationIntentMap.size > 1) {
    console.log('Linking collaboration intents with stakes for discovery…');
    for (let i = 0; i < createdUsers.length; i += 1) {
      const owner = createdUsers[i];
      const partner = createdUsers[(i + 1) % createdUsers.length];
      const ownerIntentId = collaborationIntentMap.get(owner.id);
      const partnerIntentId = collaborationIntentMap.get(partner.id);
      if (!ownerIntentId || !partnerIntentId) continue;

      const intentPair = [ownerIntentId, partnerIntentId].sort();
      const [existingStake] = await db
        .select({ id: intentStakes.id })
        .from(intentStakes)
        .where(
          sql`${intentStakes.intents} @> ARRAY[${intentPair[0]}, ${intentPair[1]}]::text[] AND array_length(${intentStakes.intents}, 1) = 2`
        )
        .limit(1);

      if (existingStake) {
        console.log(`Stake between ${owner.name} and ${partner.name} already exists`);
        continue;
      }

      try {
        await db.insert(intentStakes).values({
          intents: intentPair,
          stake: BigInt(150),
          reasoning: `${owner.name} and ${partner.name} are collaborating on the mock index.`,
          agentId: SEMANTIC_RELEVANCY_AGENT_ID,
        });
        console.log(`Created stake connecting ${owner.name} and ${partner.name}`);
      } catch (error) {
        console.warn(
          `Warning: Could not create stake for ${owner.name}/${partner.name}: ${error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  console.log('\n=== Mock Data Generation Complete ===');
  console.log(`Users processed: ${createdUsers.length}`);
  console.log(`Intents created: ${generatedIntents.length}`);
  console.log(`All intents associated with index: ${INDEX_ID}`);

  console.log('\n=== Login Hints ===');
  mockUsers.forEach((user) => {
    console.log(
      `${user.name}: email=${user.email}, phone=${user.phoneNumber}, OTP=${user.otpCode}`,
    );
  });

  console.log('\n=== Sample Intents ===');
  generatedIntents.slice(0, 5).forEach((item) => {
    console.log(`${item.owner.name}: "${item.record.payload}"`);
  });
}

async function main(): Promise<void> {
  try {
    await generateMockData();
  } catch (error) {
    console.error('Error generating mock data:', error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
