#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { v5 as uuidv5 } from 'uuid';
import { eq, and, sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/db';
import { privyClient } from '../lib/privy';
import { initializeBrokers, triggerBrokersOnIntentCreated } from '../agents/context_brokers/connector';
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
  withBrokers?: boolean;
  concurrency?: number;
  bulkInserts?: boolean;
  fastSeed?: boolean;
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

type Logger = {
  info: (message: string) => void;
};

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  logger: Logger
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  let cursor = 0;

  const workers = new Array(effectiveLimit).fill(null).map(async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      try {
        await worker(items[currentIndex], currentIndex);
      } catch (error) {
        logger.info(
          `⚠️ Broker worker failed on item ${currentIndex}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  });

  await Promise.all(workers);
}

function generateMockEmbedding(seed: string): number[] {
  const length = 3072;
  const embedding = new Array<number>(length);
  let hash = 2166136261 ^ seed.length;

  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let i = 0; i < length; i += 1) {
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 1274126177);
    hash ^= hash >>> 16;
    embedding[i] = ((hash >>> 0) % 2000) / 1000 - 1; // [-1, 1)
  }

  return embedding;
}

const DEMO_NAMESPACE = uuidv5('protocol-demo-seed', uuidv5.URL);

function stableId(label: string): string {
  return uuidv5(label, DEMO_NAMESPACE);
}

function createLogger(opts: CliOptions): Logger {
  const output = opts.json ? console.error : console.log;
  return {
    info: (message: string) => {
      if (opts.silent) return;
      output(message);
    },
  };
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
  defaultIndexKeys?: string[];
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
    defaultIndexKeys: ['demo-everything', 'network-lounge'],
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
    defaultIndexKeys: ['demo-everything', 'network-lounge', 'deal-room'],
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
    defaultIndexKeys: ['demo-everything', 'network-lounge', 'support-huddle'],
  },
  {
    key: 'network-sync',
    payload: 'Scheduling a cross-team sync to align on priorities and unblock shared workstreams for the week.',
    summary: 'Coordinating this week’s cross-team sync.',
    defaultSource: {
      type: 'link',
      key: 'network-sync-agenda',
      build: (user) => ({
        key: 'network-sync-agenda',
        url: `https://example.com/${user.key}/network-sync-agenda`,
        title: `${user.name.split(' ')[0]} Network Sync Agenda`,
      }),
    },
    defaultIndexKeys: ['demo-everything', 'network-lounge'],
  },
  {
    key: 'growth-support-loop',
    payload: 'Sharing customer signals with growth so launch campaigns reflect the latest support learnings.',
    summary: 'Keeping growth and support aligned on customer signals.',
    defaultSource: {
      type: 'file',
      key: 'growth-support-brief',
      build: (user) => ({
        key: 'growth-support-brief',
        name: `${user.name.split(' ')[0]} Growth Support Brief.pdf`,
        size: 256000,
        type: 'application/pdf',
      }),
    },
    defaultIndexKeys: ['demo-everything', 'growth-guild', 'support-huddle'],
  },
];

const COMMON_INTENT_MAP = new Map(COMMON_INTENTS.map((intent) => [intent.key, intent] as const));

type DemoIntentDefinition = {
  key: string;
  payload: string;
  summary: string;
  source?: { type: 'file' | 'link'; key: string };
  indexKeys?: string[];
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

type UserDetail = {
  intro: string;
  avatarSeed?: string;
  indexes: string[];
  indexSettings: Record<string, Omit<DemoIndexMemberConfig, 'userKey'>>;
  intents: DemoIntentDefinition[];
  sharedIntentKeys?: string[];
  files?: DemoFileDefinition[];
  links?: DemoLinkDefinition[];
};

const QA_USER_DETAILS: Record<string, UserDetail> = {
  'test-account-1': {
    intro: 'Community lead coordinating the lounge and pairing members for support.',
    avatarSeed: 'Casey Harper',
    indexes: ['demo-everything', 'network-lounge', 'deal-room', 'support-huddle'],
    indexSettings: {
      'demo-everything': {
        permissions: ['owner'],
        prompt: 'Broadcast anything that could help others route support or collaborations.',
        autoAssign: true,
      },
      'network-lounge': {
        permissions: ['owner'],
        prompt: 'Curate weekly recaps and highlight collaboration asks for the lounge.',
        autoAssign: false,
      },
      'deal-room': {
        prompt: 'Share investor-ready founder updates for the syndicate to review.',
        autoAssign: false,
      },
      'support-huddle': {
        prompt: 'Escalate frontline blockers and capture next actions.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'casey-weekly-brief',
        name: 'Casey Weekly Brief.pdf',
        size: 512000,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'casey-talent-sheet',
        url: 'https://example.com/casey/talent-sheet',
        title: 'Talent Pairing Sheet',
      },
    ],
    intents: [
      {
        key: 'community-update',
        payload: 'Posting the lounge recap covering new wins, open asks, and introductions needed this week.',
        summary: 'Weekly lounge recap with wins and asks.',
        source: { type: 'file', key: 'casey-weekly-brief' },
        indexKeys: ['demo-everything', 'network-lounge'],
      },
      {
        key: 'talent-pairing',
        payload: 'Coordinating support pairings between builders needing help and operators volunteering time.',
        summary: 'Coordinating network talent pairings.',
        source: { type: 'link', key: 'casey-talent-sheet' },
        indexKeys: ['demo-everything', 'network-lounge', 'support-huddle'],
      },
    ],
    sharedIntentKeys: ['weekly-update', 'offering-office-hours', 'network-sync'],
  },
  'test-account-2': {
    intro: 'Investor operator bridging the syndicate with builders who need capital.',
    avatarSeed: 'Devon Brooks',
    indexes: ['demo-everything', 'network-lounge', 'deal-room'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Surface investment questions and follow-ups for anyone able to help.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Share investor lens on intros and resource asks coming through the lounge.',
        autoAssign: false,
      },
      'deal-room': {
        permissions: ['owner'],
        prompt: 'Collect diligence signals and prep notes before syndicate calls.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'devon-syndicate-pipeline',
        name: 'Devon Syndicate Pipeline.pdf',
        size: 480000,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'devon-diligence-notes',
        url: 'https://example.com/devon/diligence-notes',
        title: 'Diligence Notes Board',
      },
    ],
    intents: [
      {
        key: 'syndicate-pipeline',
        payload: 'Tracking active deals that need operator insight before next syndicate sync.',
        summary: 'Active deals requiring operator insight.',
        source: { type: 'file', key: 'devon-syndicate-pipeline' },
        indexKeys: ['demo-everything', 'deal-room'],
      },
      {
        key: 'due-diligence',
        payload: 'Requesting product deep dives from builders ahead of diligence reviews next week.',
        summary: 'Requests for diligence deep dives.',
        source: { type: 'link', key: 'devon-diligence-notes' },
        indexKeys: ['demo-everything', 'deal-room', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['looking-for-intros', 'network-sync'],
  },
  'test-account-3': {
    intro: 'Release manager keeping Build Lab prototypes production-ready.',
    avatarSeed: 'Morgan Li',
    indexes: ['demo-everything', 'network-lounge', 'build-lab'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Flag release work or blockers anyone in the network should see.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Share build milestones and blockers that need broader support.',
        autoAssign: false,
      },
      'build-lab': {
        permissions: ['owner'],
        prompt: 'Track release trains, QA signoffs, and integration tasks.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'morgan-release-checklist',
        name: 'Morgan Release Checklist.md',
        size: 102400,
        type: 'text/markdown',
      },
    ],
    links: [
      {
        key: 'morgan-integration-playbook',
        url: 'https://example.com/morgan/integration-playbook',
        title: 'Integration Playbook',
      },
    ],
    intents: [
      {
        key: 'release-checklist',
        payload: 'Outlining the build lab release checklist for the upcoming deploy window.',
        summary: 'Upcoming release checklist items.',
        source: { type: 'file', key: 'morgan-release-checklist' },
        indexKeys: ['demo-everything', 'build-lab'],
      },
      {
        key: 'integration-help',
        payload: 'Flagging integrations that need review from data and infra partners.',
        summary: 'Integration work requiring reviews.',
        source: { type: 'link', key: 'morgan-integration-playbook' },
        indexKeys: ['demo-everything', 'build-lab', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['offering-office-hours', 'network-sync'],
  },
  'test-account-4': {
    intro: 'Product designer capturing beta feedback to inform the build roadmap.',
    avatarSeed: 'Riley Nguyen',
    indexes: ['demo-everything', 'network-lounge', 'build-lab'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Highlight beta learnings the whole network should be aware of.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Surface UX learnings that impact product priorities.',
        autoAssign: false,
      },
      'build-lab': {
        prompt: 'Document beta feedback and polish tasks for build lab sessions.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'riley-beta-feedback',
        name: 'Riley Beta Feedback.pdf',
        size: 268000,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'riley-ux-research',
        url: 'https://example.com/riley/ux-research-board',
        title: 'UX Research Board',
      },
    ],
    intents: [
      {
        key: 'beta-requests',
        payload: 'Logging tester requests that need engineering follow-up before the next release.',
        summary: 'Tester requests requiring engineering support.',
        source: { type: 'file', key: 'riley-beta-feedback' },
        indexKeys: ['demo-everything', 'build-lab'],
      },
      {
        key: 'ux-feedback',
        payload: 'Highlighting UX findings that should influence upcoming sprints.',
        summary: 'UX findings for sprint planning.',
        source: { type: 'link', key: 'riley-ux-research' },
        indexKeys: ['demo-everything', 'build-lab', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['weekly-update', 'network-sync'],
  },
  'test-account-5': {
    intro: 'Recruiting partner aligning hiring needs with growth experiments.',
    avatarSeed: 'Taylor Singh',
    indexes: ['demo-everything', 'network-lounge', 'growth-guild', 'support-huddle'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Share hiring signals with the network for broader amplification.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Highlight hiring wins and requests coming from across the lounge.',
        autoAssign: false,
      },
      'growth-guild': {
        prompt: 'Coordinate campaigns needing talent support and onboarding.',
        autoAssign: false,
      },
      'support-huddle': {
        prompt: 'Share candidate experience insights from support conversations.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'taylor-talent-roster',
        name: 'Taylor Talent Roster.csv',
        size: 204800,
        type: 'text/csv',
      },
    ],
    links: [
      {
        key: 'taylor-hiring-tracker',
        url: 'https://example.com/taylor/hiring-tracker',
        title: 'Hiring Tracker',
      },
    ],
    intents: [
      {
        key: 'talent-roster',
        payload: 'Updating the roster of candidates matched with current growth initiatives.',
        summary: 'Talent roster updates tied to growth work.',
        source: { type: 'file', key: 'taylor-talent-roster' },
        indexKeys: ['demo-everything', 'growth-guild'],
      },
      {
        key: 'hiring-needs',
        payload: 'Listing open roles that need referrals before the next campaign sprint.',
        summary: 'Open hiring needs and referral requests.',
        source: { type: 'link', key: 'taylor-hiring-tracker' },
        indexKeys: ['demo-everything', 'growth-guild', 'support-huddle'],
      },
    ],
    sharedIntentKeys: ['weekly-update', 'growth-support-loop', 'network-sync'],
  },
  'test-account-6': {
    intro: 'Data engineer keeping infra healthy for fast experimentation.',
    avatarSeed: 'Quinn Ramirez',
    indexes: ['demo-everything', 'network-lounge', 'build-lab'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Broadcast critical infra updates to all collaborators.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Post data health updates and tooling needs to unblock others.',
        autoAssign: false,
      },
      'build-lab': {
        prompt: 'Document infra rollouts and dataset refresh status.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'quinn-data-audit',
        name: 'Quinn Data Audit.xlsx',
        size: 350000,
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    ],
    links: [
      {
        key: 'quinn-infra-plan',
        url: 'https://example.com/quinn/infra-plan',
        title: 'Infra Planning Notes',
      },
    ],
    intents: [
      {
        key: 'data-audit',
        payload: 'Sharing the latest data health audit and highlighting tables needing fixes.',
        summary: 'Recent data audit findings.',
        source: { type: 'file', key: 'quinn-data-audit' },
        indexKeys: ['demo-everything', 'build-lab'],
      },
      {
        key: 'infra-planning',
        payload: 'Coordinating infra upgrades that impact upcoming build lab releases.',
        summary: 'Infra planning tasks tied to releases.',
        source: { type: 'link', key: 'quinn-infra-plan' },
        indexKeys: ['demo-everything', 'build-lab', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['offering-office-hours', 'network-sync'],
  },
  'test-account-7': {
    intro: 'Operations partner ensuring investor follow-ups stay on track.',
    avatarSeed: 'Emerson Blake',
    indexes: ['demo-everything', 'network-lounge', 'deal-room'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Raise ops cadences and reminders network-wide.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Raise operating cadences and process experiments for the group.',
        autoAssign: false,
      },
      'deal-room': {
        prompt: 'Track readiness steps for deals moving through the syndicate.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'emerson-ops-dashboard',
        name: 'Emerson Ops Dashboard.pdf',
        size: 300000,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'emerson-process-playbook',
        url: 'https://example.com/emerson/process-playbook',
        title: 'Ops Process Playbook',
      },
    ],
    intents: [
      {
        key: 'ops-dashboards',
        payload: 'Posting the updated ops dashboard with follow-up owners for each deal.',
        summary: 'Ops dashboard updates with owners.',
        source: { type: 'file', key: 'emerson-ops-dashboard' },
        indexKeys: ['demo-everything', 'deal-room'],
      },
      {
        key: 'process-improvements',
        payload: 'Capturing process tweaks that reduce handoff time between investors and builders.',
        summary: 'Process improvements for handoffs.',
        source: { type: 'link', key: 'emerson-process-playbook' },
        indexKeys: ['demo-everything', 'deal-room', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['looking-for-intros', 'network-sync'],
  },
  'test-account-8': {
    intro: 'Growth lead running experiments and aligning launch plans.',
    avatarSeed: 'Peyton Alvarez',
    indexes: ['demo-everything', 'network-lounge', 'growth-guild'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Share growth signals that could inspire other teams.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Share growth experiments seeking collaborators from other teams.',
        autoAssign: false,
      },
      'growth-guild': {
        permissions: ['owner'],
        prompt: 'Gather launch metrics, creative needs, and go-to-market updates.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'peyton-growth-experiments',
        name: 'Peyton Growth Experiments.csv',
        size: 230000,
        type: 'text/csv',
      },
    ],
    links: [
      {
        key: 'peyton-launch-plan',
        url: 'https://example.com/peyton/launch-plan',
        title: 'Launch Plan',
      },
    ],
    intents: [
      {
        key: 'growth-experiments',
        payload: 'Listing experiments in-flight and the metrics we need help instrumenting.',
        summary: 'Growth experiments seeking support.',
        source: { type: 'file', key: 'peyton-growth-experiments' },
        indexKeys: ['demo-everything', 'growth-guild'],
      },
      {
        key: 'launch-plan',
        payload: 'Coordinating the upcoming launch plan and partner content timeline.',
        summary: 'Launch plan coordination notes.',
        source: { type: 'link', key: 'peyton-launch-plan' },
        indexKeys: ['demo-everything', 'growth-guild', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['weekly-update', 'growth-support-loop', 'network-sync'],
  },
  'test-account-9': {
    intro: 'Support lead surfacing customer signals back to the team.',
    avatarSeed: 'Sydney Clarke',
    indexes: ['demo-everything', 'network-lounge', 'growth-guild', 'support-huddle'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Share support insights that might trigger network follow-ups.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Broadcast support trends that impact roadmaps.',
        autoAssign: false,
      },
      'growth-guild': {
        prompt: 'Share customer insights that fuel retention campaigns.',
        autoAssign: false,
      },
      'support-huddle': {
        permissions: ['owner'],
        prompt: 'Coordinate frontline response plans and FAQ refreshes.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'sydney-support-trends',
        name: 'Sydney Support Trends.pdf',
        size: 275000,
        type: 'application/pdf',
      },
    ],
    links: [
      {
        key: 'sydney-faq-updates',
        url: 'https://example.com/sydney/faq-updates',
        title: 'FAQ Updates',
      },
    ],
    intents: [
      {
        key: 'support-trends',
        payload: 'Summarizing trending support topics and the features they touch.',
        summary: 'Trending support topics summary.',
        source: { type: 'file', key: 'sydney-support-trends' },
        indexKeys: ['demo-everything', 'support-huddle'],
      },
      {
        key: 'faq-refresh',
        payload: 'Tracking FAQ updates needed before the next product launch.',
        summary: 'FAQ updates needed for launch.',
        source: { type: 'link', key: 'sydney-faq-updates' },
        indexKeys: ['demo-everything', 'support-huddle', 'growth-guild'],
      },
    ],
    sharedIntentKeys: ['offering-office-hours', 'growth-support-loop', 'network-sync'],
  },
  'test-account-10': {
    intro: 'Platform engineer coordinating refactors and integration timelines.',
    avatarSeed: 'Hayden Moore',
    indexes: ['demo-everything', 'network-lounge', 'build-lab'],
    indexSettings: {
      'demo-everything': {
        prompt: 'Share integration status network-wide to align dependencies.',
        autoAssign: true,
      },
      'network-lounge': {
        prompt: 'Post integration status and blockers that need cross-team help.',
        autoAssign: false,
      },
      'build-lab': {
        prompt: 'Outline refactor milestones and dependencies for the build lab.',
        autoAssign: false,
      },
    },
    files: [
      {
        key: 'hayden-refactor-plan',
        name: 'Hayden Refactor Plan.md',
        size: 128000,
        type: 'text/markdown',
      },
    ],
    links: [
      {
        key: 'hayden-integration-pipeline',
        url: 'https://example.com/hayden/integration-pipeline',
        title: 'Integration Pipeline',
      },
    ],
    intents: [
      {
        key: 'refactor-plan',
        payload: 'Detailing the refactor phases and reviewers needed this sprint.',
        summary: 'Refactor phases and reviewer needs.',
        source: { type: 'file', key: 'hayden-refactor-plan' },
        indexKeys: ['demo-everything', 'build-lab'],
      },
      {
        key: 'integration-pipeline',
        payload: 'Coordinating integration rollout dates across build lab partners.',
        summary: 'Integration rollout coordination.',
        source: { type: 'link', key: 'hayden-integration-pipeline' },
        indexKeys: ['demo-everything', 'build-lab', 'network-lounge'],
      },
    ],
    sharedIntentKeys: ['looking-for-intros', 'network-sync'],
  },
};

const INDEX_CONFIGS: Array<{
  key: string;
  title: string;
  prompt: string;
  joinPolicy: 'anyone' | 'invite_only';
  invitationCode?: string;
  linkPermissions?: DemoIndexDefinition['linkPermissions'];
}> = [
  {
    key: 'demo-everything',
    title: 'Demo Network Feed',
    prompt: 'Share everything you are working on so the network can find relevant collaborators.',
    joinPolicy: 'anyone',
  },
  {
    key: 'network-lounge',
    title: 'Network Lounge',
    prompt: 'Share cross-team updates and collaboration opportunities for the full demo network.',
    joinPolicy: 'anyone',
    linkPermissions: {
      permissions: ['can-discover', 'can-request'],
      code: 'network-lounge',
    },
  },
  {
    key: 'deal-room',
    title: 'Deal Room',
    prompt: 'Coordinate diligence notes and investor follow-ups.',
    joinPolicy: 'invite_only',
    invitationCode: 'deal-room',
  },
  {
    key: 'build-lab',
    title: 'Build Lab',
    prompt: 'Keep release trains aligned across engineering, design, and data.',
    joinPolicy: 'invite_only',
    invitationCode: 'build-lab',
  },
  {
    key: 'growth-guild',
    title: 'Growth Guild',
    prompt: 'Sync on launch plans, campaigns, and retention experiments.',
    joinPolicy: 'invite_only',
    invitationCode: 'growth-guild',
  },
  {
    key: 'support-huddle',
    title: 'Support Huddle',
    prompt: 'Share frontline learnings and coordinate answers for customers.',
    joinPolicy: 'invite_only',
    invitationCode: 'support-huddle',
  },
];

const DEMO_INDEXES: DemoIndexDefinition[] = INDEX_CONFIGS.map((config) => {
  const members: DemoIndexMemberConfig[] = QA_USER_KEYS.flatMap((userKey) => {
    const detail = QA_USER_DETAILS[userKey];
    if (!detail || !detail.indexes.includes(config.key)) return [];
    const settings = detail.indexSettings[config.key] ?? {};
    return [
      {
        userKey,
        permissions: settings.permissions,
        prompt: settings.prompt,
        autoAssign: settings.autoAssign,
      },
    ];
  });

  return {
    key: config.key,
    title: config.title,
    prompt: config.prompt,
    joinPolicy: config.joinPolicy,
    invitationCode: config.invitationCode,
    linkPermissions: config.linkPermissions,
    members,
  };
});

const INDEX_DEFINITION_MAP = new Map(DEMO_INDEXES.map((index) => [index.key, index] as const));

const DEMO_USERS: DemoUserDefinition[] = PRIVY_TEST_ACCOUNTS.map((account) => {
  const detail = QA_USER_DETAILS[account.key];
  if (!detail) {
    throw new Error(`Missing user detail for ${account.key}`);
  }

  return {
    key: account.key,
    email: account.email,
    name: account.accountName,
    intro: detail.intro,
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(detail.avatarSeed ?? account.accountName)}`,
    indexes: detail.indexes,
    intents: detail.intents,
    sharedIntentKeys: detail.sharedIntentKeys,
    files: detail.files ?? [],
    links: detail.links ?? [],
    loginHints: {
      accountName: account.accountName,
      phoneNumber: account.phoneNumber,
      otpCode: account.otpCode,
    },
  };
});

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
    key: 'casey-devon',
    intents: [
      { userKey: 'test-account-1', intentKey: 'community-update' },
      { userKey: 'test-account-2', intentKey: 'syndicate-pipeline' },
    ],
    stake: '180',
    reasoning: 'Casey’s lounge recap feeds directly into Devon’s syndicate pipeline decisions.',
  },
  {
    key: 'morgan-hayden',
    intents: [
      { userKey: 'test-account-3', intentKey: 'release-checklist' },
      { userKey: 'test-account-10', intentKey: 'refactor-plan' },
    ],
    stake: '140',
    reasoning: 'Build Lab releases depend on Morgan and Hayden coordinating refactor milestones.',
  },
  {
    key: 'peyton-taylor',
    intents: [
      { userKey: 'test-account-8', intentKey: 'growth-experiments' },
      { userKey: 'test-account-5', intentKey: 'hiring-needs' },
    ],
    stake: '120',
    reasoning: 'Peyton’s campaigns require Taylor to staff key roles to hit launch goals.',
  },
  {
    key: 'sydney-casey',
    intents: [
      { userKey: 'test-account-9', intentKey: 'support-trends' },
      { userKey: 'test-account-1', intentKey: 'talent-pairing' },
    ],
    stake: '110',
    reasoning: 'Support trends inform Casey’s talent pairing to cover frontline needs.',
  },
  {
    key: 'devon-emerson',
    intents: [
      { userKey: 'test-account-2', intentKey: 'due-diligence' },
      { userKey: 'test-account-7', intentKey: 'ops-dashboards' },
    ],
    stake: '100',
    reasoning: 'Devon relies on Emerson’s ops dashboards to keep diligence follow-ups on track.',
  },
  {
    key: 'quinn-morgan',
    intents: [
      { userKey: 'test-account-6', intentKey: 'infra-planning' },
      { userKey: 'test-account-3', intentKey: 'integration-help' },
    ],
    stake: '130',
    reasoning: 'Morgan’s integration work depends on Quinn’s infra planning staying ahead.',
  },
  {
    key: 'peyton-sydney',
    intents: [
      { userKey: 'test-account-8', intentKey: 'launch-plan' },
      { userKey: 'test-account-9', intentKey: 'faq-refresh' },
    ],
    stake: '105',
    reasoning: 'Sydney’s FAQ refresh keeps Peyton’s launch plan aligned with customer messaging.',
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
    key: 'casey-request-devon',
    initiator: 'test-account-1',
    receiver: 'test-account-2',
    type: 'REQUEST',
    occurredAt: '2024-08-05T15:00:00.000Z',
  },
  {
    key: 'devon-accept-casey',
    initiator: 'test-account-2',
    receiver: 'test-account-1',
    type: 'ACCEPT',
    occurredAt: '2024-08-06T10:30:00.000Z',
  },
  {
    key: 'morgan-request-hayden',
    initiator: 'test-account-3',
    receiver: 'test-account-10',
    type: 'REQUEST',
    occurredAt: '2024-08-04T09:45:00.000Z',
  },
  {
    key: 'hayden-accept-morgan',
    initiator: 'test-account-10',
    receiver: 'test-account-3',
    type: 'ACCEPT',
    occurredAt: '2024-08-04T13:10:00.000Z',
  },
  {
    key: 'peyton-request-taylor',
    initiator: 'test-account-8',
    receiver: 'test-account-5',
    type: 'REQUEST',
    occurredAt: '2024-08-02T17:20:00.000Z',
  },
  {
    key: 'taylor-decline-peyton',
    initiator: 'test-account-5',
    receiver: 'test-account-8',
    type: 'DECLINE',
    occurredAt: '2024-08-03T08:55:00.000Z',
  },
  {
    key: 'peyton-request-quinn',
    initiator: 'test-account-8',
    receiver: 'test-account-6',
    type: 'REQUEST',
    occurredAt: '2024-08-07T12:40:00.000Z',
  },
  {
    key: 'sydney-request-peyton',
    initiator: 'test-account-9',
    receiver: 'test-account-8',
    type: 'REQUEST',
    occurredAt: '2024-08-07T13:15:00.000Z',
  },
  {
    key: 'hayden-request-casey',
    initiator: 'test-account-10',
    receiver: 'test-account-1',
    type: 'REQUEST',
    occurredAt: '2024-08-06T18:05:00.000Z',
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

async function upsertIndex(def: typeof DEMO_INDEXES[number], logger: Logger): Promise<string> {
  logger.info(`🏛️ Ensuring index ${def.title}`);
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

async function upsertFile(userId: string, userKey: string, def: DemoFileDefinition, logger: Logger): Promise<string> {
  logger.info(`📄 Attaching file ${def.name} for ${userKey}`);
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

async function upsertLink(userId: string, userKey: string, def: DemoLinkDefinition, logger: Logger): Promise<string> {
  logger.info(`🔗 Attaching link ${def.url} for ${userKey}`);
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

async function upsertFilesForUser(
  userId: string,
  userKey: string,
  defs: DemoFileDefinition[],
  useBulk: boolean,
  logger: Logger
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (defs.length === 0) return result;

  if (useBulk && defs.length > 1) {
    const rows = defs.map((def) => ({
      key: def.key,
      id: stableId(`file:${userKey}:${def.key}`),
      name: def.name,
      size: BigInt(def.size),
      type: def.type,
    }));

    const valuesSql = sql.join(
      rows.map((row) => sql`(${row.id}, ${row.name}, ${row.size}, ${row.type}, ${userId})`),
      sql`, `
    );

    await db.execute(sql`
      INSERT INTO "files" ("id","name","size","type","user_id")
      VALUES ${valuesSql}
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "size" = EXCLUDED."size",
        "type" = EXCLUDED."type",
        "user_id" = EXCLUDED."user_id",
        "updated_at" = NOW()
    `);

    rows.forEach((row) => result.set(row.key, row.id));
    logger.info(`📄 Bulk upserted ${rows.length} files for ${userKey}`);
    return result;
  }

  for (const def of defs) {
    const id = await upsertFile(userId, userKey, def, logger);
    result.set(def.key, id);
  }
  return result;
}

async function upsertLinksForUser(
  userId: string,
  userKey: string,
  defs: DemoLinkDefinition[],
  useBulk: boolean,
  logger: Logger
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (defs.length === 0) return result;

  if (useBulk && defs.length > 1) {
    const nowIso = new Date().toISOString();
    const rows = defs.map((def) => ({
      key: def.key,
      id: stableId(`link:${userKey}:${def.key}`),
      url: def.url,
    }));

    const valuesSql = sql.join(
      rows.map((row) => sql`(${row.id}, ${userId}, ${row.url}, ${'seeded-demo'}, ${nowIso})`),
      sql`, `
    );

    await db.execute(sql`
      INSERT INTO "links" ("id","user_id","url","last_status","last_sync_at")
      VALUES ${valuesSql}
      ON CONFLICT ("id") DO UPDATE SET
        "url" = EXCLUDED."url",
        "user_id" = EXCLUDED."user_id",
        "last_status" = EXCLUDED."last_status",
        "last_sync_at" = EXCLUDED."last_sync_at",
        "updated_at" = NOW()
    `);

    rows.forEach((row) => result.set(row.key, row.id));
    logger.info(`🔗 Bulk upserted ${rows.length} links for ${userKey}`);
    return result;
  }

  for (const def of defs) {
    const id = await upsertLink(userId, userKey, def, logger);
    result.set(def.key, id);
  }

  return result;
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
  const autoAssignValue = options?.autoAssign ?? false;

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

type UpsertIntentResult = {
  id: string;
  created: boolean;
};

async function upsertIntent(
  userId: string,
  def: DemoIntentDefinition,
  indexIds: string[],
  userKey: string,
  source: { sourceId?: string | null; sourceType?: 'file' | 'link' } | undefined,
  logger: Logger
): Promise<UpsertIntentResult> {
  logger.info(`📝 Upserting intent ${userKey}:${def.key}`);
  const intentId = stableId(`intent:${userKey}:${def.key}`);
  const now = new Date();
  const sourcePayload = {
    sourceId: source?.sourceId ?? null,
    sourceType: source?.sourceType ?? null,
  } as const;
  let created = false;

  try {
    await db.insert(intents).values({
      id: intentId,
      payload: def.payload,
      summary: def.summary,
      userId,
      ...sourcePayload,
    });
    created = true;
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

  return { id: intentId, created };
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

async function runSeed(
  logger: Logger,
  options: { triggerBrokers: boolean; concurrency: number; bulkInsert: boolean; fastSeed: boolean }
): Promise<SeedSummary> {
  const { triggerBrokers, concurrency, bulkInsert, fastSeed } = options;
  logger.info('🚀 Starting demo seed run');
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL must be set.');
  }
  if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) {
    throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set.');
  }

  const indexMap = new Map<string, string>();
  for (const indexDef of DEMO_INDEXES) {
    const indexId = await upsertIndex(indexDef, logger);
    indexMap.set(indexDef.key, indexId);
  }

  const agentId = await findExistingAgent();
  if (agentId) {
    logger.info('🤖 Found existing demo agent; will refresh stakes.');
  } else {
    logger.info('🤖 Demo agent not found; skipping stake updates.');
  }
  const intentMap = new Map<string, string>();
  const userIdMap = new Map<string, string>();
  const fileIdMap = new Map<string, string>();
  const linkIdMap = new Map<string, string>();
  const brokerIntentIds: string[] = [];
  const seededUsers: SeededUser[] = [];
  let fileCount = 0;
  let linkCount = 0;
  let intentCount = 0;

  const processUser = async (userDef: DemoUserDefinition): Promise<void> => {
    logger.info(`👤 Seeding user ${userDef.name}`);
    const { privyId, accessToken } = await ensurePrivyIdentity(userDef.email, userDef.name);
    const user = await upsertUser(userDef, privyId);
    const indexIds: string[] = [];

    for (const indexKey of userDef.indexes) {
      const indexId = indexMap.get(indexKey);
      if (!indexId) continue;
      indexIds.push(indexId);

      logger.info(`🤝 Adding ${userDef.name} to ${indexKey}`);
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

    const fileEntries = await upsertFilesForUser(user.id, userDef.key, fileDefs, bulkInsert, logger);
    fileEntries.forEach((id, key) => {
      fileIdMap.set(`${userDef.key}:${key}`, id);
    });
    fileCount += fileEntries.size;

    const linkEntries = await upsertLinksForUser(user.id, userDef.key, linkDefs, bulkInsert, logger);
    linkEntries.forEach((id, key) => {
      linkIdMap.set(`${userDef.key}:${key}`, id);
    });
    linkCount += linkEntries.size;

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
          indexKeys: sharedIntent.defaultIndexKeys,
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

      const targetedIndexIds =
        intentDef.indexKeys && intentDef.indexKeys.length > 0
          ? intentDef.indexKeys
              .map((key) => indexMap.get(key))
              .filter((value): value is string => Boolean(value))
          : indexIds;

      const intentResult = await upsertIntent(user.id, intentDef, targetedIndexIds, userDef.key, source, logger);
      intentMap.set(`${userDef.key}:${intentDef.key}`, intentResult.id);
      intentCount += 1;

      const existingEmbedding = await db
        .select({ embedding: intents.embedding })
        .from(intents)
        .where(eq(intents.id, intentResult.id))
        .limit(1);

      if (!existingEmbedding[0]?.embedding) {
        const embedding = generateMockEmbedding(intentResult.id);
        await db.update(intents).set({ embedding }).where(eq(intents.id, intentResult.id));
      }

      if (triggerBrokers && intentResult.created) {
        brokerIntentIds.push(intentResult.id);
      }
    }

    userIdMap.set(userDef.key, user.id);
    seededUsers.push({
      email: userDef.email.toLowerCase(),
      name: userDef.name,
      userId: user.id,
      privyId: user.privyId,
      accessToken,
      loginHints: userDef.loginHints,
    });

    logger.info(`✅ Finished user ${userDef.name}`);
  };

  if (fastSeed) {
    logger.info('⚡ Fast seed mode: processing users concurrently');
    await runWithConcurrency(DEMO_USERS, 4, async (userDef) => {
      await processUser(userDef);
    }, logger);
  } else {
    for (const userDef of DEMO_USERS) {
      await processUser(userDef);
    }
  }

  if (agentId) {
    logger.info('🎯 Updating intent stakes for demo agent');
    for (const stakeDef of DEMO_STAKES) {
      await upsertIntentStake(agentId, stakeDef, intentMap);
    }
  }

  logger.info('🔁 Seeding historical connection events');
  await upsertConnectionEvents(DEMO_CONNECTION_EVENTS, userIdMap);

  if (triggerBrokers && brokerIntentIds.length > 0) {
    logger.info(`🤖 Triggering brokers for ${brokerIntentIds.length} intents (concurrency ${concurrency})`);
    await runWithConcurrency(
      brokerIntentIds,
      concurrency,
      async (intentId) => {
        logger.info(`🤖 Broker run for ${intentId.slice(0, 8)}…`);
        await triggerBrokersOnIntentCreated(intentId);
      },
      logger
    );
  }

  logger.info('📦 Demo seed run complete');
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
    .option('--silent', 'Suppress non-error output')
    .option('--with-brokers', 'Trigger context brokers for each seeded intent')
    .option('--concurrency <number>', 'Max concurrent broker jobs (default 4)', (value) => parseInt(value, 10))
    .option('--bulk-inserts', 'Use batched upserts for files and links')
    .option('--fast-seed', 'Seed users concurrently for faster setup');

  await program.parseAsync(process.argv);
  const opts = program.opts<CliOptions>();
  const logger = createLogger(opts);

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
    if (opts.withBrokers) {
      logger.info('⚙️ Initializing context brokers...');
      await initializeBrokers();
      logger.info('✅ Context brokers ready');
    }

    const concurrency =
      typeof opts.concurrency === 'number' && Number.isFinite(opts.concurrency) && opts.concurrency > 0
        ? Math.floor(opts.concurrency)
        : 4;
    const bulkInsert = Boolean(opts.bulkInserts);
    const fastSeed = Boolean(opts.fastSeed);
    if (bulkInsert) {
      logger.info('📦 Bulk insert mode enabled');
    }
    if (fastSeed) {
      logger.info('⚡ Fast seed mode enabled');
    }

    const result = await runSeed(logger, {
      triggerBrokers: Boolean(opts.withBrokers),
      concurrency,
      bulkInsert,
      fastSeed,
    });

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
