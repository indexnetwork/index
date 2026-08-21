/**
 * Park-time drift and the continuation fences (claim + expiry).
 *
 * The design law: "Intent update should always be explicit. Stale negs should
 * be solved by question answering. When everything else is tried, the agent
 * can propose resignaling with the updated intent." #1474 split the settle
 * fence along that law; this spec proves the same split in the two fences one
 * hop downstream — `validateMaterialBinding` (claim / heartbeat / completion)
 * and `expireInflightQuestion` (the 24h sweep). Park-time drift (signal
 * edited, opportunity touched or moved within the resumable set) is log-only;
 * what still refuses is genuine current reality: a terminal opportunity, a
 * broken binding, a missing membership, and the completion path's own
 * terminal-effect assertion.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { questionerAdapter } from '../questioner.adapter.instance';
import { claimContinuationExecution, completeContinuationExecution } from '../negotiation-continuation.atomic';
import { ConversationDatabaseAdapter } from '../conversation.database.adapter';
import { intents, intentNetworks, networks, networkMembers, opportunities, users } from '../../schemas/database.schema';
import { artifacts, conversations, messages, tasks } from '../../schemas/conversation.schema';

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
  const ownerPayload = 'Find a manufacturing partner for a sensor line';
  const [owner, counterparty] = await db.insert(users).values([
    { email: `continuation-drift-owner-${randomUUID()}@test.local`, name: 'Continuation drift owner' },
    { email: `continuation-drift-counterparty-${randomUUID()}@test.local`, name: 'Continuation drift counterparty' },
  ]).returning({ id: users.id });
  cleanup.users.push(owner.id, counterparty.id);
  const [network] = await db.insert(networks).values({
    title: `Continuation drift ${randomUUID()}`,
    description: 'claim/expiry drift fixture',
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
    userId: counterparty.id, payload: 'Offer contract manufacturing', status: 'ACTIVE',
  }).returning({ id: intents.id });
  cleanup.intents.push(ownerIntent.id, counterpartyIntent.id);
  await db.insert(intentNetworks).values([
    { intentId: ownerIntent.id, networkId: network.id },
    { intentId: counterpartyIntent.id, networkId: network.id },
  ]);
  const [opportunity] = await db.insert(opportunities).values({
    detection: { kind: 'test', summary: 'continuation drift' } as never,
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
    counterpartyId: counterparty.id,
    counterpartyIntentId: counterpartyIntent.id,
    networkId: network.id,
    opportunityId: opportunity.id,
    conversationId: conversation.id,
    taskId: task.id,
    settlementId,
    binding: askUserBinding,
  };
}

type Fixture = Awaited<ReturnType<typeof seedParkedConsult>>;

function settleInput(fixture: Fixture, freeText: string) {
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

function claimKey(fixture: Fixture) {
  return {
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    userId: fixture.ownerId,
    recipientIntentId: fixture.ownerIntentId,
    networkId: fixture.networkId,
  };
}

function expiryCoordinates(fixture: Fixture) {
  return {
    ...claimKey(fixture),
    intentFingerprint: fixture.binding.intentFingerprint,
    opportunityStatus: fixture.binding.opportunityStatus,
    opportunityUpdatedAt: fixture.binding.opportunityUpdatedAt,
    counterpartyUserId: fixture.counterpartyId,
    counterpartyBinding: { kind: 'intent' as const, id: fixture.counterpartyIntentId },
  };
}

async function driftWorld(fixture: Fixture) {
  // The 2026-08-20 zombie park, one hop downstream: signal edited AND
  // opportunity moved (negotiating → stalled, updatedAt touched) after the
  // park, so all three park-time coordinates drifted off the settlement.
  await db.update(intents)
    .set({ payload: 'Find a manufacturing partner for a sensor line — now EU-based, Q4 start' })
    .where(eq(intents.id, fixture.ownerIntentId));
  await db.update(opportunities)
    .set({ status: 'stalled', updatedAt: new Date(Date.now() + 1000) })
    .where(eq(opportunities.id, fixture.opportunityId));
}

describe('claimNegotiationContinuationExecution under park-time drift', () => {
  test('the incident, fixed: settle survives drift AND the claim one hop downstream mints the successor', async () => {
    // Answers are authoritative over staleness; drift is logged, not fatal.
    // Before this split the settle passed (#1474) and the claim refused the
    // same drift with admission "invalid" — the answer was durable but the
    // negotiation never resumed.
    const fixture = await seedParkedConsult();
    await driftWorld(fixture);

    const settled = await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Q4 works; EU preferred.'),
    );
    expect(settled).toBe('settled');

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.consultation).toMatchObject({
      kind: 'answer',
      recipientUserId: fixture.ownerId,
      selectedOptions: [],
      freeText: 'Q4 works; EU preferred.',
    });
    const [successor] = await db.select().from(tasks).where(eq(tasks.id, claim.execution.successorTaskId));
    expect(successor.metadata).toMatchObject({
      resumeFromTaskId: fixture.taskId,
      continuationSettlementId: fixture.settlementId,
    });
  });

  test('a terminal current status still refuses the claim — the settle→claim race stays fenced', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Ready when you are.'),
    );
    await db.update(opportunities)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(opportunities.id, fixture.opportunityId));

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('invalid');
  });

  test('coherence stays hard: coordinates that disagree with the stored settlement refuse the claim', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Coherence pin.'),
    );

    const claim = await claimContinuationExecution(db, {
      ...expiryCoordinates(fixture),
      // The settlement names the counterparty; a caller naming someone else
      // is not this park's resume.
      counterpartyUserId: fixture.ownerId,
    });
    expect(claim.status).toBe('invalid');
  });

  test('coherence stays hard: a recipient membership that is gone refuses the claim', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Membership pin.'),
    );
    await db.update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(eq(networkMembers.userId, fixture.ownerId));

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('invalid');
  });

  test('coherence stays hard: a dead counterparty binding refuses the claim', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Counterparty pin.'),
    );
    await db.update(intents)
      .set({ archivedAt: new Date() })
      .where(eq(intents.id, fixture.counterpartyIntentId));

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('invalid');
  });

  test('the completion path still asserts the exact terminal effect it wrote', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Let us pause here.'),
    );
    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;

    await db.update(tasks).set({ state: 'completed' }).where(eq(tasks.id, claim.execution.successorTaskId));
    await db.insert(artifacts).values({
      taskId: claim.execution.successorTaskId,
      name: 'negotiation-outcome',
      parts: [] as never,
      metadata: { continuationOutcome: 'stalled' } as never,
    });
    const receipt = {
      priorTaskId: fixture.taskId,
      settlementId: fixture.settlementId,
      successorTaskId: claim.execution.successorTaskId,
      fence: claim.execution.fence,
      outcome: 'stalled' as const,
    };

    // The opportunity does not yet show the effect the receipt claims — this
    // is not park-time drift and must stay fatal.
    await expect(completeContinuationExecution(db, claim.execution, receipt))
      .rejects.toThrow('Negotiation continuation material binding drifted before receipt');

    await db.update(opportunities)
      .set({ status: 'stalled', updatedAt: new Date() })
      .where(eq(opportunities.id, fixture.opportunityId));
    await completeContinuationExecution(db, claim.execution, receipt);

    const [prior] = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, fixture.taskId));
    expect((prior.metadata as Record<string, unknown>).questionSettlement).toMatchObject({
      continuationStatus: 'completed',
    });
    const [successor] = await db.select({ metadata: tasks.metadata }).from(tasks)
      .where(eq(tasks.id, claim.execution.successorTaskId));
    expect((successor.metadata as Record<string, unknown>).continuationExecution).toMatchObject({
      status: 'completed',
    });
  });
});

describe('expireInflightQuestion under park-time drift', () => {
  test('a drifted park still expires — and its timeout settlement resumes through the same claim', async () => {
    // Answers are authoritative over staleness; drift is logged, not fatal —
    // and expiry is a cleanup act, so the 24h sweep must not be fenced out by
    // the same staleness. A park that can never expire is the second zombie
    // class the incident found.
    const fixture = await seedParkedConsult();
    await driftWorld(fixture);

    const coordinates = expiryCoordinates(fixture);
    const expired = await questionerAdapter.expireInflightQuestion(coordinates);
    expect(expired).toEqual(coordinates);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, fixture.taskId));
    expect(task.state).toBe('canceled');
    expect(task.statusMessage).toMatchObject({ reason: 'ask_user_window_expired', settlementId: fixture.settlementId });
    const settlement = (task.metadata as Record<string, unknown>).questionSettlement as Record<string, unknown>;
    // The settlement records the BINDING's provenance values — the park that
    // expired, not the world after the drift.
    expect(settlement).toMatchObject({
      kind: 'timeout',
      continuationStatus: 'requested',
      intentFingerprint: fixture.binding.intentFingerprint,
      opportunityStatus: fixture.binding.opportunityStatus,
      opportunityUpdatedAt: fixture.binding.opportunityUpdatedAt,
    });

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.consultation).toMatchObject({
      kind: 'timeout',
      selectedOptions: [],
    });
  });

  test('a park on a terminal opportunity still expires; only the resume refuses', async () => {
    const fixture = await seedParkedConsult();
    await db.update(opportunities)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(opportunities.id, fixture.opportunityId));

    const coordinates = expiryCoordinates(fixture);
    const expired = await questionerAdapter.expireInflightQuestion(coordinates);
    expect(expired).toEqual(coordinates);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, fixture.taskId));
    expect(task.state).toBe('canceled');
    expect((task.metadata as Record<string, unknown>).questionSettlement).toMatchObject({ kind: 'timeout' });

    const claim = await questionerAdapter.claimNegotiationContinuationExecution(claimKey(fixture));
    expect(claim.status).toBe('invalid');
  });

  test('a consult already settled by an answer reports its coordinates without rewriting the settlement', async () => {
    const fixture = await seedParkedConsult();
    await questionerAdapter.settleInflightNegotiationAnswerFromDm(
      settleInput(fixture, 'Answered first.'),
    );

    const coordinates = expiryCoordinates(fixture);
    const expired = await questionerAdapter.expireInflightQuestion(coordinates);
    expect(expired).toEqual(coordinates);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, fixture.taskId));
    expect((task.metadata as Record<string, unknown>).questionSettlement).toMatchObject({
      kind: 'answer',
      answer: { freeText: 'Answered first.' },
    });
  });

  test('coherence stays hard: coordinates the binding does not carry refuse the expiry', async () => {
    const fixture = await seedParkedConsult();
    const expired = await questionerAdapter.expireInflightQuestion({
      ...expiryCoordinates(fixture),
      intentFingerprint: 'not-the-bound-fingerprint',
    });
    expect(expired).toBeNull();
    const [task] = await db.select({ state: tasks.state }).from(tasks).where(eq(tasks.id, fixture.taskId));
    expect(task.state).toBe('input_required');
  });
});
