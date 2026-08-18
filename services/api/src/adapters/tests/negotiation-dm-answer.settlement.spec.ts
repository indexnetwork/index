/**
 * Row-less DM-path settlement (conversational-questions answer wiring).
 *
 * The card answer path stores the client's answer on a QUESTIONS row, which
 * `loadPrivateConsultation` reads when the continuation claim mints the
 * successor. The DM path has no question row — #1432's known wrinkle — so
 * `settleInflightNegotiationAnswerFromDm` stores the answer INLINE on the
 * task's questionSettlement. This spec proves the whole chain against the
 * real database: settle CASes the exact `input_required` task closed, a
 * repeat delivery reports `already_settled`, a lost race reports `lost`, and
 * — the load-bearing assertion — the continuation claim's fenced execution
 * carries the answer text into the successor's consultation.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { questionerAdapter } from '../questioner.adapter.instance';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { intents, intentNetworks, networks, networkMembers, opportunities, users } from '../../schemas/database.schema';
import { conversations, messages, tasks } from '../../schemas/conversation.schema';

setDefaultTimeout(30_000);

const conversationAdapter = new ConversationDatabaseAdapter();

const cleanup = {
  users: [] as string[],
  networks: [] as string[],
  intents: [] as string[],
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

async function seedParkedConsult() {
  const ownerPayload = 'Find a design partner for a hardware pilot';
  const [owner, counterparty] = await db.insert(users).values([
    { email: `dm-answer-owner-${randomUUID()}@test.local`, name: 'DM answer owner' },
    { email: `dm-answer-counterparty-${randomUUID()}@test.local`, name: 'DM answer counterparty' },
  ]).returning({ id: users.id });
  cleanup.users.push(owner.id, counterparty.id);
  const [network] = await db.insert(networks).values({
    title: `DM answer ${randomUUID()}`,
    description: 'row-less settlement fixture',
    isPersonal: false,
  }).returning({ id: networks.id });
  cleanup.networks.push(network.id);
  await db.insert(networkMembers).values([
    { networkId: network.id, userId: owner.id, permissions: ['member'] },
    { networkId: network.id, userId: counterparty.id, permissions: ['member'] },
  ]);
  const [ownerIntent] = await db.insert(intents).values({
    userId: owner.id, payload: ownerPayload, status: 'ACTIVE',
  }).returning({ id: intents.id, payload: intents.payload, summary: intents.summary });
  const [counterpartyIntent] = await db.insert(intents).values({
    userId: counterparty.id, payload: 'Offer design partnership', status: 'ACTIVE',
  }).returning({ id: intents.id });
  cleanup.intents.push(ownerIntent.id, counterpartyIntent.id);
  await db.insert(intentNetworks).values([
    { intentId: ownerIntent.id, networkId: network.id },
    { intentId: counterpartyIntent.id, networkId: network.id },
  ]);
  const [opportunity] = await db.insert(opportunities).values({
    detection: { kind: 'test', summary: 'dm answer settlement' } as never,
    actors: [
      { userId: counterparty.id, intent: counterpartyIntent.id, networkId: network.id, role: 'peer' },
      { userId: owner.id, intent: ownerIntent.id, networkId: network.id, role: 'peer' },
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: { networkId: network.id } as never,
    confidence: '0.9',
    status: 'negotiating',
  }).returning();
  cleanup.opportunities.push(opportunity.id);

  const conversation = await conversationAdapter.createConversation([
    { participantId: `agent:${owner.id}`, participantType: 'agent' },
    { participantId: `agent:${counterparty.id}`, participantType: 'agent' },
  ]);
  cleanup.conversations.push(conversation.id);
  const task = await conversationAdapter.createTask(conversation.id, {
    type: 'negotiation',
    opportunityId: opportunity.id,
    networkId: network.id,
    sourceUserId: counterparty.id,
    candidateUserId: owner.id,
    sourceIntentId: counterpartyIntent.id,
    candidateIntentId: ownerIntent.id,
    participantBindings: [
      { userId: counterparty.id, intentId: counterpartyIntent.id, networkId: network.id },
      { userId: owner.id, intentId: ownerIntent.id, networkId: network.id },
    ],
  });

  const settlementId = `negotiation-question-settlement-v1-${task.id}`;
  const askUserBinding = {
    version: 2,
    settlementId,
    recipientUserId: owner.id,
    recipientIntentId: ownerIntent.id,
    opportunityId: opportunity.id,
    networkId: network.id,
    intentFingerprint: computeIntentFingerprint(ownerIntent.payload, ownerIntent.summary),
    opportunityStatus: opportunity.status,
    opportunityUpdatedAt: opportunity.updatedAt.toISOString(),
    counterpartyUserId: counterparty.id,
    counterpartyIntentId: counterpartyIntent.id,
  };
  const [{ metadata }] = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, task.id));
  await db.update(tasks).set({
    state: 'input_required',
    metadata: { ...(metadata as Record<string, unknown>), turnContext: { askUserBinding } },
  }).where(eq(tasks.id, task.id));

  return {
    ownerId: owner.id,
    ownerIntentId: ownerIntent.id,
    networkId: network.id,
    opportunityId: opportunity.id,
    conversationId: conversation.id,
    taskId: task.id,
    settlementId,
  };
}

function settleInput(fixture: Awaited<ReturnType<typeof seedParkedConsult>>, freeText: string) {
  return {
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    recipientUserId: fixture.ownerId,
    recipientIntentId: fixture.ownerIntentId,
    networkId: fixture.networkId,
    answer: { selectedOptions: [], freeText, answeredAt: new Date().toISOString() },
  };
}

describe('settleInflightNegotiationAnswerFromDm', () => {
  test('settles the exact input_required task with the answer inline, once', async () => {
    const fixture = await seedParkedConsult();

    const first = await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'I can start in March.'),
    );
    expect(first).toBe('settled');

    const [task] = await db.select().from(tasks).where(eq(tasks.id, fixture.taskId));
    expect(task.state).toBe('canceled');
    expect(task.statusMessage).toMatchObject({ reason: 'ask_user_answered', settlementId: fixture.settlementId });
    const settlement = (task.metadata as Record<string, unknown>).questionSettlement as Record<string, unknown>;
    expect(settlement).toMatchObject({
      kind: 'answer',
      settlementId: fixture.settlementId,
      answer: { selectedOptions: [], freeText: 'I can start in March.' },
    });
    expect(settlement.questionId).toBeUndefined();

    // Redelivery: the stored settlement stands, the repeat only re-enqueues.
    const second = await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'I can start in March.'),
    );
    expect(second).toBe('already_settled');
  });

  test('the continuation claim reads the inline answer — the successor actually receives the text', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Budget is capped at 40k; hardware only.'),
    );

    const claim = await questionerAdapter.claimNegotiationContinuationExecution({
      taskId: fixture.taskId,
      settlementId: fixture.settlementId,
      opportunityId: fixture.opportunityId,
      userId: fixture.ownerId,
      recipientIntentId: fixture.ownerIntentId,
      networkId: fixture.networkId,
    });
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.consultation).toMatchObject({
      kind: 'answer',
      recipientUserId: fixture.ownerId,
      recipientIntentId: fixture.ownerIntentId,
      selectedOptions: [],
      freeText: 'Budget is capped at 40k; hardware only.',
    });
    // The claim minted a fenced successor for the exact settlement.
    const [successor] = await db.select().from(tasks).where(eq(tasks.id, claim.execution.successorTaskId));
    expect(successor.metadata).toMatchObject({
      resumeFromTaskId: fixture.taskId,
      continuationSettlementId: fixture.settlementId,
    });
  });

  test('a consult already settled by timeout refuses the answer', async () => {
    const fixture = await seedParkedConsult();
    // Simulate the expiry worker winning the race: kind 'timeout', task closed.
    const [{ metadata }] = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, fixture.taskId));
    const binding = ((metadata as Record<string, unknown>).turnContext as Record<string, unknown>).askUserBinding as Record<string, unknown>;
    await db.update(tasks).set({
      state: 'canceled',
      metadata: {
        ...(metadata as Record<string, unknown>),
        questionSettlement: {
          version: 1,
          settlementId: fixture.settlementId,
          taskId: fixture.taskId,
          recipientUserId: fixture.ownerId,
          recipientIntentId: fixture.ownerIntentId,
          opportunityId: fixture.opportunityId,
          networkId: fixture.networkId,
          intentFingerprint: binding.intentFingerprint,
          opportunityStatus: binding.opportunityStatus,
          opportunityUpdatedAt: binding.opportunityUpdatedAt,
          counterpartyUserId: binding.counterpartyUserId,
          counterpartyIntentId: binding.counterpartyIntentId,
          kind: 'timeout',
          continuationStatus: 'requested',
          settledAt: new Date().toISOString(),
        },
      },
    }).where(eq(tasks.id, fixture.taskId));

    const result = await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Too late?'),
    );
    expect(result).toBe('lost');
  });

  test('a task that is no longer input_required refuses the answer', async () => {
    const fixture = await seedParkedConsult();
    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, fixture.taskId));
    const result = await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Anyone there?'),
    );
    expect(result).toBe('lost');
  });
});

describe('recordOpportunityUserAnswer', () => {
  test('appends once per questionId — a redelivered append is ignored', async () => {
    const fixture = await seedParkedConsult();
    const entry = {
      questionId: `negotiation-park-answer-v1-${fixture.taskId}`,
      selectedOptions: [],
      freeText: 'March works.',
      answeredAt: new Date().toISOString(),
    };

    await questionerAdapter.recordOpportunityUserAnswer(fixture.opportunityId, entry);
    await questionerAdapter.recordOpportunityUserAnswer(fixture.opportunityId, { ...entry, freeText: 'Duplicate delivery.' });
    await questionerAdapter.recordOpportunityUserAnswer(fixture.opportunityId, { ...entry, questionId: 'other-park-answer' });

    const [row] = await db.select({ metadata: opportunities.metadata }).from(opportunities)
      .where(eq(opportunities.id, fixture.opportunityId));
    const answers = ((row.metadata as Record<string, unknown>).userAnswers ?? []) as Array<Record<string, unknown>>;
    expect(answers).toHaveLength(2);
    expect(answers[0]).toMatchObject({ questionId: entry.questionId, freeText: 'March works.' });
    expect(answers[1]).toMatchObject({ questionId: 'other-park-answer' });
  });
});
