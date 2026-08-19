#!/usr/bin/env node
import dotenv from 'dotenv';
import { inArray, sql } from 'drizzle-orm/sql';
import path from 'node:path';
import { v5 as uuidv5 } from 'uuid';

import { SANDBOX_PERSONAS } from './sandbox-personas';

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

function fixtureId(kind: string, identity: string): string {
  return uuidv5(`${kind}:${identity}`, FIXTURE_NAMESPACE);
}

function profileText(persona: (typeof SANDBOX_PERSONAS)[number]): string {
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
    throw new Error(`This command writes curated fixtures to ${SANDBOX_DATABASE}. Re-run with --confirm.`);
  }

  const { default: db, closeDb } = await import('../lib/drizzle/drizzle');
  const schema = await import('../schemas/database.schema');

  try {
    const personaFixtures = SANDBOX_PERSONAS.map((persona, index) => {
      const context = profileText(persona);
      const premiseTexts = [
        `${persona.profile.identity.bio} Location: ${persona.profile.identity.location}.`,
        persona.profile.narrative.context,
        `Skills: ${persona.profile.attributes.skills.join(', ')}. Interests: ${persona.profile.attributes.interests.join(', ')}.`,
      ];
      const classified = new Set<NetworkKey>(['commons', ...persona.networkKeys]);
      if (index % 7 === 0) classified.add('vault');
      if (classified.size < 3) classified.add(NETWORKS[2 + (index % (NETWORKS.length - 2))]!.key);
      return {
        persona,
        userId: fixtureId('user', persona.email),
        context,
        premiseTexts,
        networkKeys: [...classified],
      };
    });

    const embeddingTexts = personaFixtures.flatMap(({ context, premiseTexts, persona }) => [
      context,
      ...premiseTexts,
      ...persona.intents,
    ]);
    const embeddings = await generateEmbeddings(embeddingTexts);
    const networkByKey = new Map(NETWORKS.map((network) => [network.key, network]));
    const ownerByNetwork = new Map<NetworkKey, string>();
    for (const fixture of personaFixtures) {
      for (const key of fixture.networkKeys) {
        if (!ownerByNetwork.has(key)) ownerByNetwork.set(key, fixture.userId);
      }
    }

    await db.transaction(async (tx) => {
      const fixtureUsers = await tx.select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`${schema.users.email} LIKE 'seed-tester-%@index-network.test' OR ${schema.users.email} LIKE 'sandbox-person-%@index-network.test'`);
      const fixtureUserIds = fixtureUsers.map((user) => user.id);
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

      for (const network of NETWORKS) {
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
        const { persona, userId, context, premiseTexts, networkKeys } = fixture;
        await tx.insert(schema.users).values({
          id: userId,
          email: persona.email,
          name: persona.name,
          intro: persona.profile.identity.bio,
          location: persona.profile.identity.location,
          onboarding: { completedAt: '2026-01-01T00:00:00.000Z' },
        }).onConflictDoUpdate({
          target: schema.users.id,
          set: {
            name: persona.name,
            intro: persona.profile.identity.bio,
            location: persona.profile.identity.location,
          },
        });

        await tx.insert(schema.userContexts).values({
          id: fixtureId('context', persona.email),
          userId,
          networkId: null,
          text: context,
          embedding: embeddings.get(context)!,
          premiseHash: fixtureId('premise-hash', persona.email),
          generatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }).onConflictDoUpdate({
          target: schema.userContexts.id,
          set: { text: context, embedding: embeddings.get(context)!, premiseHash: fixtureId('premise-hash', persona.email) },
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
            assertion: { text, tier: premiseIndex === 1 ? 'contextual' : 'assertive' },
            provenance: { source: 'onboarding', confidence: 1, timestamp: '2026-01-01T00:00:00.000Z' },
            analysis: { speechActType: 'ASSERTIVE', felicityAuthority: 1, felicitySincerity: 1, felicityClarity: 1, semanticEntropy: 0.1 },
            validity: { volatile: false },
            embedding: embeddings.get(text)!,
          }).onConflictDoUpdate({
            target: schema.premises.id,
            set: { assertion: { text, tier: premiseIndex === 1 ? 'contextual' : 'assertive' }, embedding: embeddings.get(text)! },
          });

          const premiseNetworkKeys: NetworkKey[] = networkKeys.filter((key) => key !== 'commons' && key !== 'vault');
          if (premiseIndex === 0 && networkKeys.includes('vault')) premiseNetworkKeys.push('vault');
          for (const key of new Set<NetworkKey>(['commons', ...premiseNetworkKeys])) {
            await tx.insert(schema.premiseNetworks).values({
              premiseId,
              networkId: networkByKey.get(key)!.id,
              relevancyScore: key === 'commons' ? '0.75' : '0.95',
            }).onConflictDoNothing();
          }
        }

        for (const [intentIndex, payload] of persona.intents.entries()) {
          const intentId = fixtureId('intent', `${persona.email}:${intentIndex}`);
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
            status: 'ACTIVE',
          }).onConflictDoUpdate({
            target: schema.intents.id,
            set: { payload, summary: payload, embedding: embeddings.get(payload)!, status: 'ACTIVE' },
          });

          const relevantKeys: NetworkKey[] = networkKeys.filter((key) => key !== 'commons' && key !== 'vault');
          if (intentIndex === 0 && networkKeys.includes('vault')) relevantKeys.push('vault');
          for (const key of new Set<NetworkKey>(['commons', ...relevantKeys])) {
            await tx.insert(schema.intentNetworks).values({
              intentId,
              networkId: networkByKey.get(key)!.id,
              relevancyScore: key === 'commons' ? '0.75' : '0.95',
            }).onConflictDoNothing();
          }
        }
      }
    });

    console.log(`Seeded ${personaFixtures.length} people, ${NETWORKS.length} networks, and ${personaFixtures.reduce((sum, item) => sum + item.persona.intents.length, 0)} intents into ${SANDBOX_DATABASE}.`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
