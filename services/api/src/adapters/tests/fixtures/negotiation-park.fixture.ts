/**
 * Shared DB seeding for specs that exercise the real park → settle → claim
 * substrate: a working negotiation between a recipient (intent-bound) and a
 * counterparty (premise- or intent-matched), with its in-flight task ready
 * for the ask-user capture. Extracted from
 * negotiation-counterparty-binding.capture.spec.ts so the intent-agent loop
 * spec drives the same honest chain instead of reimplementing the world.
 */
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import db from '../../../lib/drizzle/drizzle';
import { ConversationDatabaseAdapter } from '../../conversation.database.adapter';
import { intents, intentNetworks, networks, networkMembers, opportunities, premises, premiseNetworks, users } from '../../../schemas/database.schema';
import { conversations, messages, tasks } from '../../../schemas/conversation.schema';

const conversationAdapter = new ConversationDatabaseAdapter();

export interface ParkFixtureCleanup {
  users: string[];
  networks: string[];
  intents: string[];
  premises: string[];
  opportunities: string[];
  conversations: string[];
}

export function newParkFixtureCleanup(): ParkFixtureCleanup {
  return { users: [], networks: [], intents: [], premises: [], opportunities: [], conversations: [] };
}

/** Delete everything a fixture seeded, child rows first. */
export async function cleanupParkFixtures(cleanup: ParkFixtureCleanup): Promise<void> {
  if (cleanup.conversations.length > 0) {
    await db.delete(messages).where(inArray(messages.conversationId, cleanup.conversations));
    await db.delete(tasks).where(inArray(tasks.conversationId, cleanup.conversations));
    await db.delete(conversations).where(inArray(conversations.id, cleanup.conversations));
  }
  if (cleanup.opportunities.length > 0) await db.delete(opportunities).where(inArray(opportunities.id, cleanup.opportunities));
  if (cleanup.premises.length > 0) {
    await db.delete(premiseNetworks).where(inArray(premiseNetworks.premiseId, cleanup.premises));
    await db.delete(premises).where(inArray(premises.id, cleanup.premises));
  }
  if (cleanup.intents.length > 0) {
    await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, cleanup.intents));
    await db.delete(intents).where(inArray(intents.id, cleanup.intents));
  }
  if (cleanup.networks.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.networkId, cleanup.networks));
    await db.delete(networks).where(inArray(networks.id, cleanup.networks));
  }
  if (cleanup.users.length > 0) await db.delete(users).where(inArray(users.id, cleanup.users));
}

/**
 * Seeds the binding-stamp incident's world: recipient bound by intent,
 * counterparty matched by premise discovery — so its actor carries BOTH the
 * recipient's intent id (the intent it matched against, mirroring real
 * enricher output) and its own premise, which is a real row owned by the
 * counterparty and assigned to the network. `counterpartyShape: 'intent'`
 * seeds the other kind instead: a counterparty with only its own stated
 * intent. The task carries the same `participantBindings` the negotiation
 * graph stamps, so the production parked-negotiation reader resolves the
 * park exactly as it does live.
 */
export async function seedWorkingNegotiation(
  cleanup: ParkFixtureCleanup,
  counterpartyShape: 'premise' | 'intent',
) {
  const [recipient, counterparty] = await db.insert(users).values([
    { email: `binding-stamp-recipient-${randomUUID()}@test.local`, name: 'Binding stamp recipient' },
    { email: `binding-stamp-counterparty-${randomUUID()}@test.local`, name: 'Binding stamp counterparty' },
  ]).returning({ id: users.id });
  cleanup.users.push(recipient.id, counterparty.id);
  const [network] = await db.insert(networks).values({
    title: `Binding stamp ${randomUUID()}`,
  }).returning({ id: networks.id });
  cleanup.networks.push(network.id);
  await db.insert(networkMembers).values([
    { networkId: network.id, userId: recipient.id, permissions: ['member'] },
    { networkId: network.id, userId: counterparty.id, permissions: ['member'] },
  ]);
  const [recipientIntent] = await db.insert(intents).values({
    userId: recipient.id, payload: 'Find a manufacturing partner for a sensor line', status: 'ACTIVE',
  }).returning({ id: intents.id });
  cleanup.intents.push(recipientIntent.id);
  await db.insert(intentNetworks).values([{ intentId: recipientIntent.id, networkId: network.id }]);

  let counterpartyPremiseId: string | undefined;
  let counterpartyIntentId: string | undefined;
  if (counterpartyShape === 'premise') {
    const [premise] = await db.insert(premises).values({
      userId: counterparty.id,
      assertion: { text: 'Runs a contract manufacturing line for industrial sensors' } as never,
      provenance: { kind: 'test' } as never,
      validity: { status: 'valid' } as never,
      status: 'ACTIVE',
    }).returning({ id: premises.id });
    cleanup.premises.push(premise.id);
    await db.insert(premiseNetworks).values([{ premiseId: premise.id, networkId: network.id }]);
    counterpartyPremiseId = premise.id;
  } else {
    const [counterpartyIntent] = await db.insert(intents).values({
      userId: counterparty.id, payload: 'Offer contract manufacturing', status: 'ACTIVE',
    }).returning({ id: intents.id });
    cleanup.intents.push(counterpartyIntent.id);
    await db.insert(intentNetworks).values([{ intentId: counterpartyIntent.id, networkId: network.id }]);
    counterpartyIntentId = counterpartyIntent.id;
  }

  const counterpartyActor = counterpartyShape === 'premise'
    // The incident shape: `intent` is the RECIPIENT'S intent (matched
    // against), `premise` is the counterparty's own fact.
    ? { userId: counterparty.id, intent: recipientIntent.id, premise: counterpartyPremiseId, networkId: network.id, role: 'agent' }
    : { userId: counterparty.id, intent: counterpartyIntentId, networkId: network.id, role: 'peer' };
  const [opportunity] = await db.insert(opportunities).values({
    detection: { kind: 'test', summary: 'binding stamp' } as never,
    actors: [
      { userId: recipient.id, intent: recipientIntent.id, networkId: network.id, role: 'patient' },
      counterpartyActor,
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: { networkId: network.id } as never,
    confidence: '0.9',
    status: 'negotiating',
  }).returning();
  cleanup.opportunities.push(opportunity.id);

  const conversation = await conversationAdapter.createConversation([
    { participantId: `agent:${recipient.id}`, participantType: 'agent' },
    { participantId: `agent:${counterparty.id}`, participantType: 'agent' },
  ]);
  cleanup.conversations.push(conversation.id);
  const task = await conversationAdapter.createTask(conversation.id, {
    type: 'negotiation',
    opportunityId: opportunity.id,
    networkId: network.id,
    sourceUserId: counterparty.id,
    candidateUserId: recipient.id,
    candidateIntentId: recipientIntent.id,
    participantBindings: [
      { userId: recipient.id, intentId: recipientIntent.id },
      { userId: counterparty.id, intentId: counterpartyShape === 'intent' ? counterpartyIntentId : recipientIntent.id },
    ],
  });
  // The capture accepts only an in-flight turn.
  await db.update(tasks).set({ state: 'working' }).where(eq(tasks.id, task.id));

  // The negotiation's own ask_user turn message, as the recipient's agent
  // writes it before the pause: the parked-negotiation reader builds its
  // record from the negotiation's messages, so a park with no turn at all is
  // invisible to it (and to the live product).
  await db.insert(messages).values({
    conversationId: conversation.id,
    taskId: task.id,
    senderId: `agent:${recipient.id}`,
    role: 'agent',
    parts: [{
      kind: 'data',
      data: {
        action: 'ask_user',
        assessment: { reasoning: 'Paused for the client.' },
        message: 'I need my client to settle timing before continuing.',
        askUser: {
          reason: 'unresolved_owner_constraint',
          dimension: 'Timing',
          question: {
            title: 'Timing',
            prompt: 'Does this quarter work for a start?',
            options: [
              { label: 'This quarter', description: 'Start within the quarter.' },
              { label: 'Later', description: 'Start after this quarter.' },
            ],
          },
        },
      },
    }] as never,
  });

  return {
    recipientId: recipient.id,
    recipientIntentId: recipientIntent.id,
    counterpartyId: counterparty.id,
    counterpartyPremiseId,
    counterpartyIntentId,
    networkId: network.id,
    opportunityId: opportunity.id,
    taskId: task.id,
    settlementId: `negotiation-question-settlement-v1-${task.id}`,
  };
}

export type ParkFixture = Awaited<ReturnType<typeof seedWorkingNegotiation>>;

/** Arm the real ask-user capture on the fixture's in-flight task. */
export async function captureParkBinding(fixture: ParkFixture) {
  return conversationAdapter.captureNegotiationAskUserBinding({
    taskId: fixture.taskId,
    turnContext: { fixture: 'binding-stamp' },
    settlementId: fixture.settlementId,
    recipientUserId: fixture.recipientId,
    recipientIntentId: fixture.recipientIntentId,
    opportunityId: fixture.opportunityId,
    networkId: fixture.networkId,
  });
}

/** Park the task the way the real pause does, after the capture armed it. */
export async function parkFixtureTask(fixture: ParkFixture): Promise<void> {
  await db.update(tasks).set({ state: 'input_required' }).where(eq(tasks.id, fixture.taskId));
}
