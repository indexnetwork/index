#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { sql } from 'drizzle-orm/sql';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(import.meta.dir, '../../../..', envFile) });

import db, { closeDb } from '../lib/drizzle/drizzle';
import { agents, networkMembers, networks, users } from '../schemas/database.schema';
import { SYSTEM_AGENT_IDS } from '../adapters/agent.database.adapter';
import { setLevel } from '../lib/log';
import type { Id } from '../types/common.types';

/** Minimal account shape for user creation. */
interface SeedAccount {
  email: string;
  name: string;
}

/** First account owns every seeded network; the rest join as members. */
const SYSTEM_ADMIN_ACCOUNTS: SeedAccount[] = [
  { email: 'yanki@index.network', name: 'Yanki' },
  { email: 'seref@index.network', name: 'Seref' },
  { email: 'seren@index.network', name: 'Seren' },
];

const SYSTEM_AGENT_DEFS = [
  {
    id: SYSTEM_AGENT_IDS.negotiator,
    name: 'Index Negotiator',
    description: 'Built-in agent that handles negotiation turns and opportunity status transitions.',
  },
] as const;

// ── Network definitions ───────────────────────────────────────────────────────

interface NetworkDef {
  id: Id<'networks'>;
  title: string;
  key: string;
  prompt: string | null;
  joinPolicy: 'anyone' | 'invite_only';
}

const SEED_NETWORKS: NetworkDef[] = [
  // General-purpose networks (null prompts = auto-assign, no LLM evaluation)
  {
    id: '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Commons',
    key: 'commons',
    prompt: null,
    joinPolicy: 'anyone',
  },
  {
    id: '99999999-d64e-4ef9-8bcf-6c89815f771c',
    title: 'Vault',
    key: 'vault',
    prompt: null,
    joinPolicy: 'invite_only',
  },

  // Categorical networks (prompts describe what the community is for)
  {
    id: 'aaaaaaaa-0001-4000-8000-000000000001',
    title: 'Stack',
    key: 'stack',
    prompt: 'Software engineering, programming, coding projects, developer tools, and technical implementation',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0002-4000-8000-000000000002',
    title: 'Latent',
    key: 'latent',
    prompt: 'Artificial intelligence, machine learning, deep learning, LLMs, neural networks, and data science',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0003-4000-8000-000000000003',
    title: 'Pixel',
    key: 'pixel',
    prompt: 'UI/UX design, graphic design, creative projects, branding, and visual communication',
    joinPolicy: 'invite_only',
  },
  {
    id: 'aaaaaaaa-0004-4000-8000-000000000004',
    title: 'Launch',
    key: 'launch',
    prompt: 'Startups, entrepreneurship, business strategy, fundraising, and go-to-market',
    joinPolicy: 'anyone',
  },

  // Non-business / lifestyle networks
  {
    id: 'aaaaaaaa-0005-4000-8000-000000000005',
    title: 'Atelier',
    key: 'atelier',
    prompt: 'Visual art, illustration, music, writing, performance art, crafts, and creative projects',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0006-4000-8000-000000000006',
    title: 'Arena',
    key: 'arena',
    prompt: 'Video games, tabletop RPGs, streaming, esports, game development, and gaming community',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0007-4000-8000-000000000007',
    title: 'Syllabus',
    key: 'syllabus',
    prompt: 'Teaching, tutoring, education, learning, academic research, and knowledge sharing',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0008-4000-8000-000000000008',
    title: 'Reps',
    key: 'reps',
    prompt: 'Sports, fitness, running, cycling, climbing, swimming, coaching, and athletic activities',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-0009-4000-8000-000000000009',
    title: 'Tribe',
    key: 'tribe',
    prompt: 'Community organizing, volunteering, mutual aid, local initiatives, and civic engagement',
    joinPolicy: 'anyone',
  },
  {
    id: 'aaaaaaaa-000a-4000-8000-00000000000a',
    title: 'Bench',
    key: 'bench',
    prompt: 'Hobbies, makers, DIY, ceramics, cooking, photography, and hands-on projects',
    joinPolicy: 'anyone',
  },
];

// ── CLI flags ───────────────────────────────────────────────────────────────

type GlobalOpts = {
  silent?: boolean;
  confirm?: boolean;
};

function parseArgs(): GlobalOpts {
  const args = process.argv.slice(2);
  return {
    silent: args.includes('--silent'),
    confirm: args.includes('--confirm'),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(account: SeedAccount): Promise<{ id: string }> {
  const normalizedEmail = account.email.toLowerCase().trim();
  try {
    const [user] = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        name: account.name,
        intro: `Test account for ${account.name}`,
        onboarding: { completedAt: new Date().toISOString() },
      })
      .returning({ id: users.id });
    return { id: user!.id };
  } catch {
    const [byEmail] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${normalizedEmail}`).limit(1);
    if (byEmail) return byEmail;
    throw new Error(`createUser failed for ${normalizedEmail}: insert failed and no existing user found by email`);
  }
}

/**
 * Create or get users for the given accounts and ensure they are members of all
 * seed networks. The first account receives 'owner' on every network.
 *
 * @param accounts - List of accounts to provision.
 * @returns The created or existing user rows, in input order.
 */
async function ensureUsersAndMemberships(accounts: SeedAccount[]): Promise<{ id: string }[]> {
  const createdUsers: { id: string }[] = [];
  for (const [i, account] of accounts.entries()) {
    const user = await createUser(account);
    createdUsers.push(user);
    for (const idx of SEED_NETWORKS) {
      try {
        await db.insert(networkMembers).values({
          networkId: idx.id,
          userId: user.id,
          permissions: i === 0 ? ['owner'] : ['member'],
          prompt: null,
          autoAssign: true,
        });
      } catch {
        /* already exists */
      }
    }
  }
  return createdUsers;
}

// ── Seed logic ──────────────────────────────────────────────────────────────

async function seedDatabase(): Promise<{ ok: boolean; error?: string }> {
  const { silent } = parseArgs();

  try {
    if (!silent) console.log('Creating networks...');

    // Create all networks
    for (let i = 0; i < SEED_NETWORKS.length; i++) {
      const idx = SEED_NETWORKS[i];
      try {
        await db.insert(networks).values({
          id: idx.id,
          title: idx.title,
          key: idx.key,
          prompt: idx.prompt,
          permissions: {
            joinPolicy: idx.joinPolicy,
            invitationLink: null,
          },
        });
        if (!silent) console.log(`  Network ${i + 1}/${SEED_NETWORKS.length}: ${idx.title} — created`);
      } catch {
        if (!silent) console.log(`  Network ${i + 1}/${SEED_NETWORKS.length}: ${idx.title} — already exists`);
      }
    }

    if (!silent) console.log(`  ${SEED_NETWORKS.length} networks ready`);

    if (!silent) console.log('Ensuring system admin users...');
    const adminUsers = await ensureUsersAndMemberships(SYSTEM_ADMIN_ACCOUNTS);
    if (!silent) console.log(`  System admin users: ${adminUsers.length} ready`);

    const systemOwner = adminUsers[0];
    if (systemOwner) {
      for (const systemAgent of SYSTEM_AGENT_DEFS) {
        await db.insert(agents).values({
          id: systemAgent.id,
          ownerId: systemOwner.id,
          name: systemAgent.name,
          description: systemAgent.description,
          type: 'system',
          status: 'active',
          metadata: {},
        }).onConflictDoNothing();
      }

      if (!silent) {
        console.log(`  ${SYSTEM_AGENT_DEFS.length} system agents ready`);
      }
    }

    if (!silent) {
      console.log('\nNetworks:');
      for (const idx of SEED_NETWORKS) {
        const label = idx.prompt ? `prompt: "${idx.prompt}"` : 'no prompt (auto-assign)';
        console.log(`  ${idx.title} [${idx.joinPolicy}] -- ${label}`);
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  if (opts.silent) setLevel('error');

  if (process.env.NODE_ENV === 'production') {
    console.error('db:seed cannot be run in production environment');
    await closeDb();
    process.exit(1);
  }

  if (!opts.confirm) {
    console.log('This will add mock data to the database.');
    console.log('Use --confirm to skip this warning.');
    await closeDb();
    process.exit(1);
  }

  const result = await seedDatabase();

  if (!result.ok) {
    console.error('Seed failed:', result.error);
    await closeDb();
    process.exit(1);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('db-seed error:', msg);
    await closeDb();
    process.exit(1);
  });
