#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { v5 as uuidv5 } from 'uuid';
import { eq, and, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/db';
import { privyClient } from '../lib/privy';
import {
  agents,
  files,
  indexLinks,
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
  fileCount: number;
  linkCount: number;
  intentCount: number;
};

const DEMO_NAMESPACE = uuidv5('protocol-demo-seed', uuidv5.URL);

function stableId(label: string): string {
  return uuidv5(label, DEMO_NAMESPACE);
}

type DemoIndexMemberConfig = {
  userKey: string;
  permissions?: string[];
  prompt?: string;
  autoAssign?: boolean;
};

type DemoIndexDefinition = {
  key: string;
  title: string;
  prompt?: string;
  joinPolicy: 'anyone' | 'invite_only';
  invitationCode?: string;
  linkPermissions?: {
    permissions: string[];
    code: string;
  };
  members: DemoIndexMemberConfig[];
};

type SharedSourceInitializer =
  | {
      type: 'file';
      key: string;
      build: (user: DemoUserDefinition) => DemoFileDefinition;
    }
  | {
      type: 'link';
      key: string;
      build: (user: DemoUserDefinition) => DemoLinkDefinition;
    };

type CommonIntentDefinition = DemoIntentDefinition & {
  defaultSource?: SharedSourceInitializer;
};

const COMMON_INTENTS: CommonIntentDefinition[] = [
  {
    key: 'weekly-update',
    payload: 'Posting a weekly summary of high-signal introductions and product learnings with the demo network.',
    summary: 'Sharing weekly network update for collaborators.',
    defaultSource: {
      type: 'link',
      key: 'community-weekly',
      build: (user) => ({
        key: 'community-weekly',
        url: `https://example.com/${user.key}/weekly-update`,
        title: `${user.name.split(' ')[0]} Weekly Intent Digest`,
      }),
    },
  },
  {
    key: 'looking-for-intros',
    payload: 'Open to intros to AI teams piloting knowledge routing so we can compare pipelines and share ops playbooks.',
    summary: 'Requesting intros to AI teams testing knowledge routing.',
    defaultSource: {
      type: 'link',
      key: 'intros-tracker',
      build: (user) => ({
        key: 'intros-tracker',
        url: `https://example.com/${user.key}/intro-requests`,
        title: `${user.name.split(' ')[0]} Intro Tracker`,
      }),
    },
  },
  {
    key: 'offering-office-hours',
    payload: 'Hosting short office hours to review onboarding flows for founders scoping their first agent loops.',
    summary: 'Offering office hours on agent onboarding loops.',
    defaultSource: {
      type: 'file',
      key: 'office-hours-outline',
      build: (user) => ({
        key: 'office-hours-outline',
        name: `${user.name.split(' ')[0]} Office Hours Outline.md`,
        size: 35840,
        type: 'text/markdown',
      }),
    },
  },
];

const COMMON_INTENT_MAP = new Map(COMMON_INTENTS.map((intent) => [intent.key, intent] as const));

type DemoIntentDefinition = {
  key: string;
  payload: string;
  summary: string;
  source?: { type: 'file' | 'link'; key: string };
};

type DemoUserLoginHints = {
  accountName?: string;
  phoneNumber?: string;
  otpCode?: string;
};

type DemoFileDefinition = {
  key: string;
  name: string;
  size: number;
  type: string;
};

type DemoLinkDefinition = {
  key: string;
  url: string;
  title?: string;
};

type DemoUserDefinition = {
  key: string;
  email: string;
  name: string;
  intro: string;
  avatar: string;
  indexes: string[];
  intents: DemoIntentDefinition[];
  sharedIntentKeys?: string[];
  files?: DemoFileDefinition[];
  links?: DemoLinkDefinition[];
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

const QA_USER_KEYS = PRIVY_TEST_ACCOUNTS.map((account) => account.key);

const DEMO_INDEXES: DemoIndexDefinition[] = [
  {
    key: 'demo-network',
    title: 'Demo Discovery Network',
    prompt: 'Share what you are exploring so agents can surface relevant peers.',
    joinPolicy: 'anyone',
    linkPermissions: {
      permissions: ['can-discover', 'can-request'],
      code: 'demo-network',
    },
    members: [
      {
        userKey: 'avery',
        permissions: ['owner'],
        prompt: 'Post weekly demos, pilot wins, and onboarding learnings for the full network.',
        autoAssign: true,
      },
      {
        userKey: 'jordan',
        permissions: ['can-read-intents', 'can-write-intents', 'can-discover'],
        prompt: 'Share portfolio highlights, diligence notes, and requests for operator intros.',
        autoAssign: true,
      },
      {
        userKey: 'sasha',
        permissions: ['can-read-intents', 'can-write-intents', 'can-discover'],
        prompt: 'Log build updates, integration learnings, and blockers needing network help.',
        autoAssign: true,
      },
      ...QA_USER_KEYS.map((userKey) => ({
        userKey,
        permissions: ['can-read-intents', 'can-write-intents'],
        prompt: 'Record QA findings, login flows, and hand-off notes for demo operators.',
        autoAssign: false,
      })),
    ],
  },
  {
    key: 'operators-circle',
    title: 'Operators Circle',
    prompt: 'Deep dive on intent routing experiments, data quality, and agent trust signals.',
    joinPolicy: 'invite_only',
    invitationCode: 'operators-circle',
    members: [
      {
        userKey: 'sasha',
        permissions: ['owner'],
        prompt: 'Capture engineering insights from pilot rollouts and MCP integrations.',
        autoAssign: true,
      },
      {
        userKey: 'avery',
        permissions: ['can-read-intents', 'can-write-intents', 'can-discover'],
        prompt: 'Summarize founder asks, partner meetings, and design partner wins.',
        autoAssign: true,
      },
      {
        userKey: 'jordan',
        permissions: ['can-read-intents', 'can-write-intents', 'can-discover'],
        prompt: 'Note capital allocation decisions and signal-strength observations.',
        autoAssign: true,
      },
    ],
  },
  {
    key: 'avery-pilot-hub',
    title: 'Pilot Founders Hub',
    prompt: 'Keep track of onboarding scripts, pilot readiness, and customer discovery wins.',
    joinPolicy: 'invite_only',
    invitationCode: 'avery-pilot-hub',
    members: [
      {
        userKey: 'avery',
        permissions: ['owner'],
        prompt: 'Auto-index capital asks, partner updates, and weekly pilots with operators.',
        autoAssign: true,
      },
      {
        userKey: 'sasha',
        permissions: ['can-read-intents', 'can-write-intents'],
        prompt: 'Log technical feedback from pilot builds and integration backlogs.',
        autoAssign: true,
      },
    ],
  },
  {
    key: 'jordan-syndicate',
    title: 'Signal Syndicate',
    prompt: 'Collect diligence notes, signal boosts, and intros for angel syndicate members.',
    joinPolicy: 'invite_only',
    invitationCode: 'jordan-syndicate',
    members: [
      {
        userKey: 'jordan',
        permissions: ['owner'],
        prompt: 'Auto-index investment theses, diligence calls, and follow-up asks.',
        autoAssign: true,
      },
      {
        userKey: 'avery',
        permissions: ['can-read-intents', 'can-write-intents'],
        prompt: 'Share founder pipeline updates and partnership needs.',
        autoAssign: true,
      },
    ],
  },
  {
    key: 'sasha-build-lab',
    title: 'Build Lab Sessions',
    prompt: 'Share integration checklists, release learnings, and office hour recaps.',
    joinPolicy: 'invite_only',
    invitationCode: 'sasha-build-lab',
    members: [
      {
        userKey: 'sasha',
        permissions: ['owner'],
        prompt: 'Auto-index product experiments, UX notes, and technical blockers.',
        autoAssign: true,
      },
      {
        userKey: 'avery',
        permissions: ['can-read-intents', 'can-write-intents'],
        prompt: 'Surface operator feedback requests needing engineering attention.',
        autoAssign: true,
      },
    ],
  },
];

const INDEX_DEFINITION_MAP = new Map(DEMO_INDEXES.map((index) => [index.key, index] as const));

const DEMO_USERS: DemoUserDefinition[] = [
  {
    key: 'avery',
    email: 'avery.demo@index.build',
    name: 'Avery Demo',
    intro: 'Founder building collaborative AI tooling and onboarding early operators.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=AveryDemo',
    indexes: ['demo-network', 'operators-circle', 'avery-pilot-hub', 'jordan-syndicate', 'sasha-build-lab'],
    sharedIntentKeys: ['weekly-update', 'offering-office-hours'],
    files: [
      {
        key: 'pitch-deck',
        name: 'Avery Demo Pitch Deck.pdf',
        size: 524288,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'workflow-article',
        url: 'https://example.com/avery-demo-workflow',
        title: 'Agent workflow teardown',
      },
    ],
    intents: [
      {
        key: 'ai-partnerships',
        payload: 'Looking to pair with ML researchers who want to ship copilots for strategic introductions between founders and investors.',
        summary: 'Seeking ML research partners for demo agent.',
        source: { type: 'file', key: 'pitch-deck' },
      },
      {
        key: 'capital',
        payload: 'Exploring a $500k seed extension from angels who understand agent routing and MCP integrations.',
        summary: 'Raising capital from angels focused on agent ecosystems.',
        source: { type: 'link', key: 'workflow-article' },
      },
    ],
  },
  {
    key: 'jordan',
    email: 'jordan.invests@index.build',
    name: 'Jordan Chen',
    intro: 'Angel investor backing infra teams solving high-signal discovery.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=JordanChen',
    indexes: ['demo-network', 'operators-circle', 'jordan-syndicate'],
    sharedIntentKeys: ['weekly-update', 'looking-for-intros'],
    files: [
      {
        key: 'portfolio-brief',
        name: 'Jordan Portfolio Brief.pdf',
        size: 409600,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'deal-memo',
        url: 'https://example.com/jordan-demo-memo',
        title: 'Deal memo template',
      },
    ],
    intents: [
      {
        key: 'invest-in-infra',
        payload: 'Deploying 100k-250k checks into founders aligning agents with verified network signals.',
        summary: 'Investing in network signal infrastructure founders.',
        source: { type: 'file', key: 'portfolio-brief' },
      },
      {
        key: 'portfolio-support',
        payload: 'Helping existing portfolio companies find design partners working on data-rich agent workflows.',
        summary: 'Supporting portfolio with agent design partners.',
        source: { type: 'link', key: 'deal-memo' },
      },
    ],
  },
  {
    key: 'sasha',
    email: 'sasha.builder@index.build',
    name: 'Sasha Patel',
    intro: 'Product engineer turning research notebooks into production-ready agent copilots.',
    avatar: 'https://api.dicebear.com/7.x/initials/svg?seed=SashaPatel',
    indexes: ['demo-network', 'operators-circle', 'avery-pilot-hub', 'sasha-build-lab'],
    sharedIntentKeys: ['weekly-update', 'offering-office-hours', 'looking-for-intros'],
    files: [
      {
        key: 'integration-playbook',
        name: 'Sasha Integration Playbook.md',
        size: 102400,
        type: 'text/markdown',
      },
    ],
    links: [
      {
        key: 'prototype-notion',
        url: 'https://example.com/sasha-demo-notion',
        title: 'Prototype notes',
      },
    ],
    intents: [
      {
        key: 'customer-discovery',
        payload: 'Looking for GTM leaders testing intent indexing so we can co-build the first automation loops.',
        summary: 'Hunting for GTM design partners for agent loops.',
        source: { type: 'link', key: 'prototype-notion' },
      },
      {
        key: 'infra-collab',
        payload: 'Want to team up with data infra folks who can power fast embeddings for context brokers.',
        summary: 'Collaborating with data infra partners for context brokers.',
        source: { type: 'file', key: 'integration-playbook' },
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
    sharedIntentKeys: ['weekly-update'],
    links: [
      {
        key: `${account.key}-profile`,
        url: `https://example.com/demo/${account.key}`,
      },
    ],
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
  const invitationCode = def.invitationCode ?? `${def.key}-invite`;
  const permissionsPayload = {
    joinPolicy: def.joinPolicy,
    invitationLink: def.joinPolicy === 'invite_only' ? { code: invitationCode } : null,
    allowGuestVibeCheck: false,
  };

  const insertColumns = ['"id"', '"title"', '"permissions"'];
  const insertValues = [sql`${indexId}`, sql`${def.title}`, sql`${JSON.stringify(permissionsPayload)}::json`];

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

  const updateAssignments = [
    sql`"title" = ${def.title}`,
    sql`"permissions" = ${JSON.stringify(permissionsPayload)}::json`,
    sql.raw('"updated_at" = NOW()'),
  ];

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

async function upsertFile(userId: string, userKey: string, def: DemoFileDefinition): Promise<string> {
  const fileId = stableId(`file:${userKey}:${def.key}`);
  const now = new Date();
  const sizeValue = BigInt(def.size);

  try {
    await db.insert(files).values({
      id: fileId,
      name: def.name,
      size: sizeValue,
      type: def.type,
      userId,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(files)
      .set({ name: def.name, size: sizeValue, type: def.type, userId, updatedAt: now })
      .where(eq(files.id, fileId));
  }

  return fileId;
}

async function upsertLink(userId: string, userKey: string, def: DemoLinkDefinition): Promise<string> {
  const linkId = stableId(`link:${userKey}:${def.key}`);
  const now = new Date();

  try {
    await db.insert(indexLinks).values({
      id: linkId,
      userId,
      url: def.url,
      lastStatus: 'seeded-demo',
      lastSyncAt: now,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(indexLinks)
      .set({ url: def.url, userId, lastStatus: 'seeded-demo', lastSyncAt: now, updatedAt: now })
      .where(eq(indexLinks.id, linkId));
  }

  return linkId;
}

async function findExistingAgent(): Promise<string | null> {
  const agentId = stableId(`agent:${DEMO_AGENT.key}`);
  const result = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  return result[0].id;
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

type MembershipOptions = {
  permissions?: string[];
  prompt?: string | null;
  autoAssign?: boolean;
};

function buildTextArray(values: string[]) {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }

  const joined = sql.join(values.map((value) => sql`${value}`), sql`, `);
  return sql`ARRAY[${joined}]::text[]`;
}

async function ensureIndexMembership(indexId: string, userId: string, options?: MembershipOptions): Promise<void> {
  const capabilities = await getSchemaCapabilities();
  const permissionsList = options?.permissions ?? ['can-read-intents', 'can-write-intents', 'can-discover'];
  const permissionsArray = buildTextArray(permissionsList);
  const promptValue = options?.prompt ?? null;
  const autoAssignValue = options?.autoAssign ?? true;

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
      insertValues.push(promptValue !== null ? sql`${promptValue}` : sql.raw('NULL'));
    }

    if (capabilities.indexMembersHasAutoAssign) {
      insertColumns.push('"auto_assign"');
      insertValues.push(autoAssignValue ? sql`TRUE` : sql`FALSE`);
    }

    await db.execute(sql`
      INSERT INTO "index_members" (${sql.raw(insertColumns.join(', '))})
      VALUES (${sql.join(insertValues, sql`, `)})
    `);
    return;
  }

  const updateAssignments = [sql`"permissions" = ${permissionsArray}`, sql.raw('"updated_at" = NOW()')];

  if (capabilities.indexMembersHasPrompt) {
    updateAssignments.push(promptValue !== null ? sql`"prompt" = ${promptValue}` : sql`"prompt" = NULL`);
  }

  if (capabilities.indexMembersHasAutoAssign) {
    updateAssignments.push(autoAssignValue ? sql`"auto_assign" = TRUE` : sql`"auto_assign" = FALSE`);
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
  userKey: string,
  source?: { sourceId?: string | null; sourceType?: 'file' | 'link' }
): Promise<string> {
  const intentId = stableId(`intent:${userKey}:${def.key}`);
  const now = new Date();
  const sourcePayload = {
    sourceId: source?.sourceId ?? null,
    sourceType: source?.sourceType ?? null,
  } as const;

  try {
    await db.insert(intents).values({
      id: intentId,
      payload: def.payload,
      summary: def.summary,
      userId,
      ...sourcePayload,
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await db
      .update(intents)
      .set({ payload: def.payload, summary: def.summary, updatedAt: now, ...sourcePayload })
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

  const agentId = await findExistingAgent();
  const intentMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const fileIdMap = new Map<string, string>();
  const linkIdMap = new Map<string, string>();
  const seededUsers: SeededUser[] = [];
  let fileCount = 0;
  let linkCount = 0;
  let intentCount = 0;

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

    const indexIds: string[] = [];

    for (const indexKey of userDef.indexes) {
      const indexId = indexMap.get(indexKey);
      if (!indexId) continue;
      indexIds.push(indexId);

      const indexDef = INDEX_DEFINITION_MAP.get(indexKey);
      const memberConfig = indexDef?.members.find((member) => member.userKey === userDef.key);
      const membershipOptions: MembershipOptions = {};

      if (memberConfig?.permissions) {
        membershipOptions.permissions = memberConfig.permissions;
      }
      if (memberConfig?.prompt !== undefined) {
        membershipOptions.prompt = memberConfig.prompt ?? null;
      }
      if (memberConfig?.autoAssign !== undefined) {
        membershipOptions.autoAssign = memberConfig.autoAssign;
      }

      await ensureIndexMembership(indexId, user.id, membershipOptions);
    }

    const fileDefsMap = new Map<string, DemoFileDefinition>();
    const linkDefsMap = new Map<string, DemoLinkDefinition>();

    for (const fileDef of userDef.files ?? []) {
      fileDefsMap.set(fileDef.key, fileDef);
    }

    for (const linkDef of userDef.links ?? []) {
      linkDefsMap.set(linkDef.key, linkDef);
    }

    if (userDef.sharedIntentKeys) {
      for (const sharedKey of userDef.sharedIntentKeys) {
        const sharedIntent = COMMON_INTENT_MAP.get(sharedKey);
        if (!sharedIntent?.defaultSource) continue;

        if (sharedIntent.defaultSource.type === 'file') {
          if (!fileDefsMap.has(sharedIntent.defaultSource.key)) {
            fileDefsMap.set(sharedIntent.defaultSource.key, sharedIntent.defaultSource.build(userDef));
          }
        } else if (sharedIntent.defaultSource.type === 'link') {
          if (!linkDefsMap.has(sharedIntent.defaultSource.key)) {
            linkDefsMap.set(sharedIntent.defaultSource.key, sharedIntent.defaultSource.build(userDef));
          }
        }
      }
    }

    const fileDefs = Array.from(fileDefsMap.values());
    const linkDefs = Array.from(linkDefsMap.values());

    for (const fileDef of fileDefs) {
      const fileId = await upsertFile(user.id, userDef.key, fileDef);
      fileIdMap.set(`${userDef.key}:${fileDef.key}`, fileId);
      fileCount += 1;
    }

    for (const linkDef of linkDefs) {
      const linkId = await upsertLink(user.id, userDef.key, linkDef);
      linkIdMap.set(`${userDef.key}:${linkDef.key}`, linkId);
      linkCount += 1;
    }

    const combinedIntentDefs: DemoIntentDefinition[] = [];
    const seenIntentKeys = new Set<string>();

    for (const intentDef of userDef.intents) {
      if (seenIntentKeys.has(intentDef.key)) continue;
      combinedIntentDefs.push(intentDef);
      seenIntentKeys.add(intentDef.key);
    }

    if (userDef.sharedIntentKeys) {
      for (const sharedKey of userDef.sharedIntentKeys) {
        if (seenIntentKeys.has(sharedKey)) continue;
        const sharedIntent = COMMON_INTENT_MAP.get(sharedKey);
        if (!sharedIntent) continue;
        const sharedIntentCopy: DemoIntentDefinition = {
          key: sharedIntent.key,
          payload: sharedIntent.payload,
          summary: sharedIntent.summary,
          source: sharedIntent.defaultSource
            ? { type: sharedIntent.defaultSource.type, key: sharedIntent.defaultSource.key }
            : sharedIntent.source,
        };

        combinedIntentDefs.push(sharedIntentCopy);
        seenIntentKeys.add(sharedKey);
      }
    }

    for (const intentDef of combinedIntentDefs) {
      let source: { sourceId?: string | null; sourceType?: 'file' | 'link' } | undefined;
      if (intentDef.source) {
        const resourceKey = `${userDef.key}:${intentDef.source.key}`;
        if (intentDef.source.type === 'file') {
          const sourceId = fileIdMap.get(resourceKey);
          if (sourceId) {
            source = { sourceId, sourceType: 'file' };
          }
        } else if (intentDef.source.type === 'link') {
          const sourceId = linkIdMap.get(resourceKey);
          if (sourceId) {
            source = { sourceId, sourceType: 'link' };
          }
        }
      }

      const intentId = await upsertIntent(user.id, intentDef, indexIds, userDef.key, source);
      intentMap.set(`${userDef.key}:${intentDef.key}`, intentId);
      intentCount += 1;
    }
  }

  if (agentId) {
    for (const stakeDef of DEMO_STAKES) {
      await upsertIntentStake(agentId, stakeDef, intentMap);
    }
  }

  await upsertConnectionEvents(DEMO_CONNECTION_EVENTS, userIdMap);

  return {
    users: seededUsers,
    indexIds: Array.from(indexMap.values()),
    agentId,
    fileCount,
    linkCount,
    intentCount,
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
      console.log(`- Intents: ${result.intentCount}`);
      console.log(`- Files: ${result.fileCount}`);
      console.log(`- Links: ${result.linkCount}`);
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
