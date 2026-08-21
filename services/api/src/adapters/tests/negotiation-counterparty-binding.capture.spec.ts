/**
 * The counterparty-binding stamp (capture time) and the resume it must survive.
 *
 * #1474 made the settle survive drift; #1475 made the claim and expiry survive
 * drift. The live re-drive STILL refused — correctly — because the park's
 * stored coordinates were wrong at the source: a premise-matched counterparty
 * actor carries BOTH keys (`premise` is its own fact, `intent` names the
 * intent it matched AGAINST — the recipient's), and the capture's intent-first
 * preference stamped every such park with the recipient's own intent. The
 * claim's counterparty-liveness check ("intent owned by the counterparty")
 * can never pass for that stamp. This spec pins the corrected stamp at its
 * source and then runs the whole chain the three lanes fixed: correct stamp →
 * drift → drift-tolerant settle → drift-tolerant claim → successor minted.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { questionerAdapter } from '../questioner.adapter.instance';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { intents, intentNetworks, networks, networkMembers, opportunities, premises, premiseNetworks, users } from '../../schemas/database.schema';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

setDefaultTimeout(30_000);

const conversationAdapter = new ConversationDatabaseAdapter();

const cleanup = {
  users: [] as string[],
  networks: [] as string[],
  intents: [] as string[],
  premises: [] as string[],
  opportunities: [] as string[],
  conversations: [] as string[],
};

afterAll(async () => {
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
});

/**
 * Seeds the incident's world: recipient bound by intent, counterparty matched
 * by premise discovery — so its actor carries BOTH the recipient's intent id
 * (the intent it matched against, mirroring real enricher output) and its own
 * premise, which is a real row owned by the counterparty and assigned to the
 * network. `counterpartyShape: 'intent'` seeds the other kind instead: a
 * counterparty with only its own stated intent.
 */
async function seedWorkingNegotiation(counterpartyShape: 'premise' | 'intent') {
  const [recipient, counterparty] = await db.insert(users).values([
    { email: `binding-stamp-recipient-${randomUUID()}@test.local`, name: 'Binding stamp recipient' },
    { email: `binding-stamp-counterparty-${randomUUID()}@test.local`, name: 'Binding stamp counterparty' },
  ]).returning({ id: users.id });
  cleanup.users.push(recipient.id, counterparty.id);
  const [network] = await db.insert(networks).values({
    title: `Binding stamp ${randomUUID()}`,
    description: 'counterparty binding stamp fixture',
    isPersonal: false,
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
  });
  // The capture accepts only an in-flight turn.
  await db.update(tasks).set({ state: 'working' }).where(eq(tasks.id, task.id));

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

type Fixture = Awaited<ReturnType<typeof seedWorkingNegotiation>>;

async function captureBinding(fixture: Fixture) {
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

async function parkSettleAndClaim(fixture: Fixture, freeText: string) {
  // The real pause parks the task after the capture armed the timeout.
  await db.update(tasks).set({ state: 'input_required' }).where(eq(tasks.id, fixture.taskId));
  const settled = await questionerAdapter.settleInflightNegotiationAnswerFromDm({
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    recipientUserId: fixture.recipientId,
    recipientIntentId: fixture.recipientIntentId,
    networkId: fixture.networkId,
    answer: { selectedOptions: [], freeText, answeredAt: new Date().toISOString() },
  });
  const claim = await questionerAdapter.claimNegotiationContinuationExecution({
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    userId: fixture.recipientId,
    recipientIntentId: fixture.recipientIntentId,
    networkId: fixture.networkId,
  });
  return { settled, claim };
}

describe('captureNegotiationAskUserBinding counterparty stamp', () => {
  test('a premise-matched counterparty is premise-bound, even when its actor also names the matched-against intent', async () => {
    const fixture = await seedWorkingNegotiation('premise');
    const binding = await captureBinding(fixture);
    expect(binding.counterpartyUserId).toBe(fixture.counterpartyId);
    expect(binding.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
    const [task] = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, fixture.taskId));
    const turnContext = (task.metadata as Record<string, unknown>).turnContext as Record<string, unknown>;
    expect((turnContext.askUserBinding as Record<string, unknown>).counterpartyBinding)
      .toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
  });

  test('the incident end-to-end, inverted: correct stamp → drift → DM settle → claim mints the successor', async () => {
    const fixture = await seedWorkingNegotiation('premise');
    const binding = await captureBinding(fixture);
    expect(binding.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });

    // The 2026-08-20 incident's drift, on a correctly stamped park: signal
    // edited AND opportunity moved within the resumable set after the park.
    await db.update(intents)
      .set({ payload: 'Find a manufacturing partner for a sensor line — now EU-based, Q4 start' })
      .where(eq(intents.id, fixture.recipientIntentId));
    await db.update(opportunities)
      .set({ status: 'stalled', updatedAt: new Date(Date.now() + 1000) })
      .where(eq(opportunities.id, fixture.opportunityId));

    const { settled, claim } = await parkSettleAndClaim(fixture, 'Q4 works; EU preferred.');
    expect(settled).toBe('settled');
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
    expect(claim.execution.consultation).toMatchObject({
      kind: 'answer',
      recipientUserId: fixture.recipientId,
      freeText: 'Q4 works; EU preferred.',
    });
    const [successor] = await db.select().from(tasks).where(eq(tasks.id, claim.execution.successorTaskId));
    expect(successor.metadata).toMatchObject({
      resumeFromTaskId: fixture.taskId,
      continuationSettlementId: fixture.settlementId,
    });
  });

  test('an intent-only counterparty still stamps its own intent and the claim still passes', async () => {
    const fixture = await seedWorkingNegotiation('intent');
    const binding = await captureBinding(fixture);
    expect(binding.counterpartyBinding).toEqual({ kind: 'intent', id: fixture.counterpartyIntentId! });

    const { settled, claim } = await parkSettleAndClaim(fixture, 'Ready when you are.');
    expect(settled).toBe('settled');
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.counterpartyBinding).toEqual({ kind: 'intent', id: fixture.counterpartyIntentId! });
  });
});
