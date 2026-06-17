#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';

const envFile = `.env.development`;
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { sql } from 'drizzle-orm';

import db, { closeDb } from '../lib/drizzle/drizzle';
import type { OnboardingState } from '../types/users.types';

/**
 * Audits AgentVillage (Edge City) users' onboarding state.
 *
 * An "AgentVillage user" is a user with a live network-scoped agent for the
 * given network (provisioned via the experiment signup flow used by the
 * AgentVillage landing page / control-plane). The main report covers users
 * whose pod has connected at least once — detected via the greater of
 * `agents.last_seen_at` (bumped by pickup/heartbeat endpoints) and the
 * scoped agent's API-key `last_request` (bumped on every authenticated MCP
 * call). Provisioned-but-never-connected users are summarized separately.
 *
 * Because `onboarding.completedAt` is a single flag shared by every
 * onboarding flow and `complete_onboarding()` records no source, the flow
 * that completed onboarding is inferred from privacy-consent fingerprints
 * (`record_onboarding_privacy_consent` source):
 *
 *   - `agentvillage_onboarding` → AV bootstrap ritual
 *   - `hermes_setup`            → Hermes setup flow
 *   - no marker                 → index web-chat onboarding (chat.prompt.ts
 *     never records consent), a legacy flow, or an AV onboarding that
 *     predates the consent tool — indistinguishable by elimination
 *
 * Buckets:
 *   1. not_onboarded            — no completedAt, no consent markers
 *   2. av_started_incomplete    — AV consent recorded, completedAt not set
 *   3. completed_hermes         — completedAt + hermes_setup marker
 *   4. completed_index_untagged — completedAt, no markers (index web chat
 *                                 onboarding or other untagged flow)
 *   5. completed_av             — completedAt + AV consent marker
 *
 * The AV pod gates only on completedAt, so buckets 3-5 all skip the AV
 * ritual. Buckets 1 and 2 are the users who "don't have onboarding yet".
 *
 * Usage:
 *   bun src/cli/audit-agentvillage-onboarding.ts --network <networkIdOrTitle>
 *   bun src/cli/audit-agentvillage-onboarding.ts            # lists candidate networks
 */

type Bucket = 'not_onboarded' | 'av_started_incomplete' | 'completed_hermes' | 'completed_index_untagged' | 'completed_av';

type AuditRow = {
  user_id: string;
  email: string;
  name: string;
  onboarding: OnboardingState | string | null;
  last_seen_at: Date | string | null;
  agent_created_at: Date | string;
};

interface BucketedUser {
  userId: string;
  email: string;
  name: string;
  lastSeenAt: string | null;
  completedAt: string | null;
  flow: number | null;
  consentSources: string[];
}

const parseOnboarding = (raw: AuditRow['onboarding']): OnboardingState => {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as OnboardingState;
    } catch {
      return {};
    }
  }
  return raw;
};

const consentSources = (onboarding: OnboardingState): string[] => {
  const sources: string[] = [];
  const privacy = onboarding.privacy ?? {};
  if (privacy.edgeosImport?.source) sources.push(`edgeosImport:${privacy.edgeosImport.source}`);
  if (privacy.publicProfileLookup?.source) sources.push(`publicProfileLookup:${privacy.publicProfileLookup.source}`);
  return sources;
};

const hasMarker = (onboarding: OnboardingState, source: string): boolean => {
  const privacy = onboarding.privacy ?? {};
  return privacy.edgeosImport?.source === source || privacy.publicProfileLookup?.source === source;
};

const classify = (onboarding: OnboardingState): Bucket => {
  const completed = Boolean(onboarding.completedAt);
  const av = hasMarker(onboarding, 'agentvillage_onboarding');
  if (!completed) return av ? 'av_started_incomplete' : 'not_onboarded';
  if (av) return 'completed_av';
  if (hasMarker(onboarding, 'hermes_setup')) return 'completed_hermes';
  return 'completed_index_untagged';
};

const resolveNetwork = async (
  query: string,
): Promise<{ id: string; title: string } | null> => {
  const rows = await db.execute<{ id: string; title: string }>(sql`
    SELECT id, title
    FROM networks
    WHERE deleted_at IS NULL
      AND (id = ${query} OR title ILIKE ${'%' + query + '%'})
    ORDER BY (id = ${query}) DESC, created_at ASC
    LIMIT 5
  `);
  if (rows.length === 0) return null;
  if (rows.length > 1 && rows[0].id !== query) {
    console.error(`Ambiguous network "${query}" — matches:`);
    for (const r of rows) console.error(`  ${r.id}  ${r.title}`);
    process.exit(1);
  }
  return rows[0];
};

const listCandidateNetworks = async (): Promise<void> => {
  const rows = await db.execute<{ id: string; title: string; is_experiment: boolean; members: number }>(sql`
    SELECT n.id, n.title, n.is_experiment, count(nm.user_id) AS members
    FROM networks n
    LEFT JOIN network_members nm ON nm.network_id = n.id AND nm.deleted_at IS NULL
    WHERE n.deleted_at IS NULL
      AND (n.is_experiment = true OR n.title ~* '(edge|esmeralda|village)')
    GROUP BY n.id, n.title, n.is_experiment
    ORDER BY count(nm.user_id) DESC
  `);
  console.log('Pass --network <idOrTitle>. Candidate networks:');
  for (const r of rows) {
    console.log(`  ${r.id}  members=${r.members}  experiment=${r.is_experiment}  ${r.title}`);
  }
};

const toIso = (value: Date | string | null): string | null => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const formatUser = (u: BucketedUser): string => {
  const seen = u.lastSeenAt ? u.lastSeenAt.slice(0, 16) : 'never';
  const completed = u.completedAt ? u.completedAt.slice(0, 16) : '-';
  const flow = u.flow ?? '-';
  const consents = u.consentSources.length ? u.consentSources.join(', ') : '-';
  return `  ${u.email.padEnd(40)} lastSeen=${seen}  completedAt=${completed}  flow=${flow}  consents=${consents}`;
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  const networkFlagIdx = args.indexOf('--network');
  const networkQuery = networkFlagIdx !== -1 ? args[networkFlagIdx + 1] : undefined;

  if (!networkQuery) {
    await listCandidateNetworks();
    return;
  }

  const network = await resolveNetwork(networkQuery);
  if (!network) {
    console.error(`No network found matching "${networkQuery}".`);
    process.exit(1);
  }
  console.log(`Network: ${network.title} (${network.id})\n`);

  // One row per user holding a live network-scoped agent for this network.
  // Multiple agents per user are collapsed to the most recently seen one.
  // "Last seen" is the greater of agents.last_seen_at (pickup/heartbeat) and
  // the agent's API-key last_request (any authenticated MCP/REST call). The
  // apikey table links to agents via metadata JSON ({"agentId": ...}), not
  // reference_id, so we extract it defensively.
  const rows = await db.execute<AuditRow>(sql`
    SELECT DISTINCT ON (u.id)
      u.id AS user_id,
      u.email,
      u.name,
      u.onboarding,
      GREATEST(a.last_seen_at, k.last_key_request) AS last_seen_at,
      a.created_at AS agent_created_at
    FROM agent_permissions ap
    INNER JOIN agents a ON a.id = ap.agent_id AND a.deleted_at IS NULL
    INNER JOIN users u ON u.id = ap.user_id AND u.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT max(ak.last_request) AS last_key_request
      FROM apikey ak
      WHERE ak.metadata ~ '^\s*\{.*\}\s*$'
        AND (ak.metadata::jsonb ->> 'agentId') = a.id
    ) k ON true
    WHERE ap.scope = 'network'
      AND ap.scope_id = ${network.id}
    ORDER BY u.id, GREATEST(a.last_seen_at, k.last_key_request) DESC NULLS LAST
  `);

  const neverConnected: BucketedUser[] = [];
  const buckets: Record<Bucket, BucketedUser[]> = {
    not_onboarded: [],
    av_started_incomplete: [],
    completed_hermes: [],
    completed_index_untagged: [],
    completed_av: [],
  };

  for (const row of rows) {
    const onboarding = parseOnboarding(row.onboarding);
    const user: BucketedUser = {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      lastSeenAt: toIso(row.last_seen_at),
      completedAt: onboarding.completedAt ?? null,
      flow: onboarding.flow ?? null,
      consentSources: consentSources(onboarding),
    };
    if (!row.last_seen_at) {
      neverConnected.push(user);
      continue;
    }
    buckets[classify(onboarding)].push(user);
  }

  const connected = rows.length - neverConnected.length;
  console.log(`Provisioned users: ${rows.length} (connected: ${connected}, never connected: ${neverConnected.length})\n`);

  const sections: { bucket: Bucket; label: string }[] = [
    { bucket: 'not_onboarded', label: '① NOT ONBOARDED — pod connected, no onboarding at all' },
    { bucket: 'av_started_incomplete', label: '② AV ONBOARDING STARTED BUT INCOMPLETE — consent recorded, completedAt missing' },
    { bucket: 'completed_hermes', label: '③ COMPLETED VIA HERMES SETUP — AV ritual skipped (gate sees completedAt)' },
    { bucket: 'completed_index_untagged', label: '④ COMPLETED VIA INDEX WEB ONBOARDING (or untagged flow) — AV ritual skipped' },
    { bucket: 'completed_av', label: '⑤ COMPLETED VIA AGENTVILLAGE' },
  ];

  for (const { bucket, label } of sections) {
    const users = buckets[bucket];
    console.log(`${label} (${users.length})`);
    for (const u of users.sort((a, b) => a.email.localeCompare(b.email))) {
      console.log(formatUser(u));
    }
    console.log('');
  }

  const needsOnboarding = buckets.not_onboarded.length + buckets.av_started_incomplete.length;
  console.log(`>>> Users needing onboarding (① + ②): ${needsOnboarding}`);

  if (neverConnected.length > 0) {
    console.log(`\nProvisioned but never connected (${neverConnected.length}) — excluded from buckets above:`);
    for (const u of neverConnected.sort((a, b) => a.email.localeCompare(b.email))) {
      console.log(formatUser(u));
    }
  }
};

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    const msg = err instanceof Error ? err.message : `${err}`;
    console.error('Audit failed:', msg);
    await closeDb();
    process.exit(1);
  });
