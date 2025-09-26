#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { v5 as uuidv5 } from 'uuid';
import { eq, and, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/db';
import { privyClient } from '../lib/privy';
import {
  agents,
  intentIndexes,
  intents,
  intentStakes,
  userConnectionEvents,
  users,
} from '../lib/schema';

type CliOptions = {
  force: boolean;
  json: boolean;
  silent: boolean;
};

type SeededUser = {
  email: string;
  name: string;
  userId: string;
  privyId: string;
  accessToken?: string;
  loginHints?: DemoUserLoginHints;
};

type SeedSummary = {
  users: SeededUser[];
  indexIds: string[];
  agentId: string | null;
};

const DEMO_NAMESPACE = uuidv5('protocol-demo-seed', uuidv5.URL);

function stableId(label: string): string {
  return uuidv5(label, DEMO_NAMESPACE);
}

type DemoIndexDefinition = {
  key: string;
  title: string;
  prompt?: string;
  linkPermissions?: {
    permissions: string[];
    code: string;
  };
};

const DEMO_INDEXES: DemoIndexDefinition[] = [
  {
    key: 'demo-network',
    title: 'Demo Discovery Network',
    prompt: 'Share what you are exploring so agents can surface relevant peers.',
    linkPermissions: {
      permissions: ['can-discover', 'can-request'],
      code: 'demo-network',
    },
  },
];

type DemoIntentDefinition = {
  key: string;
  payload: string;
  summary: string;
};

type DemoUserLoginHints = {
  accountName?: string;
  phoneNumber?: string;
  otpCode?: string;
};

type DemoUserDefinition = {
  key: string;
  email: string;
  name: string;
  intro: string;
  avatar: string;
  indexes: string[];
  intents: DemoIntentDefinition[];
  loginHints?: DemoUserLoginHints;
};

const PRIVY_TEST_ACCOUNTS: Array<{
  key: string;
  accountName: string;
  email: string;
  phoneNumber: string;
  otpCode: string;
}> = [
  {
    key: 'test-account-1',
    accountName: 'Test account 1',
    email: 'test-6285@privy.io',
    phoneNumber: '+1 555 555 1625',
    otpCode: '607027',
  },
  {
    key: 'test-account-2',
    accountName: 'Test account 2',
    email: 'test-9716@privy.io',
    phoneNumber: '+1 555 555 2920',
    otpCode: '670543',
  },
  {
    key: 'test-account-3',
    accountName: 'Test account 3',
    email: 'test-1761@privy.io',
    phoneNumber: '+1 555 555 5724',
    otpCode: '888893',
  },
  {
    key: 'test-account-4',
    accountName: 'Test account 4',
    email: 'test-5331@privy.io',
    phoneNumber: '+1 555 555 6283',
    otpCode: '094228',
  },
  {
    key: 'test-account-5',
    accountName: 'Test account 5',
    email: 'test-6462@privy.io',
    phoneNumber: '+1 555 555 8175',
    otpCode: '066860',
  },
  {
    key: 'test-account-6',
    accountName: 'Test account 6',
    email: 'test-7106@privy.io',
    phoneNumber: '+1 555 555 8469',
    otpCode: '991478',
  },
  {
    key: 'test-account-7',
    accountName: 'Test account 7',
    email: 'test-6945@privy.io',
    phoneNumber: '+1 555 555 9096',
    otpCode: '510460',
  },
  {
    key: 'test-account-8',
    accountName: 'Test account 8',
    email: 'test-2676@privy.io',
    phoneNumber: '+1 555 555 9419',
    otpCode: '503536',
  },
  {
    key: 'test-account-9',
    accountName: 'Test account 9',
    email: 'test-7561@privy.io',
    phoneNumber: '+1 555 555 9497',
    otpCode: '737681',
  },
  {
    key: 'test-account-10',
    accountName: 'Test account 10',
    email: 'test-1093@privy.io',
    phoneNumber: '+1 555 555 9779',
    otpCode: '934435',
  },
];

const DEMO_USERS: DemoUserDefinition[] = [
  {
    key: 'avery',
    email: 'avery.demo@index.build',
    name: 'Avery Demo',
    intro: 'Founder building collaborative AI tooling and onboarding early operators.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=AveryDemo',
    indexes: ['demo-network'],
    intents: [
      {
        key: 'ai-partnerships',
        payload: 'Looking to pair with ML researchers who want to ship copilots for strategic introductions between founders and investors.',
        summary: 'Seeking ML research partners for demo agent.',
      },
      {
        key: 'capital',
        payload: 'Exploring a $500k seed extension from angels who understand agent routing and MCP integrations.',
        summary: 'Raising capital from angels focused on agent ecosystems.',
      },
    ],
  },
  {
    key: 'jordan',
    email: 'jordan.invests@index.build',
    name: 'Jordan Chen',
    intro: 'Angel investor backing infra teams solving high-signal discovery.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=JordanChen',
    indexes: ['demo-network'],
    intents: [
      {
        key: 'invest-in-infra',
        payload: 'Deploying 100k-250k checks into founders aligning agents with verified network signals.',
        summary: 'Investing in network signal infrastructure founders.',
      },
      {
        key: 'portfolio-support',
        payload: 'Helping existing portfolio companies find design partners working on data-rich agent workflows.',
        summary: 'Supporting portfolio with agent design partners.',
      },
    ],
  },
  {
    key: 'sasha',
    email: 'sasha.builder@index.build',
    name: 'Sasha Patel',
    intro: 'Product engineer turning research notebooks into production-ready agent copilots.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=SashaPatel',
    indexes: ['demo-network'],
    intents: [
      {
        key: 'customer-discovery',
        payload: 'Looking for GTM leaders testing intent indexing so we can co-build the first automation loops.',
        summary: 'Hunting for GTM design partners for agent loops.',
      },
      {
        key: 'infra-collab',
        payload: 'Want to team up with data infra folks who can power fast embeddings for context brokers.',
        summary: 'Collaborating with data infra partners for context brokers.',
      },
    ],
  },
  ...PRIVY_TEST_ACCOUNTS.map((account) => ({
    key: account.key,
    email: account.email,
    name: account.accountName,
    intro: 'Privy QA test account for demo login flows.',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(account.accountName)}`,
    indexes: ['demo-network'],
    intents: [],
    loginHints: {
      accountName: account.accountName,
      phoneNumber: account.phoneNumber,
      otpCode: account.otpCode,
    },
  })),
];

const DEMO_AGENT = {
  key: 'demo-connector',
  name: 'Demo Connector',
  description: 'Highlights overlaps in intents and stakes small amounts on high-signal matches.',
  avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=DemoConnector',
};

type IntentRef = { userKey: string; intentKey: string };

const DEMO_STAKES: Array<{
  key: string;
  intents: IntentRef[];
  stake: string;
  reasoning: string;
}> = [
  {
    key: 'avery-jordan',
    intents: [
      { userKey: 'avery', intentKey: 'ai-partnerships' },
      { userKey: 'jordan', intentKey: 'invest-in-infra' },
    ],
    stake: '200',
    reasoning: 'Jordan is actively funding agent infra founders and Avery is raising for exactly that space.',
  },
  {
    key: 'avery-sasha',
    intents: [
      { userKey: 'avery', intentKey: 'capital' },
      { userKey: 'sasha', intentKey: 'infra-collab' },
    ],
    stake: '120',
    reasoning: 'Sasha wants infra partners; Avery needs collaborators to harden context brokers.',
  },
];

const DEMO_CONNECTION_EVENTS: Array<{
  key: string;
  initiator: string;
  receiver: string;
  type: 'REQUEST' | 'ACCEPT' | 'DECLINE';
  occurredAt: string;
}> = [
  {
    key: 'avery-request-jordan',
    initiator: 'avery',
    receiver: 'jordan',
    type: 'REQUEST',
    occurredAt: '2024-08-01T16:00:00.000Z',
  },
  {
    key: 'jordan-accept-avery',
    initiator: 'jordan',
    receiver: 'avery',
    type: 'ACCEPT',
    occurredAt: '2024-08-02T13:00:00.000Z',
  },
  {
    key: 'avery-request-sasha',
    initiator: 'avery',
    receiver: 'sasha',
    type: 'REQUEST',
    occurredAt: '2024-08-03T18:30:00.000Z',
  },
  {
    key: 'sasha-request-avery',
    initiator: 'sasha',
    receiver: 'avery',
    type: 'REQUEST',
    occurredAt: '2024-07-20T11:45:00.000Z',
  },
  {
    key: 'avery-decline-sasha',
    initiator: 'avery',
    receiver: 'sasha',
    type: 'DECLINE',
    occurredAt: '2024-07-21T09:15:00.000Z',
  },
];

type SchemaCapabilities = {
  indexHasPrompt: boolean;
  indexHasLinkPermissions: boolean;
  indexMembersHasPrompt: boolean;
  indexMembersHasAutoAssign: boolean;
};

let schemaCapabilitiesPromise: Promise<SchemaCapabilities> | null = null;

function extractRows<T>(result: { rows: T[] } | T[]): T[] {
  return Array.isArray(result) ? result : result.rows;
}

async function columnExists(tableName: string, columnName: string): Promise<boolean> {
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `);

  const rows = extractRows(result);
  return Boolean(rows[0]?.exists);
}

async function getSchemaCapabilities(): Promise<SchemaCapabilities> {
  if (!schemaCapabilitiesPromise) {
    schemaCapabilitiesPromise = Promise.all([
      columnExists('indexes', 'prompt'),
      columnExists('indexes', 'link_permissions'),
      columnExists('index_members', 'prompt'),
      columnExists('index_members', 'auto_assign'),
    ]).then(([indexHasPrompt, indexHasLinkPermissions, indexMembersHasPrompt, indexMembersHasAutoAssign]) => ({
      indexHasPrompt,
      indexHasLinkPermissions,
      indexMembersHasPrompt,
      indexMembersHasAutoAssign,
    }));
  }

  return schemaCapabilitiesPromise;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((error as any).code === '23505' || (error as any).routine === '_bt_check_unique')
  );
}

async function ensurePrivyIdentity(email: string, name: string): Promise<{ privyId: string; accessToken?: string }> {
  const normalized = email.toLowerCase();
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
  }

  let accessToken: string | undefined;
  try {
    const token = await privyClient.getTestAccessToken({ email: normalized });
    accessToken = token?.accessToken;
  } catch (error) {
    if (process.env.DEBUG === 'true') {
      console.warn(`Unable to fetch test access token for ${normalized}:`, error);
    }
  }

  // Update basic profile metadata if needed.
  return { privyId: privyUser.id, accessToken };
}

async function upsertIndex(def: typeof DEMO_INDEXES[number]): Promise<string> {
  const indexId = stableId(`index:${def.key}`);
  const capabilities = await getSchemaCapabilities();

  const insertColumns = ['"id"', '"title"'];
  const insertValues = [sql`${indexId}`, sql`${def.title}`];

  if (capabilities.indexHasPrompt) {
    insertColumns.push('"prompt"');
    insertValues.push(typeof def.prompt === 'string' ? sql`${def.prompt}` : sql.raw('NULL'));
  }

  if (capabilities.indexHasLinkPermissions) {
    insertColumns.push('"link_permissions"');
    insertValues.push(
      def.linkPermissions
        ? sql`${JSON.stringify(def.linkPermissions)}::json`
        : sql.raw('NULL')
    );
  }

  const insertColumnsSql = sql.raw(insertColumns.join(', '));
  const insertValuesSql = sql.join(insertValues, sql`, `);

  await db.execute(sql`
    INSERT INTO "indexes" (${insertColumnsSql})
    VALUES (${insertValuesSql})
    ON CONFLICT ("id") DO NOTHING
  `);

  const updateAssignments = [sql`"title" = ${def.title}`, sql.raw('"updated_at" = NOW()')];

  if (capabilities.indexHasPrompt) {
    updateAssignments.push(
      typeof def.prompt === 'string' ? sql`"prompt" = ${def.prompt}` : sql`"prompt" = NULL`
    );
  }

  if (capabilities.indexHasLinkPermissions) {
    updateAssignments.push(
      def.linkPermissions
        ? sql`"link_permissions" = ${JSON.stringify(def.linkPermissions)}::json`
        : sql`"link_permissions" = NULL`
    );
  }

  await db.execute(sql`
    UPDATE "indexes"
    SET ${sql.join(updateAssignments, sql`, `)}
    WHERE "id" = ${indexId}
  `);

  return indexId;
}

async function upsertAgent(): Promise<string> {
  const agentId = stableId(`agent:${DEMO_AGENT.key}`);
  const now = new Date();

  try {
    const inserted = await db
      .insert(agents)
      .values({
        id: agentId,
        name: DEMO_AGENT.name,
        description: DEMO_AGENT.description,
        avatar: DEMO_AGENT.avatar,
      })
      .returning({ id: agents.id });
    if (inserted.length > 0) return inserted[0].id;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  await db
    .update(agents)
    .set({
      name: DEMO_AGENT.name,
      description: DEMO_AGENT.description,
      avatar: DEMO_AGENT.avatar,
      updatedAt: now,
    })
    .where(eq(agents.id, agentId));

  return agentId;
}

async function upsertUser(def: DemoUserDefinition, privyId: string): Promise<{ id: string; privyId: string }> {
  const now = new Date();
  const email = def.email.toLowerCase();

  try {
    const inserted = await db
      .insert(users)
      .values({
        privyId,
        email,
        name: def.name,
        intro: def.intro,
        avatar: def.avatar,
      })
      .returning({ id: users.id, privyId: users.privyId });
    if (inserted.length > 0) {
      return inserted[0];
    }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const updated = await db
    .update(users)
    .set({
      privyId,
      name: def.name,
      intro: def.intro,
      avatar: def.avatar,
      updatedAt: now,
    })
    .where(eq(users.email, email))
    .returning({ id: users.id, privyId: users.privyId });

  if (updated.length > 0) {
    return updated[0];
  }

  const existing = await db
    .select({ id: users.id, privyId: users.privyId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Failed to upsert user for ${email}`);
  }

  return existing[0];
}

async function ensureIndexMembership(indexId: string, userId: string): Promise<void> {
  const capabilities = await getSchemaCapabilities();
  const permissionsArray = sql`ARRAY['can-read-intents','can-write-intents','can-discover']::text[]`;

  const existing = await db.execute(sql`
    SELECT 1
    FROM "index_members"
    WHERE "index_id" = ${indexId} AND "user_id" = ${userId}
    LIMIT 1
  `);

  const rows = extractRows(existing);

  if (rows.length === 0) {
    const insertColumns = ['"index_id"', '"user_id"', '"permissions"'];
    const insertValues = [sql`${indexId}`, sql`${userId}`, permissionsArray];

    if (capabilities.indexMembersHasPrompt) {
      insertColumns.push('"prompt"');
      insertValues.push(sql.raw('NULL'));
    }

    if (capabilities.indexMembersHasAutoAssign) {
      insertColumns.push('"auto_assign"');
      insertValues.push(sql`TRUE`);
    }

    await db.execute(sql`
      INSERT INTO "index_members" (${sql.raw(insertColumns.join(', '))})
      VALUES (${sql.join(insertValues, sql`, `)})
    `);
    return;
  }

  const updateAssignments = [sql`"permissions" = ${permissionsArray}`, sql.raw('"updated_at" = NOW()')];

  if (capabilities.indexMembersHasPrompt) {
    updateAssignments.push(sql`"prompt" = NULL`);
  }

  if (capabilities.indexMembersHasAutoAssign) {
    updateAssignments.push(sql`"auto_assign" = TRUE`);
  }

  await db.execute(sql`
    UPDATE "index_members"
    SET ${sql.join(updateAssignments, sql`, `)}
    WHERE "index_id" = ${indexId} AND "user_id" = ${userId}
  `);
}

async function upsertIntent(
  userId: string,
  def: DemoIntentDefinition,
  indexIds: string[],
  userKey: string
): Promise<string> {
  const intentId = stableId(`intent:${userKey}:${def.key}`);
  const now = new Date();

  try {
    await db.insert(intents).values({
      id: intentId,
      payload: def.payload,
      summary: def.summary,
      userId,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(intents)
      .set({ payload: def.payload, summary: def.summary, updatedAt: now })
      .where(eq(intents.id, intentId));
  }

  const uniqueIndexIds = Array.from(new Set(indexIds));

  for (const indexId of uniqueIndexIds) {
    const existingLink = await db
      .select({ intentId: intentIndexes.intentId })
      .from(intentIndexes)
      .where(and(eq(intentIndexes.intentId, intentId), eq(intentIndexes.indexId, indexId)))
      .limit(1);

    if (existingLink.length > 0) continue;

    await db.insert(intentIndexes).values({
      intentId,
      indexId,
    });
  }

  return intentId;
}

async function upsertIntentStake(
  agentId: string,
  def: (typeof DEMO_STAKES)[number],
  intentIdMap: Map<string, string>
): Promise<void> {
  const stakeId = stableId(`stake:${def.key}`);
  const now = new Date();
  const intentList = def.intents
    .map((ref) => intentIdMap.get(`${ref.userKey}:${ref.intentKey}`))
    .filter((id): id is string => Boolean(id));

  if (intentList.length === 0) return;

  const stakeValue = sql`${def.stake}::bigint`;

  try {
    await db.insert(intentStakes).values({
      id: stakeId,
      intents: intentList,
      stake: stakeValue,
      reasoning: def.reasoning,
      agentId,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(intentStakes)
      .set({ intents: intentList, stake: stakeValue, reasoning: def.reasoning, agentId, updatedAt: now })
      .where(eq(intentStakes.id, stakeId));
  }
}

async function upsertConnectionEvents(
  eventDefs: typeof DEMO_CONNECTION_EVENTS,
  userIdMap: Map<string, string>
): Promise<void> {
  for (const event of eventDefs) {
    const initiatorId = userIdMap.get(event.initiator);
    const receiverId = userIdMap.get(event.receiver);
    if (!initiatorId || !receiverId) continue;

    const eventId = stableId(`connection:${event.key}`);
    const createdAt = new Date(event.occurredAt);

    try {
      await db.insert(userConnectionEvents).values({
        id: eventId,
        initiatorUserId: initiatorId,
        receiverUserId: receiverId,
        eventType: event.type,
        createdAt,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await db
        .update(userConnectionEvents)
        .set({
          initiatorUserId: initiatorId,
          receiverUserId: receiverId,
          eventType: event.type,
          createdAt,
        })
        .where(eq(userConnectionEvents.id, eventId));
    }
  }
}

async function runSeed(): Promise<SeedSummary> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set.');
  }
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set.');
  }

  const indexMap = new Map<string, string>();
  for (const indexDef of DEMO_INDEXES) {
    const indexId = await upsertIndex(indexDef);
    indexMap.set(indexDef.key, indexId);
  }

  const agentId = await upsertAgent();
  const intentMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const seededUsers: SeededUser[] = [];

  for (const userDef of DEMO_USERS) {
    const { privyId, accessToken } = await ensurePrivyIdentity(userDef.email, userDef.name);
    const user = await upsertUser(userDef, privyId);
    userIdMap.set(userDef.key, user.id);
    seededUsers.push({
      email: userDef.email.toLowerCase(),
      name: userDef.name,
      userId: user.id,
      privyId: user.privyId,
      accessToken,
      loginHints: userDef.loginHints,
    });

    const indexIds = userDef.indexes
      .map((key) => indexMap.get(key))
      .filter((value): value is string => Boolean(value));

    for (const indexId of indexIds) {
      await ensureIndexMembership(indexId, user.id);
    }

    for (const intentDef of userDef.intents) {
      const intentId = await upsertIntent(user.id, intentDef, indexIds, userDef.key);
      intentMap.set(`${userDef.key}:${intentDef.key}`, intentId);
    }
  }

  for (const stakeDef of DEMO_STAKES) {
    await upsertIntentStake(agentId, stakeDef, intentMap);
  }

  await upsertConnectionEvents(DEMO_CONNECTION_EVENTS, userIdMap);

  return {
    users: seededUsers,
    indexIds: Array.from(indexMap.values()),
    agentId,
  };
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('db:seed demo')
    .description('Seed deterministic demo data for local development environments')
    .option('--force', 'Skip safety check (required to run)')
    .option('--json', 'Output machine-readable JSON (no extra text)')
    .option('--silent', 'Suppress non-error output');

  await program.parseAsync(process.argv);
  const opts = program.opts<CliOptions>();

  if (!opts.force) {
    const message = 'Add --force to confirm demo seeding operation.';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runSeed();

    if (opts.json) {
      console.log(JSON.stringify({ ok: true, ...result }));
    } else if (!opts.silent) {
      console.log('Seeded demo data successfully.');
      console.log(`- Users: ${result.users.length}`);
      console.log(`- Indexes: ${result.indexIds.length}`);
      console.log(`- Agent: ${result.agentId}`);
      console.log('\nLogin helpers (test access tokens / OTPs):');
      result.users.forEach((user) => {
        const label = `${user.name} <${user.email}>`;
        const helperParts: string[] = [];

        if (user.accessToken) {
          helperParts.push(`token ${user.accessToken}`);
        } else {
          helperParts.push('test credentials not available (enable in Privy dashboard)');
        }

        if (user.loginHints?.phoneNumber) {
          helperParts.push(`phone ${user.loginHints.phoneNumber}`);
        }

        if (user.loginHints?.otpCode) {
          helperParts.push(`otp ${user.loginHints.otpCode}`);
        }

        console.log(`  ${label} -> ${helperParts.join(' | ')}`);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (opts.json) {
      console.error(JSON.stringify({ ok: false, error: message }));
    } else {
      console.error(`db:seed demo error: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    await closeDb().catch(() => undefined);
  }
}

main();
