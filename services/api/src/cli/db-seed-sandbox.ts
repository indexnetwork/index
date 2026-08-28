#!/usr/bin/env node
import dotenv from 'dotenv';
import { inArray, sql } from 'drizzle-orm/sql';
import path from 'node:path';
import { v5 as uuidv5 } from 'uuid';

import { CREDENTIAL_PROVIDER_ID, hashCredentialPassword } from '../lib/betterauth/credential-password';

import { SANDBOX_E2E_CASES, SANDBOX_MINIMAL_PERSONAS, SANDBOX_TWENTY_PERSONAS, SANDBOX_SEED_PASSWORD, type SandboxPersona } from './sandbox-personas';

const SANDBOX_DATABASE = 'protocol_sandbox';
const FIXTURE_NAMESPACE = 'd52db0f7-f03d-4f65-a20d-dcc16a890a21';

const rootEnvPath = path.resolve(import.meta.dir, '../../../..', '.env.development');
dotenv.config({ path: rootEnvPath });

const configuredUrl = process.env.DATABASE_URL;
if (!configuredUrl) throw new Error('DATABASE_URL is required');

const sandboxUrl = new URL(configuredUrl);
const configuredDatabase = decodeURIComponent(sandboxUrl.pathname.replace(/^\//, ''));
if (!['protocol_prod', SANDBOX_DATABASE].includes(configuredDatabase)) {
  throw new Error(
    `Refusing to derive a sandbox connection from database "${configuredDatabase}". `
    + `Expected protocol_prod or ${SANDBOX_DATABASE}.`,
  );
}
sandboxUrl.pathname = `/${SANDBOX_DATABASE}`;
process.env.DATABASE_URL = sandboxUrl.toString();
process.env.NODE_ENV = 'development';

const NETWORKS = [
  { id: '5aff6cd6-d64e-4ef9-8bcf-6c89815f771c', key: 'commons', title: 'Commons', prompt: null, joinPolicy: 'anyone' as const },
  { id: '99999999-d64e-4ef9-8bcf-6c89815f771c', key: 'vault', title: 'Vault', prompt: null, joinPolicy: 'invite_only' as const },
  { id: 'aaaaaaaa-0001-4000-8000-000000000001', key: 'stack', title: 'Stack', prompt: 'Software engineering, programming, coding projects, developer tools, and technical implementation', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0002-4000-8000-000000000002', key: 'latent', title: 'Latent', prompt: 'Artificial intelligence, machine learning, deep learning, LLMs, neural networks, and data science', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0003-4000-8000-000000000003', key: 'pixel', title: 'Pixel', prompt: 'UI/UX design, graphic design, creative projects, branding, and visual communication', joinPolicy: 'invite_only' as const },
  { id: 'aaaaaaaa-0004-4000-8000-000000000004', key: 'launch', title: 'Launch', prompt: 'Startups, entrepreneurship, business strategy, fundraising, and go-to-market', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0005-4000-8000-000000000005', key: 'atelier', title: 'Atelier', prompt: 'Visual art, illustration, music, writing, performance art, crafts, and creative projects', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0006-4000-8000-000000000006', key: 'arena', title: 'Arena', prompt: 'Video games, tabletop RPGs, streaming, esports, game development, and gaming community', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0007-4000-8000-000000000007', key: 'syllabus', title: 'Syllabus', prompt: 'Teaching, tutoring, education, learning, academic research, and knowledge sharing', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0008-4000-8000-000000000008', key: 'reps', title: 'Reps', prompt: 'Sports, fitness, running, cycling, climbing, swimming, coaching, and athletic activities', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-0009-4000-8000-000000000009', key: 'tribe', title: 'Tribe', prompt: 'Community organizing, volunteering, mutual aid, local initiatives, and civic engagement', joinPolicy: 'anyone' as const },
  { id: 'aaaaaaaa-000a-4000-8000-00000000000a', key: 'bench', title: 'Bench', prompt: 'Hobbies, makers, DIY, ceramics, cooking, photography, and hands-on projects', joinPolicy: 'anyone' as const },
] as const;

type NetworkKey = (typeof NETWORKS)[number]['key'];

/**
 * Every address the seed owns. Re-seeds wipe and recreate these users, so the
 * pattern must cover every persona family this CLI can write — including the
 * three fixed-id investors on `@sandbox.test` — or a re-run duplicates instead
 * of refreshing.
 */
const FIXTURE_EMAIL_PATTERNS = [
  'seed-tester-%@index-network.test',
  'sandbox-%@index-network.test',
  '%@sandbox.test',
];

function fixtureId(kind: string, identity: string): string {
  return uuidv5(`${kind}:${identity}`, FIXTURE_NAMESPACE);
}

function profileText(persona: SandboxPersona): string {
  const { identity, narrative, attributes } = persona.profile;
  return [
    `${identity.name} is based in ${identity.location}.`,
    identity.bio,
    narrative.context,
    `Skills: ${attributes.skills.join(', ')}.`,
    `Interests: ${attributes.interests.join(', ')}.`,
  ].join(' ');
}

async function generateEmbeddings(texts: string[]): Promise<Map<string, number[]>> {
  const { EmbedderAdapter } = await import('../adapters/embedder.adapter');
  const embedder = new EmbedderAdapter();
  const result = new Map<string, number[]>();
  const uniqueTexts = [...new Set(texts)];
  const batchSize = 64;

  for (let offset = 0; offset < uniqueTexts.length; offset += batchSize) {
    const batch = uniqueTexts.slice(offset, offset + batchSize);
    const embeddings = await embedder.generate(batch) as number[][];
    batch.forEach((text, index) => result.set(text, embeddings[index]!));
    console.log(`Embedded ${Math.min(offset + batch.length, uniqueTexts.length)}/${uniqueTexts.length} fixture documents`);
  }

  return result;
}

async function main(): Promise<void> {
  if (!process.argv.includes('--confirm')) {
    throw new Error(`This command writes curated fixtures to ${SANDBOX_DATABASE}. Re-run with --confirm and exactly one of --minimal or --twenty.`);
  }
  const minimal = process.argv.includes('--minimal');
  const twenty = process.argv.includes('--twenty');
  if (minimal === twenty) throw new Error('Choose exactly one sandbox population: --minimal or --twenty.');
  const personas = minimal ? SANDBOX_MINIMAL_PERSONAS : SANDBOX_TWENTY_PERSONAS;
  // Minimal mode is deliberately one complete market: create Launch and no
  // other network, and keep every fixture signal inside it.
  const fixtureNetworks = minimal ? NETWORKS.filter((network) => network.key === 'launch') : NETWORKS;

  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const schema = await import('../schemas/database.schema');

  try {
    // Fail before any paid embedding request when the configured local-dev
    // branch does not actually expose protocol_sandbox. The live E2E runs
    // this seeder as its reset step, so its environment check must be cheap.
    try {
      await db.execute(sql`SELECT 1`);
    } catch (error) {
      const cause = error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot connect to ${SANDBOX_DATABASE} before seeding: ${cause}`, { cause: error });
    }

    const personaFixtures = personas.map((persona) => {
      const context = profileText(persona);
      // Twenty mode used to pad every persona up to at least 3 networks (plus
      // a 1-in-7 vault add) so the fixture looked diverse. That's exactly the
      // network segregation the playground population was reworked to avoid:
      // membership is now just the persona's authored network(s) plus the
      // always-on commons baseline — real matching is the only filter left.
      const classified = minimal
        ? new Set<NetworkKey>(persona.networkKeys)
        : new Set<NetworkKey>(['commons', ...persona.networkKeys]);
      return {
        persona,
        userId: persona.fixedIds?.userId ?? fixtureId('user', persona.email),
        context,
        premiseTexts: persona.premises,
        networkKeys: [...classified],
      };
    });

    const embeddingTexts = personaFixtures.flatMap(({ context, premiseTexts, persona }) => [
      context,
      ...premiseTexts,
      ...persona.intents,
    ]);
    const embeddings = await generateEmbeddings(embeddingTexts);
    const passwordHash = await hashCredentialPassword(SANDBOX_SEED_PASSWORD);
    const networkByKey = new Map(NETWORKS.map((network) => [network.key, network]));
    const ownerByNetwork = new Map<NetworkKey, string>();
    for (const fixture of personaFixtures) {
      for (const key of fixture.networkKeys) {
        if (!ownerByNetwork.has(key)) ownerByNetwork.set(key, fixture.userId);
      }
    }

    let wipedFixtureUserIds: string[] = [];
    await db.transaction(async (tx) => {
      const fixtureUsers = await tx.select({ id: schema.users.id })
        .from(schema.users)
        .where(sql.join(FIXTURE_EMAIL_PATTERNS.map((pattern) => sql`${schema.users.email} LIKE ${pattern}`), sql` OR `));
      const fixtureUserIds = fixtureUsers.map((user) => user.id);
      wipedFixtureUserIds = fixtureUserIds;
      if (fixtureUserIds.length > 0) {
        const fixtureActorPredicate = sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${schema.opportunities.actors}) AS actor
          WHERE actor->>'userId' IN (${sql.join(fixtureUserIds.map((id) => sql`${id}`), sql`, `)})
             OR NOT EXISTS (
               SELECT 1 FROM ${schema.users}
               WHERE ${schema.users.id} = actor->>'userId'
             )
        )`;
        const fixtureOpportunities = await tx.select({ id: schema.opportunities.id })
          .from(schema.opportunities)
          .where(fixtureActorPredicate);
        const fixtureOpportunityIds = fixtureOpportunities.map((opportunity) => opportunity.id);

        await tx.delete(schema.questions).where(sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${schema.questions.actors}) AS actor
          WHERE actor->>'userId' IN (${sql.join(fixtureUserIds.map((id) => sql`${id}`), sql`, `)})
             OR NOT EXISTS (
               SELECT 1 FROM ${schema.users}
               WHERE ${schema.users.id} = actor->>'userId'
             )
        )`);
        if (fixtureOpportunityIds.length > 0) {
          await tx.delete(schema.questions).where(sql`
            ${schema.questions.detection}->'negotiation'->>'opportunityId'
            IN (${sql.join(fixtureOpportunityIds.map((id) => sql`${id}`), sql`, `)})
          `);
          await tx.delete(schema.opportunityOutcomeEvents)
            .where(inArray(schema.opportunityOutcomeEvents.opportunityId, fixtureOpportunityIds));
          await tx.delete(schema.opportunities).where(inArray(schema.opportunities.id, fixtureOpportunityIds));
        }

        // Conversations reference no user row, so they survive the user wipe —
        // and fixture ids are deterministic, so the recreated personas would
        // inherit their predecessors' negotiation dialogue and the pre-contact
        // screener then passes on matches it believes already concluded. Every
        // FK into conversations cascades (tasks, messages, participants,
        // sessions, metadata), so deleting the conversation clears the ghost.
        const ghostConversationSubquery = sql`
          SELECT cp.conversation_id
          FROM conversation_participants cp
          LEFT JOIN users u ON u.id = cp.participant_id
          LEFT JOIN agents a ON a.id = cp.participant_id
          WHERE (u.id IS NULL AND a.id IS NULL)
             OR u.id IN (${sql.join(fixtureUserIds.map((id) => sql`${id}`), sql`, `)})
             OR a.owner_id IN (${sql.join(fixtureUserIds.map((id) => sql`${id}`), sql`, `)})
        `;
        // chat_session_summaries → messages is ON DELETE RESTRICT, which fires
        // even inside the conversation cascade — summaries go first.
        await tx.execute(sql`
          DELETE FROM chat_session_summaries WHERE conversation_id IN (${ghostConversationSubquery})
        `);
        await tx.execute(sql`
          DELETE FROM conversations WHERE id IN (${ghostConversationSubquery})
        `);
        await tx.execute(sql`
          DELETE FROM intent_agent_acts
          WHERE user_id IN (${sql.join(fixtureUserIds.map((id) => sql`${id}`), sql`, `)})
             OR NOT EXISTS (SELECT 1 FROM users WHERE users.id = intent_agent_acts.user_id)
        `);

        const fixtureIntents = await tx.select({ id: schema.intents.id })
          .from(schema.intents)
          .where(inArray(schema.intents.userId, fixtureUserIds));
        const fixtureIntentIds = fixtureIntents.map((intent) => intent.id);
        if (fixtureIntentIds.length > 0) {
          await tx.delete(schema.hydeDocuments).where(inArray(schema.hydeDocuments.sourceId, fixtureIntentIds));
          await tx.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, fixtureIntentIds));
          await tx.delete(schema.intents).where(inArray(schema.intents.id, fixtureIntentIds));
        }

        await tx.delete(schema.networkMembers).where(inArray(schema.networkMembers.userId, fixtureUserIds));
        await tx.delete(schema.users).where(inArray(schema.users.id, fixtureUserIds));
      }

      for (const network of fixtureNetworks) {
        await tx.insert(schema.networks).values({
          id: network.id,
          key: network.key,
          title: network.title,
          prompt: network.prompt,
          metadata: { fixture: SANDBOX_DATABASE },
          permissions: { joinPolicy: network.joinPolicy, invitationLink: null },
        }).onConflictDoUpdate({
          target: schema.networks.id,
          set: {
            key: network.key,
            title: network.title,
            prompt: network.prompt,
            metadata: { fixture: SANDBOX_DATABASE },
            permissions: { joinPolicy: network.joinPolicy, invitationLink: null },
          },
        });
      }

      for (const fixture of personaFixtures) {
        const { persona, userId, premiseTexts, networkKeys } = fixture;
        await tx.insert(schema.users).values({
          id: userId,
          email: persona.email,
          emailVerified: true,
          name: persona.name,
          intro: persona.profile.identity.bio,
          location: persona.profile.identity.location,
          onboarding: { completedAt: '2026-01-01T00:00:00.000Z' },
        }).onConflictDoUpdate({
          target: schema.users.id,
          set: {
            email: persona.email,
            emailVerified: true,
            name: persona.name,
            intro: persona.profile.identity.bio,
            location: persona.profile.identity.location,
          },
        });

        // Email/password credential, shaped exactly like Better Auth's own
        // sign-up writes it, so the normal login form works for every persona.
        await tx.insert(schema.accounts).values({
          id: fixtureId('credential', persona.email),
          accountId: userId,
          providerId: CREDENTIAL_PROVIDER_ID,
          userId,
          password: passwordHash,
        }).onConflictDoUpdate({
          target: schema.accounts.id,
          set: { accountId: userId, providerId: CREDENTIAL_PROVIDER_ID, userId, password: passwordHash, updatedAt: new Date() },
        });

        for (const key of networkKeys) {
          const network = networkByKey.get(key)!;
          const isOwner = ownerByNetwork.get(key) === userId;
          await tx.insert(schema.networkMembers).values({
            networkId: network.id,
            userId,
            permissions: [isOwner ? 'owner' : 'member'],
            autoAssign: true,
            metadata: { fixture: SANDBOX_DATABASE },
          }).onConflictDoUpdate({
            target: [schema.networkMembers.networkId, schema.networkMembers.userId],
            set: { permissions: [isOwner ? 'owner' : 'member'], autoAssign: true, metadata: { fixture: SANDBOX_DATABASE } },
          });
        }

        for (const [premiseIndex, text] of premiseTexts.entries()) {
          const premiseId = fixtureId('premise', `${persona.email}:${premiseIndex}`);
          await tx.insert(schema.premises).values({
            id: premiseId,
            userId,
            assertion: { text, tier: 'assertive' },
            provenance: { source: 'onboarding', confidence: 1, timestamp: '2026-01-01T00:00:00.000Z' },
            analysis: { speechActType: 'ASSERTIVE', felicityAuthority: 1, felicitySincerity: 1, felicityClarity: 1, semanticEntropy: 0.1 },
            validity: { volatile: false },
            embedding: embeddings.get(text)!,
          }).onConflictDoUpdate({
            target: schema.premises.id,
            set: { assertion: { text, tier: 'assertive' }, embedding: embeddings.get(text)! },
          });

          const premiseNetworkKeys: NetworkKey[] = networkKeys.filter((key) => key !== 'commons' && key !== 'vault');
          if (premiseIndex === 0 && networkKeys.includes('vault')) premiseNetworkKeys.push('vault');
          const premiseNetworks = minimal
            ? new Set<NetworkKey>(premiseNetworkKeys)
            : new Set<NetworkKey>(['commons', ...premiseNetworkKeys]);
          for (const key of premiseNetworks) {
            await tx.insert(schema.premiseNetworks).values({
              premiseId,
              networkId: networkByKey.get(key)!.id,
              relevancyScore: key === 'commons' ? '0.75' : '0.95',
            }).onConflictDoNothing();
          }
        }

        for (const [intentIndex, payload] of persona.intents.entries()) {
          const intentId = persona.fixedIds?.intentIds[intentIndex] ?? fixtureId('intent', `${persona.email}:${intentIndex}`);
          await tx.insert(schema.intents).values({
            id: intentId,
            userId,
            payload,
            summary: payload,
            sourceId: fixtureId('intent-source', `${persona.email}:${intentIndex}`),
            sourceType: 'discovery_form',
            embedding: embeddings.get(payload)!,
            semanticEntropy: 0.2,
            felicityAuthority: 1,
            felicitySincerity: 1,
            felicityClarity: 1,
            // A reset sandbox must be inert until its owner explicitly
            // resumes an intent. Otherwise booting the API starts every
            // fixture's discovery at once and drowns the first real user turn.
            status: 'PAUSED',
          }).onConflictDoUpdate({
            target: schema.intents.id,
            set: { payload, summary: payload, embedding: embeddings.get(payload)!, status: 'PAUSED' },
          });

          const relevantKeys: NetworkKey[] = networkKeys.filter((key) => key !== 'commons' && key !== 'vault');
          if (intentIndex === 0 && networkKeys.includes('vault')) relevantKeys.push('vault');
          const intentNetworks = minimal
            ? new Set<NetworkKey>(relevantKeys)
            : new Set<NetworkKey>(['commons', ...relevantKeys]);
          for (const key of intentNetworks) {
            await tx.insert(schema.intentNetworks).values({
              intentId,
              networkId: networkByKey.get(key)!.id,
              relevancyScore: key === 'commons' ? '0.75' : '0.95',
            }).onConflictDoNothing();
          }
        }
      }

    });

    // Remove stale discovery jobs for fixture owners. A reset stays paused;
    // normal intent resume is the only thing that starts discovery.
    const currentFixtureUserIds = personaFixtures.map((fixture) => fixture.userId);
    if (wipedFixtureUserIds.length > 0 || minimal) {
      try {
        const { discoveryQueue } = await import('../queues/opportunity/discovery.queue');
        const wiped = new Set([...wipedFixtureUserIds, ...currentFixtureUserIds]);
        let removed = 0;
        for (const job of await discoveryQueue.queue.getJobs(['completed', 'failed', 'delayed', 'waiting'])) {
          const jobUserId = (job?.data as { userId?: string } | undefined)?.userId;
          if (jobUserId && wiped.has(jobUserId)) {
            await job.remove();
            removed += 1;
          }
        }
        await discoveryQueue.queue.close();
        if (removed > 0) console.log(`Removed ${removed} stale discovery job(s) for wiped fixture users.`);
      } catch (error) {
        console.warn(`Discovery queue sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const premiseCount = personaFixtures.reduce((sum, item) => sum + item.premiseTexts.length, 0);
    const intentCount = personaFixtures.reduce((sum, item) => sum + item.persona.intents.length, 0);
    console.log(
      `Seeded ${personaFixtures.length} people (${minimal ? 'minimal' : 'twenty'} mode), ${fixtureNetworks.length} networks, `
      + `${premiseCount} premises, and ${intentCount} intents into ${SANDBOX_DATABASE}.`,
    );
    console.log(`Every seed persona signs in with email/password; the shared password is "${SANDBOX_SEED_PASSWORD}".`);
    if (minimal) {
      for (const { persona } of personaFixtures) console.log(`  ${persona.name} <${persona.email}>`);
    }
  } finally {
    await closeDb();
  }
}

main().then(() => {
  // The best-effort queue sweep imports BullMQ, whose Redis connections keep
  // the event loop alive after the work is done — exit explicitly.
  process.exit(0);
}).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
